// Layout math for the tab bar slider, apart from the components so the
// component and the index can both import it without a cycle.
/** Left edge (in percent of the track) of the selected-item slider. Pure so
 * the layout math is testable without a renderer. */
export function sliderLeftPercent(active: number | null, count: number): number {
  if (active === null || count <= 0) return 0;
  const i = Math.min(Math.max(active, 0), count - 1);
  return (i * 100) / count;
}
