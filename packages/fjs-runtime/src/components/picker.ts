// `<picker>` — the sheet-from-the-bottom selector, as a component.
//
// Nothing here needs a widget: opening a sheet, deciding which columns a
// mode has, turning wheel indexes into "2" / [1,0,3] / "09:30" /
// "2026-09-04", and wiring two buttons is all orchestration, so by
// constitution VII it stays in JS and BOTH platforms run this one file. The
// only native part is the wheel it renders into — `<picker-view>`.
//
// It composes existing tags on purpose: `modal` for the sheet, `button` for
// the bar, `picker-view` for the wheel. That also means the sheet's content
// must stay live while it is open — a linked column is replaced mid-scroll —
// which is why specs/008-picker fixed `modal`'s snapshot first (plan §3.2).
//
// Those tags are looked up with resolveDynamicComponent, not written as
// plain strings: on Flutter they are host elements the renderer handles, on
// web they are the Vue adapters in web/components. The lookup returns the
// component where one is registered and the bare tag name where none is —
// which is exactly the split, without this file knowing which platform it
// is on. (`resolveComponent` would warn on the Flutter path; the dynamic one
// is the quiet variant made for `<component :is>`.)
import {
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type PropType,
} from '@vue/runtime-core';
// tag names resolve through the vapor runtime too (specs/171)
import { resolveDynamicComponent } from '../vapor/instance';
import {
  columnsFor,
  reflow,
  valueFor,
  type DateFields,
  type PickerColumn,
} from './picker-modes';

/** Same warn-once channel the controls use, minus the import cycle. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

export const FjsPicker = defineComponent({
  name: 'FjsPicker',
  inheritAttrs: false,
  props: {
    mode: { type: String, default: 'selector' },
    value: {
      type: [Number, String, Array] as PropType<number | string | number[]>,
      default: 0,
    },
    range: { type: Array as PropType<unknown[]>, default: () => [] },
    rangeKey: { type: String, default: '' },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
    fields: { type: String as PropType<DateFields>, default: 'day' },
    disabled: { type: Boolean, default: false },
    /** The sheet's confirm / cancel labels, so a page can localize them. */
    okText: { type: String, default: '确定' },
    cancelText: { type: String, default: '取消' },
  },
  emits: ['change', 'cancel', 'columnchange'],
  setup(props, { attrs, slots, emit }) {
    const open = ref(false);
    /** The wheels' state while the sheet is up. Committed on 确定, thrown
     * away on 取消 — that is what makes cancel a no-op for the page. */
    const draft = ref<PickerColumn[]>([]);

    const modeProps = computed(() => ({
      range: props.range,
      rangeKey: props.rangeKey || undefined,
      value: props.value,
      start: props.start || undefined,
      end: props.end || undefined,
      fields: props.fields,
    }));

    const fromProps = (): PickerColumn[] => {
      const columns = columnsFor(props.mode, modeProps.value);
      if (columns) return columns;
      warnOnce(
        `picker-mode:${props.mode}`,
        `<picker> does not know mode="${props.mode}"; expected selector, ` +
          'multiSelector, time or date. Falling back to selector.',
      );
      return columnsFor('selector', modeProps.value) ?? [];
    };

    // A linked page answers @columnchange by swapping `range`, so the open
    // sheet has to follow the prop rather than keep its own copy.
    watch(
      () => [props.range, props.mode, props.start, props.end, props.fields],
      () => {
        if (open.value) draft.value = fromProps();
      },
      { deep: true },
    );

    const show = () => {
      if (props.disabled) return;
      draft.value = fromProps();
      open.value = true;
    };

    const cancel = () => {
      open.value = false;
      emit('cancel');
    };

    const confirm = () => {
      open.value = false;
      emit('change', valueFor(props.mode, draft.value));
    };

    /** The wheel reports every column's index; only one of them moved. */
    const onWheel = (payload: string) => {
      let next: number[];
      try {
        next = JSON.parse(payload) as number[];
      } catch {
        return;
      }
      const previous = draft.value;
      const moved = next.findIndex((v, i) => v !== previous[i]?.index);
      const merged = previous.map((column, i) => ({
        items: column.items,
        index: next[i] ?? column.index,
      }));
      // time / date columns depend on each other (February, boundary hours);
      // selector columns do not, and the page owns their linkage.
      draft.value = reflow(props.mode, merged, {
        start: props.start || undefined,
        end: props.end || undefined,
        fields: props.fields,
      });
      if (moved >= 0 && props.mode === 'multiSelector') {
        emit(
          'columnchange',
          JSON.stringify({ column: moved, value: next[moved] }),
        );
      }
    };

    return () => {
      const view = resolveDynamicComponent('view') as string;
      const button = resolveDynamicComponent('button') as string;
      const text = resolveDynamicComponent('text') as string;
      const modal = resolveDynamicComponent('modal') as string;
      const wheel = resolveDynamicComponent('picker-view') as string;
      const wheelColumn = resolveDynamicComponent('picker-view-column') as string;
      return [
        h(view, { ...attrs, onTap: show }, () => slots.default?.()),
        h(modal, { visible: open.value, onModalClosed: cancel }, () => [
          // The bar's layout is INLINE, not a class: `.fjs-picker-bar` only
          // exists in the web base stylesheet, and this component renders on
          // both platforms — on Flutter the class resolves to nothing and the
          // two buttons stack. The classes stay as hooks for a page that
          // wants to restyle.
          h(
            view,
            {
              class: 'fjs-picker-bar',
              style: {
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #e5e5ea',
              },
            },
            () => [
              h(
                button,
                {
                  class: 'fjs-picker-cancel',
                  style: { border: 'none', color: '#888888' },
                  onTap: cancel,
                },
                () => props.cancelText,
              ),
              h(
                button,
                {
                  class: 'fjs-picker-ok',
                  style: { border: 'none', color: '#007aff' },
                  onTap: confirm,
                },
                () => props.okText,
              ),
            ],
          ),
          h(
            wheel,
            {
              class: 'fjs-picker-wheel',
              style: { alignSelf: 'stretch', width: '100%' },
              value: draft.value.map((c) => c.index),
              onChange: onWheel,
              onValueChanged: onWheel,
            },
            () =>
              draft.value.map((column, i) =>
                h(wheelColumn, { key: i }, () =>
                  column.items.map((item, j) =>
                    h(
                      text,
                      {
                        key: j,
                        class: 'fjs-picker-item',
                        style: { textAlign: 'center', fontSize: 16 },
                      },
                      () => item,
                    ),
                  ),
                ),
              ),
          ),
        ]),
      ];
    };
  },
});
