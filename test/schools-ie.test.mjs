/* The school directory pipeline — the .xlsx reader, the parser, the labels.
 *
 * Run:  node test/schools-ie.test.mjs
 *
 * No browser, no database, no network, and no committed spreadsheet. The
 * workbook the Department publishes is not in this repo (see
 * scripts/import-schools.mjs for why), so the .xlsx reader is exercised against
 * a workbook this file builds byte by byte, and the parser against rows.
 *
 * The cases are not hypothetical. Every awkward one here is a row that is
 * actually in the 2025/2026 file: the totals row with a count where a roll
 * number goes, the schools whose town is only in the third address line, the
 * numeric county codes, the two Presentation Secondary Schools in Thurles that
 * nothing but a roll number separates, and — the one that cost the most — the
 * seven-letter town names an over-eager Eircode filter ate.
 */
import assert from 'node:assert';
import { deflateRawSync, crc32 } from 'node:zlib';
import { readWorkbook } from '../lib/schools-ie/xlsx.mjs';
import { parseSchoolRows } from '../lib/schools-ie/parse.mjs';
import { qualifyLabels, normaliseName } from '../lib/schools-ie/qualify.mjs';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}\n    ${e.message}`);
  }
}

/* ---------------------------------------------------------------------------
 * A real .xlsx, assembled here
 * ------------------------------------------------------------------------ */

/** Build a zip from { name -> string }, deflated, so the reader's real path runs. */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, comp);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/** A two-sheet workbook shaped like the Department's: notes first, data second. */
function workbook() {
  const strings = ['Roll Number', 'Official School Name', 'Address 1', 'Coláiste Eoin', 'Clonmel'];
  const si = strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('');

  const note = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Explanatory Note</t></is></c></row></sheetData></worksheet>`;
  const data =
    `<worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
    `<row r="2"><c r="A2" t="inlineStr"><is><t>60041D</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>` +
    `</sheetData></worksheet>`;

  return zip({
    'xl/workbook.xml':
      `<workbook xmlns:r="x"><sheets>` +
      `<sheet name="Explanatory Note" sheetId="2" r:id="rId1"/>` +
      `<sheet name="School Lists" sheetId="1" r:id="rId2"/>` +
      `</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<Relationships>` +
      `<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>` +
      `</Relationships>`,
    'xl/sharedStrings.xml': `<sst>${si}</sst>`,
    'xl/worksheets/sheet1.xml': note,
    'xl/worksheets/sheet2.xml': data,
  });
}

check('reads a deflated .xlsx and resolves sheets by name, not by position', () => {
  const sheets = readWorkbook(workbook());
  assert.deepStrictEqual(sheets.map((s) => s.name), ['Explanatory Note', 'School Lists']);
  // The data is on the SECOND sheet. Taking "the first sheet" would have read
  // the explanatory note, which is what the real workbook does to you.
  const rows = sheets[1].rows;
  assert.deepStrictEqual(rows[0], ['Roll Number', 'Official School Name', 'Address 1']);
  assert.deepStrictEqual(rows[1], ['60041D', 'Coláiste Eoin', 'Clonmel']);
});

check('shared strings, inline strings and non-ASCII names all survive', () => {
  const rows = readWorkbook(workbook())[1].rows;
  assert.strictEqual(rows[1][0], '60041D', 'inline string');
  assert.strictEqual(rows[1][1], 'Coláiste Eoin', 'shared string with a fada');
});

/* ---------------------------------------------------------------------------
 * The parser
 * ------------------------------------------------------------------------ */

const HEADER = [
  'Academic Year', 'Roll Number', 'Official School Name',
  'Address 1', 'Address 2', 'Address 3', 'Address 4',
  'County', 'Eircode', 'Local Authority', 'Total 2025-2026',
];

const row = (roll, name, a1, a2, a3, a4, county, eircode, la, total) =>
  ['2025', roll, name, a1, a2, a3, a4, county, eircode, la, total];

check('finds the header below preamble rows and reports the academic year', () => {
  const r = parseSchoolRows([
    ['Final Data for the 2025/2026 academic year', '', ''],
    [], [],
    HEADER,
    row('60010P', 'Loreto Secondary School', 'Brick Lane', 'Balbriggan', 'Co Dublin', '33', '', 'K32R248', 'Fingal County Council', '1220'),
  ]);
  assert.strictEqual(r.schools.length, 1);
  assert.strictEqual(r.sourceYear, '2025/2026');
  assert.strictEqual(r.schools[0].town, 'Balbriggan');
  assert.strictEqual(r.schools[0].county, 'Fingal');
  assert.strictEqual(r.schools[0].enrolment, 1220);
});

check('rejects the totals row rather than importing it as a school', () => {
  const r = parseSchoolRows([
    HEADER,
    row('60010P', 'Loreto Secondary School', 'Brick Lane', 'Balbriggan', 'Co Dublin', '33', '', 'K32R248', 'Fingal County Council', '1220'),
    // The real file's last row: a count where the roll number goes, no name.
    ['', '212416', '', '', '', '', '', '', '', '', '429653'],
  ]);
  assert.strictEqual(r.schools.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /no school name/);
});

check('rejects anything whose roll number is not five digits and a letter', () => {
  const r = parseSchoolRows([HEADER, row('1234', 'Nowhere College', 'X', '', '', '', '', '', '', '10')]);
  assert.strictEqual(r.schools.length, 0);
  assert.match(r.rejected[0].reason, /five digits and a letter/);
});

check('a seven-letter town is not mistaken for an Eircode', () => {
  // The bug this exists for: /^[A-Z0-9]{3}\s?[A-Z0-9]{4}$/ matches "Clonmel"
  // and "Thurles" as well as "Y35 XV70", and those two towns are the ONLY
  // thing separating two schools with the same name.
  const r = parseSchoolRows([
    HEADER,
    row('65340P', 'Presentation Secondary School', 'Clonmel', 'Co Tipperary', '2041', '', '', 'E91HY49', 'Tipperary (SR) County Council', '400'),
    row('65460C', 'Presentation Secondary School', 'Thurles', 'Co Tipperary', '2041', '', '', 'E41DF34', 'Tipperary (NR) County Council', '500'),
  ]);
  assert.deepStrictEqual(r.schools.map((s) => s.town), ['Clonmel', 'Thurles']);
});

check('a real Eircode in an address line IS dropped', () => {
  const r = parseSchoolRows([
    HEADER,
    row('63661C', 'Presentation Secondary School', "Grogan's Road", 'Co. Wexford', 'Y35 XV70', '1500', '', 'Y35XV70', 'Wexford County Council', '600'),
  ]);
  assert.strictEqual(r.schools[0].town, "Grogan's Road");
});

check('an address line that only repeats the school name is not the town', () => {
  const r = parseSchoolRows([
    HEADER,
    row('60030V', 'Blackrock College', 'Blackrock College', 'Rock Road', 'Co. Dublin', '33', '', 'A94FK84', 'Dun Laoghaire Rathdown', '1041'),
  ]);
  assert.strictEqual(r.schools[0].town, 'Rock Road');
});

check('county falls back to Local Authority, with council and riding stripped', () => {
  const r = parseSchoolRows([
    HEADER,
    row('11111A', 'A', 'Town', '', '', '', '', '', 'Tipperary (NR) County Council', '1'),
    row('22222B', 'B', 'Town', '', '', '', '', '', 'Cork City Council', '1'),
    row('33333C', 'C', 'Town', '', '', '', 'Kildare', '', 'Kildare County Council', '1'),
    row('44444D', 'D', 'Street', 'Co. Wexford', '', '', '', '', '', '1'),
  ]);
  assert.deepStrictEqual(r.schools.map((s) => s.county), ['Tipperary', 'Cork', 'Kildare', 'Wexford']);
});

check('a duplicate roll number is rejected, not silently overwritten', () => {
  const r = parseSchoolRows([
    HEADER,
    row('60010P', 'One', 'Town', '', '', '', '', '', '', '1'),
    row('60010P', 'Two', 'Town', '', '', '', '', '', '', '1'),
  ]);
  assert.strictEqual(r.schools.length, 1);
  assert.match(r.rejected[0].reason, /duplicate roll number/);
});

check('a missing Roll Number column is a thrown error, not an empty import', () => {
  assert.throws(
    () => parseSchoolRows([['Name', 'Town'], ['A', 'B']]),
    /no header row/,
  );
});

/* ---------------------------------------------------------------------------
 * The labels
 * ------------------------------------------------------------------------ */

const school = (roll, name, town, county = 'Somewhere') => ({ roll_number: roll, name, town, county });

check('a unique name is left alone', () => {
  const labels = qualifyLabels([school('60030V', 'Blackrock College', 'Blackrock')]);
  assert.strictEqual(labels.get('60030V'), 'Blackrock College');
});

check('a repeated name gains its town — and only the repeated one does', () => {
  const labels = qualifyLabels([
    school('11111A', 'Loreto Secondary School', 'Balbriggan'),
    school('22222B', 'Loreto Secondary School', 'Bray'),
    school('33333C', 'Blackrock College', 'Blackrock'),
  ]);
  assert.strictEqual(labels.get('11111A'), 'Loreto Secondary School, Balbriggan');
  assert.strictEqual(labels.get('22222B'), 'Loreto Secondary School, Bray');
  assert.strictEqual(labels.get('33333C'), 'Blackrock College');
});

check('same name AND same town falls through to the roll number', () => {
  const labels = qualifyLabels([
    school('65240L', 'Presentation Secondary School', 'Thurles'),
    school('65460C', 'Presentation Secondary School', 'Thurles'),
    school('61380H', 'Presentation Secondary School', 'Listowel'),
  ]);
  assert.strictEqual(labels.get('65240L'), 'Presentation Secondary School, Thurles (65240L)');
  assert.strictEqual(labels.get('65460C'), 'Presentation Secondary School, Thurles (65460C)');
  // The third one collided on name but not on town, so it must NOT have been
  // dragged up to the roll-number tier with the other two.
  assert.strictEqual(labels.get('61380H'), 'Presentation Secondary School, Listowel');
});

check('a school with no town is qualified by county instead', () => {
  const labels = qualifyLabels([
    { roll_number: '11111A', name: 'Scoil Mhuire', town: '', county: 'Cork' },
    { roll_number: '22222B', name: 'Scoil Mhuire', town: '', county: 'Clare' },
  ]);
  assert.strictEqual(labels.get('11111A'), 'Scoil Mhuire, Cork');
  assert.strictEqual(labels.get('22222B'), 'Scoil Mhuire, Clare');
});

check('names differing only by punctuation or "Saint" collide', () => {
  assert.strictEqual(normaliseName("St Mary's Secondary School"), normaliseName('St Marys Secondary School'));
  assert.strictEqual(normaliseName('Saint Josephs'), normaliseName("St Joseph's"));
  const labels = qualifyLabels([
    school('11111A', "St Mary's Secondary School", 'Cork'),
    school('22222B', 'St Marys Secondary School', 'Mayo'),
  ]);
  assert.strictEqual(labels.get('11111A'), "St Mary's Secondary School, Cork");
  assert.strictEqual(labels.get('22222B'), 'St Marys Secondary School, Mayo');
});

check('every label in a list is unique, whatever the input', () => {
  const rows = [
    school('11111A', 'Scoil Mhuire', ''),
    school('22222B', 'Scoil Mhuire', ''),
    school('33333C', 'Scoil Mhuire', ''),
  ].map((s) => ({ ...s, county: '' }));
  const labels = qualifyLabels(rows);
  assert.strictEqual(new Set(labels.values()).size, 3);
  // No town and no county leaves the roll number as the only distinguisher.
  assert.strictEqual(labels.get('11111A'), 'Scoil Mhuire (11111A)');
});

if (failures) {
  console.log(`\n✗ ${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
