// specs/150: mount-prewarm.ts under both style engines at once — covers the
// snapshot seeds (SEED_CHAIN / SEED_COMPUTE) as well as the live paths.
import './style-verify';
import { styleEngine } from 'fjs/vue';
import { runMountBench } from './mount-core';

runMountBench('prewarm')
  .then(() => console.log(`[verify] ${JSON.stringify(styleEngine.verifyStats)}`))
  .catch((e) => console.error(String(e?.stack ?? e)));
