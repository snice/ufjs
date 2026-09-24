// <defer> on the web: the same component as the Flutter path
// (components/defer.ts), settled by the web router's onPageSettled — the
// page's own transition, driven by router/settled.ts — with a DOM `div` for
// the placeholder. Same props, same timing, no wrapper once mounted.
import { createDefer } from '../../components/defer';
import { onPageSettled } from '../../router/web';

export const FjsDefer = createDefer(onPageSettled, 'div');
