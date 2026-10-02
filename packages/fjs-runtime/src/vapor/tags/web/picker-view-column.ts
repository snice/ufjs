// fjs/tag/picker-view-column on web (specs/171): the compiler imports this module into
// a vapor SFC whose template uses <picker-view-column>; it registers the implementation
// the vapor runtime resolves the tag to (a render-function component, run
// by vapor/render-host.ts in a pure-vapor app).
import { registerTagComponent } from '../../runtime';
// the render host comes with the first tag a bundle uses — an app made of
// view / text alone never carries it
import '../../render-host';
import { FjsPickerViewColumn } from '../../../web/components/picker-view';

registerTagComponent('picker-view-column', FjsPickerViewColumn);
