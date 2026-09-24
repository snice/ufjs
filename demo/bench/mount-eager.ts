// Baseline: <defer> renders its slot at once, so the whole page mounts in
// the first frame — what these pages cost before specs/118 split them.
// See mount-core.ts for what the columns mean.
import { runMountBench } from './mount-core';

runMountBench(false).catch((e) => console.error(String(e?.stack ?? e)));
