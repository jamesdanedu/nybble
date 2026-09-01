/* ===========================================================================
 * runner-sdk.js — loaded INSIDE a runner iframe.
 *
 * A runner is a self-contained HTML page that presents one step of an activity
 * and hands back a response. It knows nothing about the database, the student,
 * or how it will be marked. That is the whole point: any HTML tool that speaks
 * this protocol can be dropped into the portal without redeploying the portal.
 *
 * Protocol version: sap-runner-v1
 *
 *   host   -> runner   init          { stepId, config, state, context, mode, response, score }
 *                      requestSubmit {}
 *                      setMode       { mode }
 *   runner -> host     ready         { capabilities }
 *                      state         { state }
 *                      submit        { response, clientScore, maxScore }
 *                      resize        { height }
 *                      log           { level, message }
 *
 * Trust model: the runner runs in a sandboxed iframe with an opaque origin, so
 * neither side can rely on an origin string. Both sides authenticate the peer
 * by window identity instead — the runner only accepts messages whose
 * event.source is window.parent, the host only accepts messages whose
 * event.source is that iframe's contentWindow.
 *
 * clientScore is ADVISORY. The portal recomputes any score that counts on the
 * server, because everything in this file is under the student's control.
 * ======================================================================== */
(function (global) {
  'use strict';

  var CHANNEL = 'sap-runner-v1';
  var handlers = {};
  var started = false;
  var initialised = false;
  var resizeObserver = null;
  var lastHeight = 0;

  function post(type, payload) {
    if (global.parent === global) return; // running standalone, nothing to talk to
    global.parent.postMessage(
      Object.assign({ channel: CHANNEL, type: type }, payload || {}),
      '*'
    );
  }

  function onMessage(event) {
    // Authenticate by window identity, not origin (sandboxed frames are opaque).
    if (event.source !== global.parent) return;
    var msg = event.data;
    if (!msg || msg.channel !== CHANNEL) return;

    switch (msg.type) {
      case 'init':
        if (initialised) return; // init is once-only
        initialised = true;
        try {
          handlers.onInit && handlers.onInit({
            stepId: msg.stepId,
            config: msg.config || {},
            state: msg.state || null,
            context: msg.context || {},
            mode: msg.mode || 'attempt',
            response: msg.response || null,
            score: msg.score || null
          });
        } catch (err) {
          Runner.log('error', 'onInit threw: ' + (err && err.message));
        }
        Runner.measure();
        break;

      case 'requestSubmit':
        if (!handlers.onRequestSubmit) {
          Runner.log('warn', 'host requested submit but runner has no onRequestSubmit');
          return;
        }
        try {
          var out = handlers.onRequestSubmit();
          if (out && typeof out === 'object' && 'response' in out) {
            Runner.submit(out.response, out);
          } else if (out !== undefined && out !== null) {
            Runner.submit(out);
          }
        } catch (err) {
          Runner.log('error', 'onRequestSubmit threw: ' + (err && err.message));
        }
        break;

      case 'setMode':
        handlers.onModeChange && handlers.onModeChange(msg.mode);
        break;
    }
  }

  var Runner = {
    /**
     * Start the runner and tell the host we are ready for init.
     * @param {object} h
     * @param {function} h.onInit           ({ stepId, config, state, context, mode, response, score })
     * @param {function} [h.onRequestSubmit] () => response | { response, clientScore, maxScore }
     * @param {function} [h.onModeChange]   (mode)
     * @param {object}  [h.capabilities]    { selfSubmit: bool, autoScore: bool, timed: bool }
     */
    start: function (h) {
      if (started) return Runner;
      started = true;
      handlers = h || {};
      global.addEventListener('message', onMessage);
      post('ready', { capabilities: handlers.capabilities || {} });
      Runner.watchSize();
      return Runner;
    },

    /** Autosave. Called freely — the host debounces before it hits the network. */
    saveState: function (state) {
      post('state', { state: state });
    },

    /**
     * Hand the response back. `clientScore`/`maxScore` are a convenience for
     * practice mode only; anything summative is rescored server-side.
     */
    submit: function (response, opts) {
      opts = opts || {};
      post('submit', {
        response: response,
        clientScore: typeof opts.clientScore === 'number' ? opts.clientScore : null,
        maxScore: typeof opts.maxScore === 'number' ? opts.maxScore : null
      });
    },

    log: function (level, message) {
      post('log', { level: level || 'info', message: String(message) });
    },

    /** Report our height so the host can size the iframe. */
    measure: function () {
      var h = Math.ceil(
        Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        )
      );
      if (h && h !== lastHeight) {
        lastHeight = h;
        post('resize', { height: h });
      }
    },

    watchSize: function () {
      if (resizeObserver || typeof ResizeObserver === 'undefined') return;
      var tick = null;
      resizeObserver = new ResizeObserver(function () {
        clearTimeout(tick);
        tick = setTimeout(Runner.measure, 50);
      });
      var attach = function () {
        if (document.body) resizeObserver.observe(document.body);
      };
      if (document.body) attach();
      else document.addEventListener('DOMContentLoaded', attach);
      global.addEventListener('load', Runner.measure);
    },

    /** Deterministic RNG (mulberry32) so a seed reproduces a question set. */
    rng: function (seed) {
      var a = (seed >>> 0) || 1;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    CHANNEL: CHANNEL
  };

  global.Runner = Runner;
})(window);
