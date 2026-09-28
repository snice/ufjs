// Idle-time preloading of every page's code (specs/143), shared by the
// Flutter and web routers. What "load one page" means and what "idle" means
// are the platform's business — Flutter asks the host, which alone can see
// a finger on the glass, a fling or a route transition (engine.dart
// FjsIdleGate); web waits for requestIdleCallback — so this file only owns
// the order and the bookkeeping.
//
// One page at a time, in route-table order (tab pages come first there): a
// chunk evaluates on the UI thread, and two back to back would be one long
// frame instead of two short ones in separate idle slots.

export interface PreloadQueue {
  /** Stops before the next page; the one in flight still finishes. */
  stop(): void;
  /** Settles when the queue has run out or was stopped. Never rejects. */
  readonly done: Promise<void>;
}

/** Runs `preloadOne` for each distinct path, sequentially. A failure is
 * reported and skipped rather than ending the queue: opening that page
 * retries the load on its own path and reports it there (constitution V). */
export function startPreloadQueue(
  paths: readonly string[],
  preloadOne: (path: string) => Promise<void>,
): PreloadQueue {
  let stopped = false;
  const done = (async () => {
    for (const path of new Set(paths)) {
      if (stopped) return;
      try {
        await preloadOne(path);
      } catch (e) {
        console.warn(`[fjs-router] preload ${path} failed: ${String(e)}`);
      }
    }
  })();
  return {
    stop: () => {
      stopped = true;
    },
    done,
  };
}
