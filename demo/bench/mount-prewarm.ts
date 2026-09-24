// Pages as shipped plus the build-time style snapshot (specs/119): `fjs
// build` captures each page's style caches by running this bundle in Node,
// appends them, and the suite imports one before each page's cold mount.
// See mount-core.ts for what the columns mean.
import { runMountBench } from './mount-core';

runMountBench('prewarm').catch((e) => console.error(String(e?.stack ?? e)));
