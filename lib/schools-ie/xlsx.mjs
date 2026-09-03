/* ===========================================================================
 * xlsx.mjs — read the cells out of an .xlsx, with no dependency.
 *
 * The Department publishes .xlsx. Adding a spreadsheet library to a Next.js
 * portal to read one file once a year is a poor trade, and an .xlsx is a zip of
 * XML: the parts we need are a shared string table and one sheet of <c> tags.
 * So this reads it directly.
 *
 * What it deliberately does NOT do: formulas, dates, styles, number formats,
 * merged cells, ZIP64, encrypted workbooks. Every cell comes back as a trimmed
 * string, because every column we want is text or a plain integer. If a future
 * file needs any of that, reach for a library rather than growing this.
 * ======================================================================== */

import { inflateRawSync } from 'node:zlib';

/* --- zip ---------------------------------------------------------------- */

/**
 * Read a zip's entries into { name -> Buffer }.
 *
 * Central-directory driven rather than by scanning local headers, because a
 * local header may declare sizes of zero and defer them to a data descriptor;
 * the central directory always has the real ones.
 */
function unzip(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  // The comment field is variable-length, so the EOCD has to be found by
  // scanning back from the end. Max comment is 65535.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('ZIP64 archives are not supported by this reader');

  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header's own name/extra lengths are what matter for finding the
    // data — they can differ from the central directory's extra length.
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`unsupported compression method ${method} for ${name}`);

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

/* --- xml ---------------------------------------------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** The shared string table: <si> entries, each possibly split across runs. */
function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? []) {
    // Concatenate every <t>, skipping <rPh> ruby annotations, which are
    // pronunciation hints and not part of the value.
    const parts = [];
    for (const m of si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      parts.push(decode(m[1]));
    }
    out.push(parts.join(''));
  }
  return out;
}

/** "BC12" -> 54 (zero-based column index). */
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/* --- the sheet ---------------------------------------------------------- */

/**
 * Sheet name -> part path, in the workbook's own order.
 *
 * Reading "the first sheet" is not good enough and the real file proves it: the
 * Department's workbook opens on an "Explanatory Note" tab and keeps the data
 * on "School Lists", which is sheet2.xml. So every sheet comes back named and
 * the caller picks.
 */
function sheetIndex(files) {
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  const out = [];

  if (wb && rels) {
    for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
      const tag = m[0];
      const name = decode(/name="([^"]*)"/.exec(tag)?.[1] ?? '');
      const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
      if (!rid) continue;
      const rel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0];
      const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
      if (!target) continue;
      const path = `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}`;
      if (files.has(path)) out.push({ name, path });
    }
  }

  if (out.length === 0) {
    // A workbook we could not read the manifest of. Fall back to part order so
    // something still comes back, and let the caller notice the names are made up.
    for (const name of files.keys()) {
      if (/^xl\/worksheets\/.*\.xml$/.test(name)) out.push({ name, path: name });
    }
  }
  if (out.length === 0) throw new Error('no worksheet found inside the workbook');
  return out;
}

/**
 * Rows of trimmed strings for one sheet's XML.
 *
 * Rows are padded to the width of the widest one, because a writer omits
 * trailing empty cells and a header-to-column mapping built on ragged rows
 * silently reads the wrong column.
 */
function readSheet(xml, strings) {
  const rows = [];
  let width = 0;
  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const cells = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const body = m[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1];

      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('');
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) value = type === 's' ? (strings[Number(v)] ?? '') : decode(v);
      }

      const at = ref !== undefined ? colIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = String(value).trim();
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

/** Every sheet in the workbook, in workbook order: [{ name, rows }]. */
export function readWorkbook(buf) {
  const files = unzip(buf);
  const strings = sharedStrings(files.get('xl/sharedStrings.xml')?.toString('utf8'));
  return sheetIndex(files).map(({ name, path }) => ({
    name,
    rows: readSheet(files.get(path).toString('utf8'), strings),
  }));
}
