// <defer> on the web: the same component as the Flutter path
// (components/defer.ts), settled by the page's own transition (router/
// settled.ts, which whichever web router is bundled tells which page is
// asking — specs/173) with a DOM `div` for the placeholder. Same props,
// same timing, no wrapper once mounted.
import { createDefer } from '../../components/defer';
import { onPageSettled } from '../../router/settled';

export const FjsDefer = createDefer(onPageSettled, 'div');
