// `<form>` for the Flutter renderer — a Vue component wrapping a `view`,
// not a Dart tag.
//
// Why not Dart (the first implementation was): a form has two jobs, and both
// are easier on this side.
//
//   * Collecting. The values it needs are the ones JS already sees: every
//     bound `value` prop goes through setProps, and every keystroke or
//     toggle comes back through the event dispatcher. ui/element.ts records
//     both per node, so the form reads them without asking the host.
//   * Submitting. `<button form-type="submit">` becomes a button with a real
//     `onTap` handler, installed here. That matters: on a device the tap is
//     won by the renderer's own GestureDetector — the one gesture.dart adds
//     for nodes that listen for taps — and NOT by the Material button
//     underneath it. A Dart-side form-type button has no tap handler, so
//     nothing wrapped it and the press did nothing (it flashed the pressed
//     state and stopped there). Giving the node an onTap puts it back on the
//     path every other tappable node in fjs uses.
//
// Fields are found by walking the JS shadow tree, not the slot vnodes: on
// this path a control is an ELEMENT, and it can sit any number of page
// components deep (`<form><Panel><input name="x"/></Panel></form>`), which
// slots and provide/inject cannot reach.
//
// The web adapter has its own implementation (../web/components/form.ts) for
// the same reason list-view does — different substrate, same contract: the
// submit payload is `{name: value}` JSON in document order, byte for byte.
import { defineComponent, h, ref } from '@vue/runtime-core';
// lifecycle that also serves the vapor render host (specs/171)
import { onMounted, onUnmounted, onUpdated } from '../vapor/instance';
import {
  fieldFormType,
  fieldName,
  fieldValue,
  setProps,
  type Element,
} from '../ui/element';
import { childElementIds, elementById, elementTag } from '../vue/host-ops';

/** Tags whose own value a form collects. A group reports for its members, so
 * a radio/checkbox inside one is skipped (see collect). */
const GROUP_TAGS = new Set(['radio-group', 'checkbox-group']);
const BOOLEAN_TAGS = new Set(['checkbox', 'radio', 'switch']);

/** Guard against a cyclic or absurdly deep tree; the same shape of cap the
 * style engine uses. */
const MAX_NODES = 5000;

function typedValue(tag: string, raw: string | undefined): unknown {
  if (tag === 'checkbox-group') {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (tag === 'radio-group') return raw ?? '';
  if (BOOLEAN_TAGS.has(tag)) return raw === '1' || raw === 'true';
  if (tag === 'slider') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw ?? '';
}

/** Depth-first, so siblings come out in document order — the order the web
 * adapter's mount hooks produce, which is what makes the two payloads
 * identical. */
function walk(rootId: number, visit: (id: number, tag: string, inGroup: boolean) => void) {
  let budget = MAX_NODES;
  const stack: Array<{ id: number; inGroup: boolean }> = [];
  const children = childElementIds(rootId);
  for (let i = children.length - 1; i >= 0; i--) {
    stack.push({ id: children[i], inGroup: false });
  }
  while (stack.length > 0 && budget-- > 0) {
    const { id, inGroup } = stack.pop()!;
    const tag = elementTag(id) ?? '';
    visit(id, tag, inGroup);
    const nested = inGroup || GROUP_TAGS.has(tag);
    const kids = childElementIds(id);
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ id: kids[i], inGroup: nested });
    }
  }
}

export const FjsForm = defineComponent({
  name: 'FjsForm',
  inheritAttrs: false,
  emits: ['submit', 'reset'],
  setup(_props, { attrs, slots, emit }) {
    const host = ref<Element | null>(null);
    /** Buttons this form has wired, so an update does not wire them twice. */
    const wired = new Set<number>();

    const collect = (): string => {
      const rootId = host.value?.id;
      const values: Record<string, unknown> = {};
      if (rootId === undefined) return JSON.stringify(values);
      walk(rootId, (id, tag, inGroup) => {
        // A group speaks for its members: they must not also appear on
        // their own (the Dart implementation called this `owns`).
        if (inGroup && BOOLEAN_TAGS.has(tag)) return;
        const name = fieldName(id);
        if (!name) return;
        values[name] = typedValue(tag, fieldValue(id));
      });
      return JSON.stringify(values);
    };

    const submit = () => emit('submit', collect());
    // Values are not rolled back here: fjs controls are driven from the
    // page, so the page owns the reset. The event is the whole contract.
    const reset = () => emit('reset');

    /** Gives every `form-type` button under this form a real tap handler. */
    const wireButtons = () => {
      const rootId = host.value?.id;
      if (rootId === undefined) return;
      walk(rootId, (id, tag) => {
        if (tag !== 'button' || wired.has(id)) return;
        const formType = fieldFormType(id);
        if (formType !== 'submit' && formType !== 'reset') return;
        const el = elementById(id);
        if (!el) return;
        wired.add(id);
        setProps(el, { onTap: formType === 'submit' ? submit : reset });
      });
    };

    onMounted(wireButtons);
    onUpdated(wireButtons);
    onUnmounted(() => wired.clear());

    return () => h('view', { ...attrs, ref: host }, slots.default?.());
  },
});
