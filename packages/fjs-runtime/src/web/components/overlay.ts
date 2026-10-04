// refresh -> RefreshIndicator, modal -> the bottom sheet.
import { Teleport, defineComponent, h, ref } from 'vue';
import { hostAttrs } from '../style';

export const FjsRefresh = defineComponent({
  name: 'FjsRefresh',
  inheritAttrs: false,
  // statuschange is the APP side's pull-status event (specs/206, the
  // custom-header mode) — this web twin has no status machine to report,
  // it is declared so a `@statuschange` binding is a consumed component
  // event here rather than a fallthrough attribute, and so WEB_EMITS
  // (which routes the payload shape on BOTH ends) can list it.
  emits: ['refresh', 'statuschange'],
  setup(_props, { attrs, slots, emit }) {
    const host = ref<HTMLElement | null>(null);
    const pull = ref(0);
    const busy = ref(false);
    let startY: number | null = null;
    const onTouchstart = (event: TouchEvent) => {
      startY = (host.value?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : null;
    };
    const onTouchmove = (event: TouchEvent) => {
      if (startY === null || busy.value) return;
      pull.value = Math.max(0, Math.min(80, event.touches[0].clientY - startY));
    };
    const onTouchend = () => {
      if (pull.value >= 60 && !busy.value) {
        busy.value = true;
        emit('refresh');
        // RefreshIndicator hides itself after ~600ms; match that
        setTimeout(() => {
          busy.value = false;
        }, 600);
      }
      pull.value = 0;
      startY = null;
    };
    return () =>
      h(
        'refresh',
        {
          ...hostAttrs(attrs),
          class: ['fjs-refresh', attrs.class],
          ref: host,
          onTouchstart,
          onTouchmove,
          onTouchend,
        },
        [
          h(
            'refresh-hint',
            { class: ['fjs-refresh-hint', { active: busy.value || pull.value > 0 }] },
            busy.value ? '正在刷新…' : pull.value >= 60 ? '松开刷新' : '下拉刷新',
          ),
          ...(slots.default?.() ?? []),
        ],
      );
  },
});

export const FjsModal = defineComponent({
  name: 'FjsModal',
  inheritAttrs: false,
  props: { visible: { type: Boolean, default: false } },
  emits: ['modalClosed'],
  setup(props, { attrs, slots, emit }) {
    return () =>
      props.visible
        ? h(Teleport, { to: 'body' }, [
            h('fjs-modal', { class: 'fjs-modal' }, [
              h('fjs-modal-mask', {
                class: 'fjs-modal-mask',
                onClick: () => emit('modalClosed'),
              }),
              h(
                'fjs-modal-sheet',
                { ...hostAttrs(attrs), class: ['fjs-modal-sheet', attrs.class] },
                slots.default?.(),
              ),
            ]),
          ])
        : null;
  },
});
