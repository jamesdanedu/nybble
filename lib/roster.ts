import { isValidUsername, usernameFromName } from '@/lib/auth-identity';

/* ---------------------------------------------------------------------------
 * Turn whatever a teacher pastes into a list of students.
 *
 * What actually gets pasted, in order of likelihood:
 *   - one name per line, copied out of a Word document
 *   - two columns from a spreadsheet (name TAB username)
 *   - a CSV export from the school MIS, possibly with a header row
 *
 * All three are handled by the same parser, and the same parser runs in the
 * browser (to draw the preview) and on the server (to do the work), so what the
 * teacher sees in the preview is exactly what gets created.
 * ------------------------------------------------------------------------ */

export interface RosterRow {
  displayName: string;
  /** Explicit username from a second column, if there was one. */
  username: string | null;
  /** Problem with this line. The row is still returned, so it can be shown. */
  error: string | null;
  /** 1-based line number in the pasted text, for the error message. */
  line: number;
}

const HEADER_WORDS = ['name', 'student', 'display name', 'full name', 'pupil'];

/** Split one line on comma, tab or semicolon, honouring simple double quotes. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (ch === ',' || ch === '\t' || ch === ';')) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseRoster(text: string): RosterRow[] {
  const lines = text.split(/\r?\n/);
  const rows: RosterRow[] = [];
  let checkedHeader = false;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    const cells = splitLine(line).filter((c) => c.length > 0);
    if (!cells.length) return;

    // Drop a header row, but only if it is the first non-empty line — "Name" is
    // a plausible surname and we should not silently drop a real student.
    if (!checkedHeader) {
      checkedHeader = true;
      if (HEADER_WORDS.includes(cells[0].toLowerCase())) return;
    }

    const displayName = cells[0];
    const explicit = cells[1] ? cells[1].toLowerCase() : null;

    let error: string | null = null;
    if (displayName.length < 2) {
      error = 'Too short to be a name.';
    } else if (explicit && !isValidUsername(explicit)) {
      error = `"${explicit}" is not a usable username (letters, numbers, dot, dash, underscore; 3–40 characters).`;
    }

    rows.push({ displayName, username: explicit, error, line: i + 1 });
  });

  return rows;
}

/**
 * Assign a final username to every row, avoiding collisions with each other and
 * with `taken`. Deterministic given the same input and the same `taken` set,
 * which is what lets the preview and the real run agree.
 */
export function assignUsernames(
  rows: RosterRow[],
  taken: Set<string>,
): { row: RosterRow; username: string }[] {
  const used = new Set(taken);
  return rows.map((row) => {
    const base = row.username ?? usernameFromName(row.displayName);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      const suffix = String(n++);
      candidate = base.slice(0, 40 - suffix.length) + suffix;
    }
    used.add(candidate);
    return { row, username: candidate };
  });
}
