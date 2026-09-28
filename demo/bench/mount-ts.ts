// specs/150: mount.ts under the TS style engine, for comparison.
import './style-ts';
import { runMountBench } from './mount-core';

runMountBench('defer').catch((e) => console.error(String(e?.stack ?? e)));
