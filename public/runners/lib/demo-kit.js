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
    },

    freetext: {
      runnerId: 'freetext',
      entryUrl: '/runners/freetext/index.html',
      name: 'Written answer',
      // A PRIMM Make step, so the sample exercises the two things that make
      // this runner more than a textarea: the shared code snippet, and an
      // earlier step quoted back out of context.prior.
      context: {
        code: 'def total(numbers):\n    runningTotal = 0\n    for n in numbers:\n        runningTotal = runningTotal + n\n    return runningTotal\n\nprint(total([3, 1, 4]))',
        prior: {
          predict: { text: 'I think it prints 8, because it adds the numbers up.' }
        }
      },
      config: {
        title: 'Make',
        prompt: 'Write a function of your own that finds the LARGEST number in a list, ' +
                'using the same accumulator pattern as the one above.\n\n' +
                'Explain in a sentence why your starting value works.',
        instructions: 'Your teacher marks this one by hand.',
        showContextCode: true,
        placeholder: 'def largest(numbers):',
        rows: 8,
        minChars: 40,
        showPrior: { stepId: 'predict', label: 'What you predicted', field: 'text' }
      },
      key: {}   // hand-marked; there is no answer to hide
    },

    parsons: {
      runnerId: 'parsons',
      entryUrl: '/runners/parsons/index.html',
      name: 'Parsons problem',
      config: {
        title: 'Sum a list of numbers',
        instructions: 'Put the lines in order and set the indentation of each one. ' +
                      'Two of the lines do not belong in the finished program.',
        language: 'python',
        indentSize: 4,
        maxIndent: 5,
        lines: [
          { id: 'l1', text: 'def total(numbers):' },
          { id: 'l2', text: 'runningTotal = 0' },
          { id: 'l3', text: 'for n in numbers:' },
          { id: 'l4', text: 'runningTotal = runningTotal + n' },
          { id: 'l5', text: 'return runningTotal' },
          { id: 'd1', text: 'return n' },
          { id: 'd2', text: 'runningTotal = runningTotal + numbers' }
        ]
      },
      key: {
        solution: [
          { id: 'l1', indent: 0 },
          { id: 'l2', indent: 1 },
          { id: 'l3', indent: 1 },
          { id: 'l4', indent: 2 },
          { id: 'l5', indent: 1 }
        ],
        distractors: ['d1', 'd2'],
        marks: 5,
        partial: true,
        distractorPenalty: 0.5,
        explanation: 'The accumulator has to be initialised before the loop, ' +
                     'and the return has to be outside it.'
      }
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

  /* Mirror of supabase/functions/score/parsons.ts — keep the two in step. */
  var ORDER_WEIGHT = 0.7, INDENT_WEIGHT = 0.3;

  /* LCS returning matched index pairs, so we know WHICH lines are in order and
     which solution line each one lines up with. See parsons.ts for the why. */
  function lcsPairs(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1)); dp[i].fill(0); }
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1
                                 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var pairs = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return pairs;
  }

  function scoreParsons(config, key, response) {
    var maxIndent = typeof config.maxIndent === 'number' ? config.maxIndent : 12;
    function clamp(n) { return Math.max(0, Math.min(maxIndent, Math.round(Number(n) || 0))); }

    var solution = (key.solution || []).map(function (s) {
      return { id: String(s.id), indent: clamp(s.indent) };
    });
    var arrangement = (response.arrangement || []).map(function (a) {
      return { id: String(a.id), indent: clamp(a.indent) };
    });

    var marks = typeof key.marks === 'number' ? key.marks : solution.length;
    var partial = key.partial === true;
    var penalty = typeof key.distractorPenalty === 'number' ? key.distractorPenalty : 0;

    var solIds = solution.map(function (s) { return s.id; });
    var givenIds = arrangement.map(function (a) { return a.id; });
    var pairs = lcsPairs(givenIds, solIds);
    var orderScore = solIds.length ? pairs.length / solIds.length : 0;

    var matchOf = {}, indentMatches = 0;
    pairs.forEach(function (p) {
      matchOf[p[0]] = p[1];
      if (arrangement[p[0]].indent === solution[p[1]].indent) indentMatches++;
    });
    var indentScore = pairs.length ? indentMatches / pairs.length : 0;

    var distractorsUsed = givenIds.filter(function (id) { return solIds.indexOf(id) === -1; });
    var missing = solIds.filter(function (id) { return givenIds.indexOf(id) === -1; });

    var exact = solIds.length > 0 && givenIds.length === solIds.length &&
      arrangement.every(function (a, i) {
        return a.id === solution[i].id && a.indent === solution[i].indent;
      });

    var total;
    if (exact) total = marks;
    else if (!partial) total = 0;
    else {
      total = Math.max(0, marks * (ORDER_WEIGHT * orderScore + INDENT_WEIGHT * indentScore) -
                          penalty * distractorsUsed.length);
    }

    var perLine = arrangement.map(function (a, i) {
      var si = matchOf[i];
      var distractor = solIds.indexOf(a.id) === -1;
      var keyIdx = solIds.indexOf(a.id);
      return {
        id: a.id, indent: a.indent, distractor: distractor,
        inSequence: si !== undefined,
        indentOk: si !== undefined && a.indent === solution[si].indent,
        expectedIndent: distractor ? null : solution[keyIdx].indent
      };
    });

    return {
      total: Math.round(total * 100) / 100, max: marks, exact: exact,
      orderScore: Math.round(orderScore * 100) / 100,
      indentScore: Math.round(indentScore * 100) / 100,
      distractorsUsed: distractorsUsed, missing: missing,
      perLine: perLine, solution: solution, explanation: key.explanation
    };
  }

  /** Mark one submitted step the way the Edge Function would. */
  function scoreStep(sampleId, config, seed, response) {
    var s = SAMPLES[sampleId];
    if (s.runnerId === 'mcq') return scoreMcq(config, s.key, response);
    if (s.runnerId === 'numbase') return scoreNumbase(config, seed, response);
    if (s.runnerId === 'parsons') return scoreParsons(config, s.key, response);
    // freetext is registered scorer:'manual'. The Edge Function returns a null
    // total for those and routes the attempt to the review queue, so the demo
    // shows the same thing rather than inventing a mark nobody awarded.
    if (s.runnerId === 'freetext') {
      return { total: null, max: null, manual: true, perQuestion: {},
               chars: String((response && response.text) || '').trim().length };
    }
    throw new Error('no demo scorer for ' + s.runnerId);
  }

  global.DemoKit = { SAMPLES: SAMPLES, scoreStep: scoreStep };
})(window);
