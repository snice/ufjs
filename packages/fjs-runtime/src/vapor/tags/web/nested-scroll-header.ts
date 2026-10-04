// fjs/tag/nested-scroll-header on web (specs/208): the compiler imports this
// module into a vapor SFC whose template uses <nested-scroll-header>; it
// registers the implementation the vapor runtime resolves the tag to (see
// sticky-header.ts for the precedent).
import { registerTagComponent } from '../../runtime';
// the render host comes with the first tag a bundle uses — an app made of
// view / text alone never carries it
import '../../render-host';
import { FjsNestedScrollHeader } from '../../../web/components/nested-scroll';

registerTagComponent('nested-scroll-header', FjsNestedScrollHeader);
