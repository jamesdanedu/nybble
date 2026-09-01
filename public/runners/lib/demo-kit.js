/* ===========================================================================
 * demo-kit.js — sample activities and client-side marking, for the DEMO and
 * HARNESS pages only.
 *
 * ⚠ This file contains answer keys in plain JavaScript. It exists so the demo
 * pages can close the submit → mark → review loop with no database. The real
 * portal must never load it: keys live in the `activity_keys` table and marking
 * happens in the `score` Edge Function.
 * ======================================================================== */
(function (global) {
  'use strict';

  var SAMPLES = {
    mcq: {
      runnerId: 'mcq',
      entryUrl: '/runners/mcq/index.html',
      name: 'Multiple choice',
      config: {
        title: 'Data Representation — quick check',
        instructions: 'Choose the best answer for each question.',
        shuffleOptions: true,
        questions: [
          { id: 'q1', marks: 1,
            stem: 'How many distinct values can be represented with 8 bits?',
            options: [ {id:'a',text:'8'}, {id:'b',text:'128'},
                       {id:'c',text:'255'}, {id:'d',text:'256'} ] },
          { id: 'q2', marks: 1,
            stem: 'What is printed by this code?',
            code: 'x = 0b1010\ny = 0x0A\nprint(x == y)',
            options: [ {id:'a',text:'True',code:true}, {id:'b',text:'False',code:true},
                       {id:'c',text:'TypeError',code:true}, {id:'d',text:'10',code:true} ] },
          { id: 'q3', marks: 2, multiple: true,
            stem: 'Which of these are valid hexadecimal digits? Select all that apply.',
            options: [ {id:'a',text:'9'}, {id:'b',text:'A'},
                       {id:'c',text:'G'}, {id:'d',text:'F'} ] }
        ]
      },
      key: {
        q1: { correct: ['d'], marks: 1,
              explanation: '2^8 = 256 distinct values, 0 to 255 inclusive.' },
        q2: { correct: ['a'], marks: 1,
              explanation: '0b1010 and 0x0A are both the integer 10 — the literal notation does not change the value.' },
        q3: { correct: ['a','b','d'], marks: 2, partial: true,
              explanation: 'Hex digits are 0-9 and A-F. G is not one of them.' }
      }
    },

    numbase: {
      runnerId: 'numbase',
      entryUrl: '/runners/numbase/index.html',
      name: 'Binary & hex conversion',
      config: {
        title: 'Binary & Hex — weekly test',
        count: 6,
        conversions: ['dec2bin','bin2dec','dec2hex','hex2dec','bin2hex'],
        minValue: 5, maxValue: 255,
        marksPerQuestion: 1,
        timeLimitSecs: 300,
        showPlaceValues: true
      },
      key: {}   // generated questions need no stored key
    }
  };

  function scoreMcq(config, key, response) {
    var answers = response.answers || {};
    var perQuestion = {}, total = 0, max = 0;
    (config.questions || []).forEach(function (q) {
      var k = key[q.id] || {};
      var marks = k.marks != null ? k.marks : (q.marks != null ? q.marks : 1);
      max += marks;
      var correctIds = k.correct || [];
      var chosen = answers[q.id] || [];
      var hits = chosen.filter(function (c) { return correctIds.indexOf(c) !== -1; }).length;
      var misses = chosen.filter(function (c) { return correctIds.indexOf(c) === -1; }).length;
      var exact = hits === correctIds.length && misses === 0 && correctIds.length > 0;
      var awarded = 0;
      if (exact) awarded = marks;
      else if (k.partial && q.multiple && correctIds.length) {
        awarded = Math.max(0, Math.round(((hits - misses) / correctIds.length) * marks * 100) / 100);
      }
      total += awarded;
      perQuestion[q.id] = { correct: exact, awarded: awarded, marks: marks,
                            chosen: chosen, correctIds: correctIds,
                            explanation: k.explanation };
    });
    return { total: total, max: max, perQuestion: perQuestion };
  }

  function scoreNumbase(config, seed, response) {
    var questions = global.NumbaseGen.generate(config, seed);
    var answers = response.answers || {};
    var perQuestion = {}, total = 0, max = 0;
    questions.forEach(function (q) {
      var marks = q.marks || 1;
      max += marks;
      var given = String(answers[q.id] == null ? '' : answers[q.id]);
      var correct = global.NumbaseGen.isCorrect(q, given);
      var awarded = correct ? marks : 0;
      total += awarded;
      perQuestion[q.id] = { correct: correct, awarded: awarded, marks: marks,
                            given: given,
                            expected: global.NumbaseGen.expected(q, false) };
    });
    return { total: total, max: max, perQuestion: perQuestion,
             elapsedSecs: response.elapsedSecs };
  }

  /** Mark one submitted step the way the Edge Function would. */
  function scoreStep(sampleId, config, seed, response) {
    var s = SAMPLES[sampleId];
    if (s.runnerId === 'mcq') return scoreMcq(config, s.key, response);
    if (s.runnerId === 'numbase') return scoreNumbase(config, seed, response);
    throw new Error('no demo scorer for ' + s.runnerId);
  }

  global.DemoKit = { SAMPLES: SAMPLES, scoreStep: scoreStep };
})(window);
