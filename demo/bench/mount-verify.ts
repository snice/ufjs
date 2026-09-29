// specs/150: the mount bench's pages under both style engines at once — the
// run fails loudly on any element whose native style differs from the TS one.
import './style-verify';
import { styleEngine } from 'fjs/vue';
import { runMountBench } from './mount-core';

runMountBench('defer')
  .then(() => console.log(`[verify] ${JSON.stringify(styleEngine.verifyStats)}`))
  .catch((e) => console.error(String(e?.stack ?? e)));
