// Install state, purely local: "Get" walks none → downloading → installed so
// the button states (and their transitions) can be compared across targets.
import { reactive } from 'vue';
import { APPS } from './data/apps';

export type InstallState = 'none' | 'cloud' | 'downloading' | 'installed';

export const installState = reactive<Record<string, InstallState>>(
  Object.fromEntries(APPS.map((a) => [a.id, a.initial])),
);
export const progress = reactive<Record<string, number>>({});

/** One timer per app: a second tap while downloading must not start another. */
const timers = new Map<string, ReturnType<typeof setInterval>>();

const STEP_MS = 120;
const STEP = 0.08;

export function download(id: string): void {
  const s = installState[id];
  if (s === 'downloading' || s === 'installed' || timers.has(id)) return;
  installState[id] = 'downloading';
  progress[id] = 0;
  timers.set(
    id,
    setInterval(() => {
      const next = Math.min(1, (progress[id] ?? 0) + STEP);
      progress[id] = next;
      if (next >= 1) {
        clearInterval(timers.get(id));
        timers.delete(id);
        installState[id] = 'installed';
      }
    }, STEP_MS),
  );
}

/** Pages call this on unmount so no interval outlives the app's pages. */
export function stopAllDownloads(): void {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
}
