/* ===========================================================================
 * parse.mjs — the Department of Education's post-primary list, as records.
 *
 * Source: gov.ie, "Post-primary schools enrolment figures", the workbook for a
 * given academic year. The 2025/2026 file is 722 rows on a "School Lists" tab,
 * 28 columns wide, of which this reads six.
 *
 * Pure: buffer in, records and a report out. No database, no network, no
 * filesystem — so test/schools-ie.test.mjs can run the whole thing against the
 * real workbook with nothing configured.
 *
 * The file is published by somebody else and its shape is not a contract, so
 * every assumption here is checked and reported rather than assumed:
 * columns are found by header name, not by position; rows that do not look
 * like schools are rejected with a reason instead of being silently dropped.
 * ======================================================================== */

import { readWorkbook } from './xlsx.mjs';

/** The tab holding the data. Not the first tab — that is an explanatory note. */
const DATA_SHEET = /school\s*list/i;

/**
 * Header synonyms, most specific first.
 *
 * Header text has drifted between years ("Total 2025-2026" carries the year in
 * the header itself), so each field matches a list of patterns rather than one
 * literal string.
 */
const COLUMNS = {
  roll:      [/^roll\s*number$/i, /^roll$/i],
  name:      [/^official\s*school\s*name$/i, /^school\s*name$/i, /^name$/i],
  address1:  [/^address\s*1$/i],
  address2:  [/^address\s*2$/i],
  address3:  [/^address\s*3$/i],
  address4:  [/^address\s*4$/i],
  county:    [/^county$/i],
  eircode:   [/^eircode$/i],
  authority: [/^local\s*authority$/i],
  planning:  [/^school\s*planning\s*area$/i],
  enrolment: [/^total\s*\d{4}[-/]\d{2,4}$/i, /^total$/i, /^total\s*enrolment$/i],
  year:      [/^academic\s*year$/i],
};

/** A real post-primary roll number: five digits and a check letter. */
const ROLL = /^[0-9]{5}[A-Z]$/;

/* --- address ------------------------------------------------------------ */

const isCountyLine = (s) => /^(co\.?|contae|cont[ae])\b/i.test(s);
const isNumericLine = (s) => /^[0-9]+$/.test(s);
const isIreland = (s) => /^(ireland|[ée]ire)$/i.test(s);

/**
 * An Eircode: a routing key of a letter and two digits, then four characters.
 *
 * The narrow first group is the whole point. Written as three alphanumerics it
 * also matches any seven-letter word, which quietly ate "Clonmel" and
 * "Thurles" — two towns that are the ONLY thing separating two schools called
 * Presentation Secondary School. A filter meant to remove noise removed the
 * signal instead.
 */
const isEircode = (s) => /^[A-Za-z][0-9]{2}\s?[A-Za-z0-9]{4}$/.test(s.trim());

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The town, from the address lines.
 *
 * Irish addresses run narrow to broad — street, town, county — so the town is
 * the last line that is not the county. Dropped along the way: numeric county
 * codes the Department carries in a spare address column, Eircodes filed as an
 * address line, "Ireland", and a first line that merely repeats the school's
 * own name ("Blackrock College, Rock Road, Co. Dublin").
 *
 * Returns '' rather than guessing when nothing survives. An empty town is
 * honest and the label ladder handles it; a wrong town is a school someone
 * cannot find.
 */
export function deriveTown(row, name, eircode) {
  const lines = [row.address1, row.address2, row.address3, row.address4]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);

  const kept = lines.filter(
    (l) =>
      !isNumericLine(l) &&
      !isCountyLine(l) &&
      !isIreland(l) &&
      !isEircode(l) &&
      squash(l) !== squash(eircode) &&
      squash(l) !== squash(name),
  );
  return kept.length ? kept[kept.length - 1] : '';
}

/**
 * The county.
 *
 * The workbook has a County column and it is filled for 76 of 722 rows, so it
 * cannot be the primary source. Local Authority is filled for all but one and
 * is clean, controlled text, so it is: strip the council suffix and it is the
 * county. The "(NR)" / "(SR)" ridings of Tipperary are stripped too — they are
 * an administrative distinction that means nothing to a teacher picking their
 * school, and where two schools genuinely need separating the label ladder
 * falls through to the roll number, which is unambiguous.
 *
 * A "Co. Wexford" address line is the last resort.
 */
export function deriveCounty(row) {
  const explicit = String(row.county ?? '').trim();
  if (explicit) return explicit;

  const la = String(row.authority ?? '').trim();
  if (la) {
    return la
      .replace(/\s*\((?:NR|SR)\)\s*/gi, ' ')
      .replace(/\s+(?:city\s+and\s+county|city|county)\s+council$/i, '')
      .replace(/\s+council$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  for (const l of [row.address4, row.address3, row.address2, row.address1]) {
    const s = String(l ?? '').trim();
    if (isCountyLine(s)) return s.replace(/^(co\.?|contae|cont[ae])\s*/i, '').trim();
  }
  return '';
}

/* --- the sheet ---------------------------------------------------------- */

/** Find the header row: the first row within reach that names a roll column. */
function findHeader(rows) {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    if (rows[i].some((c) => COLUMNS.roll.some((re) => re.test(c)))) return i;
  }
  return -1;
}

function mapColumns(header) {
  const map = {};
  for (const [field, patterns] of Object.entries(COLUMNS)) {
    for (const re of patterns) {
      const at = header.findIndex((c) => re.test(c));
      if (at >= 0) { map[field] = at; break; }
    }
  }
  return map;
}

/**
 * Parse a workbook buffer into school records.
 *
 * Returns { schools, rejected, sheet, header, columns, sourceYear }. Rejections
 * carry the row number and the reason, because the interesting failure is not
 * "the import crashed" but "the import quietly took 640 of 721 schools".
 */
export function parseSchoolsWorkbook(buf) {
  const sheets = readWorkbook(buf);
  const sheet = sheets.find((s) => DATA_SHEET.test(s.name)) ?? sheets[0];
  if (!sheet) throw new Error('the workbook has no sheets');
  return parseSchoolRows(sheet.rows, sheet.name);
}

/**
 * The same parse, from rows already read.
 *
 * Split out so a CSV export of the sheet goes through identical code — the
 * header hunt, the column mapping, the rejections and the derivations are the
 * part worth having, and none of it is specific to .xlsx.
 */
export function parseSchoolRows(rows, sheetName = 'sheet 1') {
  const sheet = { name: sheetName, rows };

  const headerAt = findHeader(sheet.rows);
  if (headerAt < 0) {
    throw new Error(
      `no header row on sheet "${sheet.name}" — nothing in the first 25 rows names a ` +
        'Roll Number column. Is this the enrolment workbook?',
    );
  }
  const header = sheet.rows[headerAt];
  const columns = mapColumns(header);

  for (const required of ['roll', 'name']) {
    if (columns[required] === undefined) {
      throw new Error(
        `sheet "${sheet.name}" has no ${required} column. Headers seen: ` +
          header.filter(Boolean).join(' | '),
      );
    }
  }

  const cell = (r, field) => (columns[field] === undefined ? '' : String(r[columns[field]] ?? '').trim());

  const schools = [];
  const rejected = [];
  const seen = new Map();
  let sourceYear = '';

  for (let i = headerAt + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i];
    const line = i + 1; // 1-based, as a spreadsheet shows it
    const raw = {
      roll: cell(r, 'roll'),
      name: cell(r, 'name'),
      address1: cell(r, 'address1'),
      address2: cell(r, 'address2'),
      address3: cell(r, 'address3'),
      address4: cell(r, 'address4'),
      county: cell(r, 'county'),
      eircode: cell(r, 'eircode'),
      authority: cell(r, 'authority'),
      planning: cell(r, 'planning'),
    };

    if (!raw.roll && !raw.name) continue; // blank spacer row, not worth reporting

    // The workbook ends with a totals row: no name, and a row count where the
    // roll number goes. Both checks below catch it; both are kept, because the
    // next file might carry only one of the two shapes.
    if (!raw.name) {
      rejected.push({ line, roll: raw.roll, reason: 'no school name (totals or spacer row)' });
      continue;
    }
    const roll = raw.roll.toUpperCase();
    if (!ROLL.test(roll)) {
      rejected.push({ line, roll: raw.roll, reason: 'roll number is not five digits and a letter' });
      continue;
    }
    if (seen.has(roll)) {
      rejected.push({ line, roll, reason: `duplicate roll number, already used on line ${seen.get(roll)}` });
      continue;
    }
    seen.set(roll, line);

    const enrolmentRaw = cell(r, 'enrolment').replace(/,/g, '');
    const enrolment = /^[0-9]+$/.test(enrolmentRaw) ? Number(enrolmentRaw) : null;
    if (!sourceYear) sourceYear = academicYear(header, cell(r, 'year'), columns);

    schools.push({
      roll_number: roll,
      name: raw.name,
      town: deriveTown(raw, raw.name, raw.eircode),
      county: deriveCounty(raw),
      address: [raw.address1, raw.address2, raw.address3, raw.address4]
        .map((s) => s.trim())
        .filter((s) => s && !isNumericLine(s))
        .join(', ') || null,
      enrolment,
    });
  }

  return { schools, rejected, sheet: sheet.name, header, columns, sourceYear };
}

/**
 * The academic year the file describes, as "2025/2026".
 *
 * Taken from the enrolment column's header ("Total 2025-2026") in preference to
 * the Academic Year cell, which holds "2025" alone and so cannot say which
 * two-year span is meant without assuming.
 */
function academicYear(header, yearCell, columns) {
  const h = columns.enrolment !== undefined ? String(header[columns.enrolment] ?? '') : '';
  const span = /(\d{4})\s*[-/]\s*(\d{4})/.exec(h);
  if (span) return `${span[1]}/${span[2]}`;
  const short = /(\d{4})\s*[-/]\s*(\d{2})\b/.exec(h);
  if (short) return `${short[1]}/${short[1].slice(0, 2)}${short[2]}`;
  if (/^\d{4}$/.test(yearCell)) return `${yearCell}/${Number(yearCell) + 1}`;
  return '';
}
