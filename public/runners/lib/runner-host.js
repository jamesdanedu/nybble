/* ===========================================================================
 * runner-host.js — the portal side of the runner protocol.
 *
 *   const slot = mountRunner(containerEl, {
 *     entryUrl: '/runners/mcq/index.html',
 *     stepId: 'q1',
 *     config: { ... },            // PUBLIC config only — never answer keys
 *     state:  savedState,
 *     context: activity.shared_context,
 *     mode: 'attempt',            // attempt | review | preview
 *     onState:  state => saveDraft(stepId, state),      // already debounced
 *     onSubmit: payload => submitStep(stepId, payload),
 *     onLog:    entry => console.debug(entry)
 *   });
 *
 *   slot.requestSubmit();   // e.g. from the portal's own "Submit" button
 *   slot.destroy();
 * ======================================================================== */
(function (global) {
  'use strict';

  var CHANNEL = 'sap-runner-v1';
  var STATE_DEBOUNCE_MS = 800;

  function mountRunner(container, opts) {
    opts = opts || {};

    var iframe = document.createElement('iframe');
    // Opaque origin: the runner gets scripts and forms, nothing else. No
    // allow-same-origin — that would hand it the portal's session.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    iframe.setAttribute('title', opts.title || 'Activity');
    iframe.setAttribute('loading', 'eager');
    iframe.style.cssText = 'width:100%;border:0;display:block;min-height:220px;';
    iframe.src = opts.entryUrl;

    var ready = false;
    var destroyed = false;
    var stateTimer = null;
    var pendingState = null;

    function send(type, payload) {
      if (destroyed || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        Object.assign({ channel: CHANNEL, type: type }, payload || {}),
        '*'
      );
    }

    function flushState() {
      clearTimeout(stateTimer);
      stateTimer = null;
      if (pendingState !== null) {
        var s = pendingState;
        pendingState = null;
        opts.onState && opts.onState(s);
      }
    }

    function onMessage(event) {
      // Authenticate the peer by window identity — sandboxed frames have an
      // opaque ("null") origin, so an origin string proves nothing here.
      if (destroyed || event.source !== iframe.contentWindow) return;
      var msg = event.data;
      if (!msg || msg.channel !== CHANNEL) return;

      switch (msg.type) {
        case 'ready':
          ready = true;
          slot.capabilities = msg.capabilities || {};
          send('init', {
            stepId: opts.stepId,
            config: opts.config || {},
            state: opts.state || null,
            context: opts.context || {},
            mode: opts.mode || 'attempt',
            response: opts.response || null,
            score: opts.score || null
          });
          opts.onReady && opts.onReady(slot.capabilities);
          break;

        case 'state':
          pendingState = msg.state;
          clearTimeout(stateTimer);
          stateTimer = setTimeout(flushState, STATE_DEBOUNCE_MS);
          break;

        case 'submit':
          flushState(); // never let a stale draft land after the submission
          opts.onSubmit && opts.onSubmit({
            stepId: opts.stepId,
            response: msg.response,
            clientScore: msg.clientScore,
            maxScore: msg.maxScore
          });
          break;

        case 'resize':
          var h = Number(msg.height);
          if (h > 0 && h < 20000) iframe.style.height = h + 'px';
          break;

        case 'log':
          opts.onLog && opts.onLog({ level: msg.level, message: msg.message });
          break;
      }
    }

    global.addEventListener('message', onMessage);
    container.appendChild(iframe);

    var slot = {
      iframe: iframe,
      capabilities: {},
      isReady: function () { return ready; },
      requestSubmit: function () { send('requestSubmit', {}); },
      setMode: function (mode) { send('setMode', { mode: mode }); },
      destroy: function () {
        destroyed = true;
        clearTimeout(stateTimer);
        global.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }
    };
    return slot;
  }

  global.mountRunner = mountRunner;
})(window);
