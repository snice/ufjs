// Pages as shipped: <defer> mounts below-the-fold content after settle.
// See mount-core.ts for what the columns mean.
import { runMountBench } from './mount-core';

runMountBench(true).catch((e) => console.error(String(e?.stack ?? e)));
