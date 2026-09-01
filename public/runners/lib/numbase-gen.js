/* ===========================================================================
 * numbase-gen.js — deterministic question generator for the number base runner.
 *
 * ⚠ KEEP IN SYNC with the copy inside supabase/functions/score/numbase.ts.
 * The scorer regenerates the question set from the attempt seed and compares it
 * against the set the student was actually shown; a mismatch is flagged rather
 * than silently mismarked, so drift between the two copies surfaces loudly.
 * ======================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NumbaseGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var KINDS = {
    dec2bin: { from: 10, to: 2,  label: 'Decimal → Binary' },
    bin2dec: { from: 2,  to: 10, label: 'Binary → Decimal' },
    dec2hex: { from: 10, to: 16, label: 'Decimal → Hex' },
    hex2dec: { from: 16, to: 10, label: 'Hex → Decimal' },
    bin2hex: { from: 2,  to: 16, label: 'Binary → Hex' },
    hex2bin: { from: 16, to: 2,  label: 'Hex → Binary' }
  };

  var BASE_NAME = { 2: 'binary', 10: 'decimal', 16: 'hexadecimal' };

  function show(value, base, padBinary) {
    var s = value.toString(base).toUpperCase();
    if (base === 2 && padBinary) {
      var width = Math.ceil(Math.max(s.length, 4) / 4) * 4;   // 4, 8, 12, 16 …
      while (s.length < width) s = '0' + s;
    }
    return s;
  }

  /** Normalise a student answer so 0x0F, 0F and f all compare equal to F. */
  function normalise(answer, base) {
    var s = String(answer == null ? '' : answer).trim().toUpperCase();
    s = s.replace(/\s+/g, '');
    if (base === 16) s = s.replace(/^0X/, '').replace(/^#/, '');
    if (base === 2)  s = s.replace(/^0B/, '');
    s = s.replace(/^0+(?=.)/, '');            // strip leading zeros, keep a lone 0
    return s;
  }

  var VALID = { 2: /^[01]+$/, 10: /^\d+$/, 16: /^[0-9A-F]+$/ };

  function isWellFormed(answer, base) {
    var s = normalise(answer, base);
    return s.length > 0 && VALID[base].test(s);
  }

  /**
   * Generate the question set. Same (config, seed) always yields the same set.
   * @returns {Array<{id,kind,label,fromBase,toBase,prompt,value,marks}>}
   */
  function generate(config, seed) {
    var cfg = config || {};
    var kinds = (cfg.conversions && cfg.conversions.length)
      ? cfg.conversions.filter(function (k) { return KINDS[k]; })
      : ['dec2bin', 'bin2dec', 'dec2hex', 'hex2dec'];
    if (!kinds.length) kinds = ['dec2bin'];

    var count = Math.max(1, Math.min(100, cfg.count || 10));
    var min = Math.max(0, cfg.minValue == null ? 1 : cfg.minValue);
    var max = Math.max(min, cfg.maxValue == null ? 255 : cfg.maxValue);
    var pad = cfg.padBinary !== false;

    var rnd = mulberry32(seed);
    var out = [], seen = {}, guard = 0;

    while (out.length < count && guard++ < count * 60) {
      var kind = kinds[Math.floor(rnd() * kinds.length)];
      var value = min + Math.floor(rnd() * (max - min + 1));
      var key = kind + ':' + value;
      if (seen[key]) continue;
      seen[key] = 1;

      var spec = KINDS[kind];
      out.push({
        id: 'n' + out.length,
        kind: kind,
        label: spec.label,
        fromBase: spec.from,
        toBase: spec.to,
        fromName: BASE_NAME[spec.from],
        toName: BASE_NAME[spec.to],
        prompt: show(value, spec.from, pad),
        value: value,                       // the decimal truth behind the question
        marks: cfg.marksPerQuestion || 1
      });
    }
    return out;
  }

  /** The expected answer string for a generated question. */
  function expected(question, padBinary) {
    return show(question.value, question.toBase, padBinary !== false);
  }

  function isCorrect(question, answer) {
    if (!isWellFormed(answer, question.toBase)) return false;
    return normalise(answer, question.toBase) ===
           normalise(expected(question, false), question.toBase);
  }

  return {
    generate: generate,
    expected: expected,
    isCorrect: isCorrect,
    normalise: normalise,
    isWellFormed: isWellFormed,
    show: show,
    mulberry32: mulberry32,
    KINDS: KINDS
  };
});
