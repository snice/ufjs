// Desktop mouse → touch events for vant, web build only (specs/123).
//
// vant is mobile-first: the Field clear icon listens to `touchstart` only,
// and Slider / Swipe / Picker drags are touch handlers. A desktop browser
// never sends those, so clicking the clear icon just blurred the field and
// left the text. vant's own answer is this emulator; a real touch device
// is untouched (it bails out when the window already supports touch).
//
// `.web.ts` on purpose: the app host has no document to patch, and its
// touches already arrive as touch events.
import '@vant/touch-emulator';

export default () => {};
