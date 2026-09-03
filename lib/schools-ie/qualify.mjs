/* ===========================================================================
 * qualify.mjs — telling same-named schools apart.
 *
 * Irish school names are not unique and not close to it. In the 2025/2026
 * Department file there are 44 names shared by more than one school, covering
 * 138 of the 721 schools: "Presentation Secondary School" is eleven different
 * schools, "St Mary's Secondary School" is nine, "Loreto Secondary School" is
 * eight. A picker that shows names alone asks the user to choose between
 * eleven identical rows.
 *
 * So a label is qualified only as far as it has to be. Three tiers:
 *
 *   1. name                          unique already — say nothing more
 *   2. name, place                   place = town, or county when no town
 *   3. name, place (roll number)     when even that collides
 *
 * Escalating per name rather than across the board matters: qualifying every
 * school would put a town beside 583 names that never needed one, which is
 * noise on 81% of the list to fix 19% of it.
 *
 * Tier 3 is the guarantee, not the common case. The roll number is the
 * Department's own identifier and is unique by construction, so a label can
 * always be made unambiguous. Against the 2025/2026 file tier 3 is never
 * reached — town separates all 44 groups — but "the current file does not need
 * it" is not a property to build on, because next year's file is not this one.
 * ======================================================================== */

/**
 * Compare names the way a person would: case, punctuation and spacing are not
 * differences, and "Saint" and "St" are the same word.
 *
 * This is deliberately aggressive, because it decides whether two schools
 * COLLIDE, and a missed collision ships two identical-looking rows while a
 * false collision only adds a town that was not strictly needed. Erring toward
 * collision is the cheaper mistake.
 */
export function normaliseName(s) {
  return String(s ?? '')
    .toLowerCase()
    // Apostrophes are DELETED, not turned into a space, so that "St Mary's"
    // and "St Marys" — both spellings are in the Department's own file —
    // normalise to the same string. Turning them into a space gives
    // "st mary s" against "st marys", and the two never collide, which is how
    // nine identically-named schools would have shipped unqualified.
    .replace(/['\u2018\u2019\u02bc]/g, '')
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The place shown beside a name: the town, or the county when there is none. */
export function placeOf(school) {
  return (school.town || school.county || '').trim();
}

/**
 * Label every school in a list, qualifying only where names collide.
 *
 * Returns a Map keyed by roll number. Takes the whole list rather than one
 * school because "is this name ambiguous" is a question about the list — the
 * same school is "Loreto Secondary School" in one result set and "Loreto
 * Secondary School, Balbriggan" in another, and that is correct.
 */
export function qualifyLabels(schools) {
  const byName = new Map();
  for (const s of schools) {
    const k = normaliseName(s.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(s);
  }

  const labels = new Map();
  for (const group of byName.values()) {
    if (group.length === 1) {
      labels.set(group[0].roll_number, group[0].name);
      continue;
    }

    // Second tier: add the place. Only escalate the ones still colliding after
    // it, so two of eleven needing a roll number does not put a roll number on
    // the other nine.
    const byPlace = new Map();
    for (const s of group) {
      const k = `${normaliseName(s.name)}|${normaliseName(placeOf(s))}`;
      if (!byPlace.has(k)) byPlace.set(k, []);
      byPlace.get(k).push(s);
    }

    for (const sameplace of byPlace.values()) {
      for (const s of sameplace) {
        const place = placeOf(s);
        const base = place ? `${s.name}, ${place}` : s.name;
        labels.set(s.roll_number, sameplace.length === 1 ? base : `${base} (${s.roll_number})`);
      }
    }
  }
  return labels;
}
