// fjs/tag/nested-scroll-body on web (specs/208): see nested-scroll-header.ts.
import { registerTagComponent } from '../../runtime';
import '../../render-host';
import { FjsNestedScrollBody } from '../../../web/components/nested-scroll';

registerTagComponent('nested-scroll-body', FjsNestedScrollBody);
