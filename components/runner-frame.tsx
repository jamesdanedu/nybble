'use client';

import { useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
 * React wrapper around the EXISTING host helper, public/runners/lib/runner-host.js.
 *
 * This component does not implement the postMessage protocol. It loads that
 * file and calls `mountRunner`. That matters for two reasons:
 *
 *   1. The protocol's trust model (authenticate the peer by window identity,
 *      because a sandboxed frame has an opaque origin) and its 800 ms state
 *      debounce are already implemented and already tested by
 *      test/harness.test.mjs. A second implementation in React would be a
 *      second thing to get subtly wrong.
 *   2. runner-host.js is served from public/ at a stable URL, so a runner and
 *      the host helper stay in lockstep without a portal redeploy — which is
 *      the entire point of the runner registry.
 *
 * The iframe's sandbox attribute is set inside mountRunner and is deliberately
 * NOT `allow-same-origin`; do not add it here.
 * ------------------------------------------------------------------------ */

export interface RunnerCapabilities {
  selfSubmit?: boolean;
  autoScore?: boolean;
  timed?: boolean;
}

export interface RunnerSubmitPayload {
  stepId: string;
  response: unknown;
  clientScore: number | null;
  maxScore: number | null;
}

export interface RunnerSlot {
  iframe: HTMLIFrameElement;
  capabilities: RunnerCapabilities;
  isReady(): boolean;
  requestSubmit(): void;
  setMode(mode: string): void;
  destroy(): void;
}

declare global {
  interface Window {
    mountRunner?: (
      container: HTMLElement,
      opts: Record<string, unknown>,
    ) => RunnerSlot;
  }
}

const HOST_SCRIPT_URL = '/runners/lib/runner-host.js';

/** Load runner-host.js once per document and resolve when `mountRunner` exists. */
function loadRunnerHost(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.mountRunner) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${HOST_SCRIPT_URL}"]`,
  );
  const script = existing ?? document.createElement('script');
  const promise = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`Could not load ${HOST_SCRIPT_URL}`)),
      { once: true },
    );
  });
  if (!existing) {
    script.src = HOST_SCRIPT_URL;
    script.async = true;
    document.head.appendChild(script);
  }
  return promise;
}

export interface RunnerFrameProps {
  entryUrl: string;
  stepId: string;
  config: Record<string, unknown>;
  context?: Record<string, unknown>;
  state?: unknown;
  mode?: 'attempt' | 'review' | 'preview';
  /** Populated in review mode so the runner can show the marking alongside. */
  response?: unknown;
  score?: unknown;
  title?: string;
  onState?: (state: unknown) => void;
  onSubmit?: (payload: RunnerSubmitPayload) => void;
  onReady?: (capabilities: RunnerCapabilities) => void;
  /** Called with the live slot so a parent can trigger requestSubmit(). */
  registerSlot?: (slot: RunnerSlot | null) => void;
}

export function RunnerFrame(props: RunnerFrameProps) {
  const {
    entryUrl,
    stepId,
    config,
    context,
    state,
    mode = 'attempt',
    response,
    score,
    title,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);

  // Handlers live in a ref so that a parent re-render (which recreates the
  // closures) does not tear down and remount the iframe — remounting would
  // throw away everything the student had typed.
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    let cancelled = false;
    let slot: RunnerSlot | null = null;
    setReady(false);
    setSlow(false);

    // If a runner never sends `ready`, say so rather than showing a spinner
    // for the rest of the lesson.
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 8000);

    loadRunnerHost()
      .then(() => {
        if (cancelled || !containerRef.current || !window.mountRunner) return;
        slot = window.mountRunner(containerRef.current, {
          entryUrl,
          stepId,
          config,
          state: state ?? null,
          context: context ?? {},
          mode,
          response: response ?? null,
          score: score ?? null,
          title,
          onState: (s: unknown) => handlers.current.onState?.(s),
          onSubmit: (payload: RunnerSubmitPayload) => handlers.current.onSubmit?.(payload),
          onReady: (caps: RunnerCapabilities) => {
            if (!cancelled) {
              setReady(true);
              setSlow(false);
            }
            handlers.current.onReady?.(caps);
          },
          onLog: (entry: { level: string; message: string }) => {
            // Runner diagnostics land in the portal console, as the contract says.
            // eslint-disable-next-line no-console
            console.debug(`[runner:${stepId}] ${entry.level}: ${entry.message}`);
          },
        });
        handlers.current.registerSlot?.(slot);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      handlers.current.registerSlot?.(null);
      // destroy() removes the iframe it created. React never rendered that
      // node, so the two never fight over the same DOM child — which is why
      // the container below is always rendered EMPTY and the placeholder is
      // its sibling, not its child.
      slot?.destroy();
    };
    // Remount only when the step or the way it is being shown actually changes.
    // `config`/`state` are read at mount time and then owned by the runner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryUrl, stepId, mode]);

  if (error) {
    return (
      <div className="rounded-card border border-[color:var(--danger)] bg-danger-soft p-5 text-[15px]">
        <p className="font-semibold">This activity could not be loaded.</p>
        <p className="mt-1 text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="runner-frame relative min-h-[240px] overflow-hidden rounded-card border border-line bg-surface">
      {/* An overlay, not a swap: the iframe must stay laid out while it boots,
          because a display:none frame does not lay out its own document and the
          runner's ResizeObserver would report a height of zero. */}
      {!ready && (
        <div className="absolute inset-0 z-10 bg-surface p-12 text-center text-[15px] text-muted">
          {slow ? (
            <>
              <p className="font-semibold text-ink">This activity is not responding.</p>
              <p className="mt-1">
                Reload the page. If it still does not appear, tell your teacher — the runner at{' '}
                <code className="font-mono">{entryUrl}</code> may not be deployed.
              </p>
            </>
          ) : (
            'Loading activity…'
          )}
        </div>
      )}
      {/* Always rendered empty: mountRunner appends the iframe here itself. */}
      <div ref={containerRef} />
    </div>
  );
}
