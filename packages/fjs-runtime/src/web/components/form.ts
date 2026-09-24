// input / switch / checkbox / slider / progress — the tags whose DOM shape
// differs from the fjs tag (an <input>, a couple of divs) and whose events
// have to come out as the same strings Flutter sends.
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  provide,
  ref,
  watch,
} from 'vue';
import { hostAttrs } from '../style';
import { lineChangePayload } from '../../textarea/lines';
import { parsePlaceholderStyle } from '../../textarea/props';
import {
  FORM_ACTIONS,
  nodeIdGetter,
  provideControlScope,
  useControl,
  warnControlOnce,
  type FjsControlHandle,
} from './scope';

/** Mirrors the prop into local state the way the Flutter widgets do
 * (widgets/checkbox.dart): a control driven by a group but not bound to a
 * `value` still has to move when the user taps it, and it must follow the
 * prop again the moment the page does bind one. */
function useChecked(read: () => boolean) {
  const checked = ref(read());
  watch(read, (next) => {
    checked.value = next;
  });
  return checked;
}

export const FjsInput = defineComponent({
  name: 'FjsInput',
  inheritAttrs: false,
  props: {
    value: { type: [String, Number], default: '' },
    placeholder: { type: String, default: '' },
    secure: { type: Boolean, default: false },
    multiline: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    keyboard: { type: String, default: '' },
    name: { type: String, default: '' },
    /** -1 (the default) means no limit, as on Flutter. */
    maxlength: { type: [Number, String], default: -1 },
    /** The multiline props; `textarea` is their documented entry point but
     * they belong to this widget on both platforms (widgets/input.dart). */
    autoHeight: { type: Boolean, default: false },
    focus: { type: Boolean, default: false },
    autoFocus: { type: Boolean, default: false },
    confirmType: { type: String, default: 'return' },
    placeholderStyle: { type: String, default: '' },
  },
  // payloads mirror FjsEvent.textChanged / textSubmitted / focus / blur:
  // the raw string. linechange is the JSON textarea/lines.ts writes.
  emits: ['input', 'submit', 'textChanged', 'focus', 'blur', 'linechange'],
  setup(props, { attrs, emit }) {
    const element = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const el = element;
    const text = ref(String(props.value ?? ''));
    watch(
      () => props.value,
      (next) => {
        text.value = String(next ?? '');
      },
    );
    const limit = computed(() => {
      const n = Number(props.maxlength);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    });
    useControl({
      kind: 'input',
      getName: () => props.name || undefined,
      getId: nodeIdGetter(),
      // The live text, not the prop: an fjs input may be uncontrolled.
      getValue: () => el.value?.value ?? text.value,
      focus: () => el.value?.focus(),
    });
    /** A newline key is not a confirm — same rule as `TextInputAction.newline`
     * on Flutter (specs/012 §3.5). */
    const confirms = computed(
      () => !props.multiline || props.confirmType !== 'return',
    );

    /** Whether the inline height on the element is one auto-height wrote. */
    let grownHeight = false;

    /** Measures the CONTENT, which is not the box: with `rows=3` a one-line
     * textarea still has a three-line scrollHeight. Collapsing it for the
     * measurement (rows=1 + height:auto) and putting it straight back is the
     * cheapest way to ask "how tall is the text"; Flutter asks a TextPainter
     * the same question (widgets/input.dart). */
    const measure = (): { height: number; lineCount: number } | null => {
      const el = element.value;
      if (!el || !props.multiline) return null;
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) ||
        parseFloat(style.fontSize) * 1.4 || 1;
      const padding =
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0);
      const area = el as HTMLTextAreaElement;
      // The ATTRIBUTE, not the property: `rows` is rendered by the vdom, and
      // an element without it must be left without it. Restoring the
      // property would pin rows="2" on a field that never asked for one.
      const previousRows = area.getAttribute('rows');
      const previousHeight = area.style.height;
      area.rows = 1;
      area.style.height = 'auto';
      const height = Math.max(0, area.scrollHeight - padding);
      if (previousRows === null) area.removeAttribute('rows');
      else area.setAttribute('rows', previousRows);
      if (props.autoHeight) {
        area.style.height = `${height + padding}px`;
        grownHeight = true;
      } else if (grownHeight) {
        // Turning auto-height off has to give the height back to the page's
        // CSS. Only ours is cleared: an inline height the page itself wrote
        // is not this code's to remove.
        area.style.height = '';
        grownHeight = false;
      } else {
        area.style.height = previousHeight;
      }
      return { height, lineCount: Math.max(1, Math.round(height / lineHeight)) };
    };

    const report = () => {
      const detail = measure();
      if (detail) emit('linechange', lineChangePayload(detail));
    };

    const onInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      text.value = target.value;
      emit('input', target.value);
      emit('textChanged', target.value);
      report();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (props.multiline && !confirms.value) return; // the key is a newline
      // A confirm key on a multiline field must not ALSO insert the newline
      // it would have inserted — Flutter's non-newline actions do not.
      if (props.multiline) event.preventDefault();
      emit('submit', (event.target as HTMLInputElement).value);
    };

    // Focus is controlled the same way Flutter controls it: only a CHANGE
    // moves it, so a still-true prop cannot grab focus back after the user
    // tapped away (widgets/input.dart).
    watch(
      () => props.focus,
      (wanted, previous) => {
        if (wanted === previous) return;
        if (wanted) element.value?.focus();
        else if (document.activeElement === element.value) element.value?.blur();
      },
    );
    onMounted(() => {
      if (props.focus || props.autoFocus) element.value?.focus();
      // Prime the line count: the component-side gate drops this first
      // report, exactly as it drops Flutter's (components/textarea.ts).
      nextTick(report);
    });
    watch(() => [props.value, props.multiline, props.autoHeight], () =>
      nextTick(report),
    );

    const placeholderVars = computed(() => {
      const parsed = parsePlaceholderStyle(props.placeholderStyle);
      const vars: Record<string, string> = {};
      if (parsed.color) vars['--fjs-placeholder-color'] = parsed.color;
      if (parsed['font-size']) {
        vars['--fjs-placeholder-font-size'] = parsed['font-size'];
      }
      if (parsed['font-weight']) {
        vars['--fjs-placeholder-font-weight'] = parsed['font-weight'];
      }
      if (parsed['line-height']) {
        vars['--fjs-placeholder-line-height'] = parsed['line-height'];
      }
      return vars;
    });
    /** The page's own style plus the placeholder's CSS variables, which
     * base-css.ts reads in `::placeholder`. Same merge FjsImage does: the
     * host attrs already carry a style object that must not be dropped. */
    const inputStyle = (): Record<string, unknown> | undefined => {
      const raw = hostAttrs(attrs).style;
      const own =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : undefined;
      const vars = placeholderVars.value;
      if (!Object.keys(vars).length) return own;
      return { ...vars, ...(own ?? {}) };
    };

    return () =>
      h(props.multiline ? 'textarea' : 'input', {
        ...hostAttrs(attrs),
        ref: element,
        class: [
          'fjs-input',
          { 'fjs-input--auto-height': props.multiline && props.autoHeight },
          attrs.class,
        ],
        // `rows` expresses "three lines" the way maxLines: 3 does on
        // Flutter — it follows the font size, and a CSS height still wins.
        rows: props.multiline && !props.autoHeight ? 3 : undefined,
        // Only when textarea's confirm key asks for one: otherwise the
        // page's own `enterkeyhint` (in attrs) stays — spreading undefined
        // over it here dropped it (specs/125).
        ...(props.multiline && confirms.value
          ? { enterkeyhint: props.confirmType }
          : {}),
        style: inputStyle(),
        value: text.value,
        placeholder: props.placeholder,
        disabled: props.disabled,
        name: props.name || undefined,
        maxlength: limit.value,
        onFocus: (event: FocusEvent) =>
          emit('focus', (event.target as HTMLInputElement).value),
        onBlur: (event: FocusEvent) =>
          emit('blur', (event.target as HTMLInputElement).value),
        // `secure` / `keyboard` are the fjs props and win; without them the
        // page's DOM `type` (in attrs) is kept — `<input type="password">`
        // used to be forced to `text` and showed the password (specs/125).
        ...(props.multiline
          ? {}
          : props.secure
            ? { type: 'password' }
            : props.keyboard === 'number'
              ? { type: 'number' }
              : { type: (attrs.type as string | undefined) ?? 'text' }),
        onInput,
        onKeydown,
      });
  },
});

export const FjsSwitch = defineComponent({
  name: 'FjsSwitch',
  inheritAttrs: false,
  props: {
    value: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit }) {
    const on = useChecked(() => props.value);
    const changed = useControl({
      kind: 'toggle',
      getName: () => props.name || undefined,
      getId: nodeIdGetter(),
      getValue: () => on.value,
      toggle: () => toggle(),
    });
    const toggle = () => {
      if (props.disabled) return;
      on.value = !on.value;
      const next = on.value ? '1' : '0';
      emit('change', next);
      emit('valueChanged', next);
      changed();
    };
    return () =>
      h(
        'switch',
        {
          ...hostAttrs(attrs),
          class: ['fjs-switch', { on: on.value, disabled: props.disabled }, attrs.class],
          role: 'switch',
          'aria-checked': String(on.value),
          onClick: toggle,
        },
        [h('i', { class: 'fjs-switch-knob' })],
      );
  },
});

export const FjsCheckbox = defineComponent({
  name: 'FjsCheckbox',
  inheritAttrs: false,
  props: {
    value: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit, slots }) {
    const on = useChecked(() => props.value);
    const changed = useControl({
      kind: 'checkbox',
      getName: () => props.name || undefined,
      getId: nodeIdGetter(),
      getValue: () => on.value,
      setChecked: (next) => {
        on.value = next;
      },
      toggle: () => toggle(),
    });
    const toggle = () => {
      if (props.disabled) return;
      on.value = !on.value;
      const next = on.value ? '1' : '0';
      emit('change', next);
      emit('valueChanged', next);
      changed();
    };
    return () => {
      const box = h(
        'i',
        { class: ['fjs-checkbox', { on: on.value }] },
        on.value ? [h('i', { class: 'fjs-check' })] : [],
      );
      return h(
        'checkbox',
        {
          ...hostAttrs(attrs),
          class: [{ disabled: props.disabled }, attrs.class],
          role: 'checkbox',
          'aria-checked': String(on.value),
          onClick: toggle,
        },
        [box, ...(slots.default?.() ?? [])],
      );
    };
  },
});

/** radio — the circle version of checkbox. Tapping the selected one is a
 * no-op (it does not untoggle), as in a browser and in WeUI. */
export const FjsRadio = defineComponent({
  name: 'FjsRadio',
  inheritAttrs: false,
  props: {
    value: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit, slots }) {
    const on = useChecked(() => props.value);
    const changed = useControl({
      kind: 'radio',
      getName: () => props.name || undefined,
      getId: nodeIdGetter(),
      getValue: () => on.value,
      // Set by the group when another radio wins; deliberately silent.
      setChecked: (next) => {
        on.value = next;
      },
      toggle: () => select(),
    });
    const select = () => {
      if (props.disabled || on.value) return;
      on.value = true;
      emit('change', '1');
      emit('valueChanged', '1');
      changed();
    };
    return () => {
      const box = h('i', { class: ['fjs-radio', { on: on.value }] });
      return h(
        'radio',
        {
          ...hostAttrs(attrs),
          class: [{ disabled: props.disabled }, attrs.class],
          role: 'radio',
          'aria-checked': String(on.value),
          onClick: select,
        },
        [box, ...(slots.default?.() ?? [])],
      );
    };
  },
});

export const FjsSlider = defineComponent({
  name: 'FjsSlider',
  inheritAttrs: false,
  props: {
    value: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
  },
  emits: ['change', 'valueChanged'],
  setup(props, { attrs, emit }) {
    const current = ref(props.value);
    watch(
      () => props.value,
      (next) => {
        current.value = next;
      },
    );
    const changed = useControl({
      kind: 'slider',
      getName: () => props.name || undefined,
      getId: nodeIdGetter(),
      getValue: () => current.value,
    });
    const onInput = (event: Event) => {
      // Flutter sends the value with two decimals; keep the string shape
      const raw = Number((event.target as HTMLInputElement).value);
      current.value = raw;
      const text = raw.toFixed(2);
      emit('change', text);
      emit('valueChanged', text);
      changed();
    };
    return () =>
      h('input', {
        ...hostAttrs(attrs),
        class: ['fjs-slider', attrs.class],
        type: 'range',
        min: props.min,
        max: props.max,
        step: props.step > 0 ? props.step : 'any',
        value: props.value,
        disabled: props.disabled,
        onInput,
      });
  },
});

export const FjsProgress = defineComponent({
  name: 'FjsProgress',
  inheritAttrs: false,
  props: {
    value: { type: Number, default: undefined },
    type: { type: String, default: 'linear' },
  },
  setup(props, { attrs }) {
    return () => {
      if (props.type === 'circular') {
        return h('progress-ring', {
          ...hostAttrs(attrs),
          class: ['fjs-progress-ring', attrs.class],
        });
      }
      const indeterminate = props.value === undefined || props.value === null;
      return h(
        'progress-bar',
        {
          ...hostAttrs(attrs),
          class: ['fjs-progress', { indeterminate }, attrs.class],
        },
        [
          h('i', {
            class: 'fjs-progress-fill',
            style: indeterminate
              ? undefined
              : { width: `${Math.max(0, Math.min(1, props.value as number)) * 100}%` },
          }),
        ],
      );
    };
  },
});

/** radio-group / checkbox-group.
 *
 * No chrome of their own: a scope plus the group's own `@change`. The
 * payload is what widgets/group.dart emits — the selected `name` for a
 * radio group, a JSON array of names (document order) for a checkbox
 * group — so a page reads the same string on both platforms. */
function defineGroup(tag: 'radio-group' | 'checkbox-group', multiple: boolean) {
  return defineComponent({
    name: multiple ? 'FjsCheckboxGroup' : 'FjsRadioGroup',
    inheritAttrs: false,
    props: { name: { type: String, default: '' } },
    emits: ['change', 'valueChanged'],
    setup(props, { attrs, emit, slots }) {
      const registry = provideControlScope();
      const kind = multiple ? 'checkbox' : 'radio';
      // The group speaks for its members; they do not also show up on their
      // own in an enclosing <form>'s payload.
      registry.owns = kind;
      const members = () => registry.handles.filter((h) => h.kind === kind);
      const selectedName = () => {
        for (const member of members()) {
          if (member.getValue() === true) return member.getName() ?? '';
        }
        return '';
      };
      const selectedNames = () =>
        JSON.stringify(
          members()
            .filter((m) => m.getValue() === true)
            .map((m) => m.getName())
            .filter((n): n is string => n !== undefined),
        );
      const payload = () => (multiple ? selectedNames() : selectedName());
      const warnUnnamed = () => {
        for (const member of members()) {
          if (member.getName() !== undefined) continue;
          warnControlOnce(
            `group-unnamed:${tag}`,
            `<${kind}> inside a <${tag}> has no \`name\`, so it can never ` +
              "appear in the group's payload. Give it a name.",
          );
        }
      };
      registry.onChanged = (changed: FjsControlHandle) => {
        if (changed.kind !== kind) return;
        if (!multiple && changed.getValue() === true) {
          for (const other of members()) {
            if (other === changed) continue;
            other.setChecked?.(false);
          }
        }
        warnUnnamed();
        const text = payload();
        emit('change', text);
        emit('valueChanged', text);
      };
      // The group is itself a control to an enclosing <form>.
      useControl({
        kind: 'group',
        getName: () => props.name || undefined,
        getId: nodeIdGetter(),
        getValue: () => (multiple ? JSON.parse(selectedNames()) : selectedName()),
      });
      return () => h(tag, hostAttrs(attrs), slots.default?.());
    },
  });
}

export const FjsRadioGroup = defineGroup('radio-group', false);
export const FjsCheckboxGroup = defineGroup('checkbox-group', true);

/** label — a container that forwards a tap to one control.
 *
 * Deliberately NOT a DOM <label>: native `for` only works on real form
 * elements, and an fjs checkbox / radio / switch is a div, so half the
 * controls would take one path and half another (and a native label
 * wrapping an input fires the click twice). The Flutter side forwards the
 * same way, see widgets/label.dart. */
export const FjsLabel = defineComponent({
  name: 'FjsLabel',
  inheritAttrs: false,
  props: { for: { type: String, default: '' } },
  emits: ['tap', 'longPress'],
  setup(props, { attrs, slots }) {
    const registry = provideControlScope();
    /** Tags a control renders as its own root. A click that started inside
     * one is already handled by that control; forwarding it again would
     * toggle twice. Flutter gets this for free — the inner GestureDetector
     * wins the arena — so the web side has to say it out loud. */
    const CONTROL_TAGS =
      'input,textarea,checkbox,radio,switch,slider,button,select';
    const activate = (event: Event) => {
      const from = event.target as HTMLElement | null;
      if (from?.closest(CONTROL_TAGS)) return;
      const target = props.for;
      const hit = target
        ? registry.handles.find((h) => h.getId() === target)
        : registry.handles[0];
      if (!hit) {
        warnControlOnce(
          `label-no-target:${target || 'first'}`,
          `<label> has no control to activate${
            target ? ` (for="${target}")` : ''
          } — the tap does nothing.`,
        );
        return;
      }
      // An input takes focus, everything else toggles.
      if (hit.focus) hit.focus();
      else hit.toggle?.();
    };
    return () =>
      h('label', { ...hostAttrs(attrs), onClick: activate }, slots.default?.());
  },
});

/** form — collects every named control under it.
 *
 * Values come from the handles, not from props: an fjs input may be
 * uncontrolled. Key order is registration order, which is mount order and
 * therefore document order — the same order widgets/form.dart produces. */
export const FjsForm = defineComponent({
  name: 'FjsForm',
  inheritAttrs: false,
  emits: ['submit', 'reset'],
  setup(_props, { attrs, emit, slots }) {
    const registry = provideControlScope();
    const submit = () => {
      const values: Record<string, unknown> = {};
      for (const handle of registry.handles) {
        const name = handle.getName();
        if (!name) continue;
        if (name in values) {
          warnControlOnce(
            `form-dup-name:${name}`,
            `<form> has two controls named "${name}"; the later one wins ` +
              'in the submit payload.',
          );
        }
        values[name] = handle.getValue();
      }
      emit('submit', JSON.stringify(values));
    };
    // No values are rolled back here: fjs controls are driven from JS, so
    // the page owns the reset. The event is the whole contract.
    const reset = () => emit('reset');
    provide(FORM_ACTIONS, { submit, reset });
    return () =>
      h(
        'form',
        {
          ...hostAttrs(attrs),
          // a real <form> would navigate on submit
          onSubmit: (event: Event) => event.preventDefault(),
        },
        slots.default?.(),
      );
  },
});
