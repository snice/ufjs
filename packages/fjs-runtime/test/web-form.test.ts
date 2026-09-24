// @vitest-environment happy-dom
//
// The web half of specs/007-form-components.
//
// The control payloads (groups, label) are asserted verbatim on the Dart
// side too — flutter_fjs/test/form_controls_test.dart, where those tags are
// widgets. `<form>` is a JS component on both platforms, so its twin is
// flutter-form.test.ts. Either pair IS the "two ends, one contract" check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type Component } from 'vue';
import {
  FjsCheckbox,
  FjsCheckboxGroup,
  FjsForm,
  FjsInput,
  FjsLabel,
  FjsRadio,
  FjsRadioGroup,
  FjsSwitch,
} from '../src/web/components/form';
import { FjsButton } from '../src/web/components/basic';

function mount(render: () => unknown) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp({ render } as Component);
  app.mount(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const click = async (el: Element | null) => {
  (el as HTMLElement).click();
  await nextTick();
};

describe('radio-group', () => {
  it('is exclusive and reports the selected name', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(FjsRadioGroup, { onChange: (v: string) => changes.push(v) }, () => [
        h(FjsRadio, { name: 'a' }),
        h(FjsRadio, { name: 'b' }),
      ]),
    );
    const radios = host.querySelectorAll('radio');

    await click(radios[1]);
    expect(changes).toEqual(['b']);
    expect(radios[1].querySelector('.fjs-radio')?.className).toContain('on');

    await click(radios[0]);
    expect(changes).toEqual(['b', 'a']);
    // the other one was turned off without an event of its own
    expect(radios[1].querySelector('.fjs-radio')?.className).not.toContain('on');
  });

  it('tapping the selected radio again changes nothing', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(FjsRadioGroup, { onChange: (v: string) => changes.push(v) }, () => [
        h(FjsRadio, { name: 'a', value: true }),
      ]),
    );
    await click(host.querySelector('radio'));
    expect(changes).toEqual([]);
  });

  it('warns once about a member with no name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(() =>
      h(FjsRadioGroup, null, () => [h(FjsRadio, {})]),
    );
    await click(host.querySelector('radio'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('`name`');
  });
});

describe('checkbox-group', () => {
  it('emits the selected names as a JSON array in document order', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(FjsCheckboxGroup, { onChange: (v: string) => changes.push(v) }, () => [
        h(FjsCheckbox, { name: 'a' }),
        h(FjsCheckbox, { name: 'b' }),
        h(FjsCheckbox, { name: 'c' }),
      ]),
    );
    const boxes = host.querySelectorAll('checkbox');

    await click(boxes[2]);
    await click(boxes[0]);
    expect(changes).toEqual(['["c"]', '["a","c"]']);

    await click(boxes[0]);
    expect(changes.at(-1)).toBe('["c"]');
  });

  it('starts from an empty array', async () => {
    const changes: string[] = [];
    const host = mount(() =>
      h(FjsCheckboxGroup, { onChange: (v: string) => changes.push(v) }, () => [
        h(FjsCheckbox, { name: 'a', value: true }),
      ]),
    );
    await click(host.querySelector('checkbox'));
    expect(changes).toEqual(['[]']);
  });
});

describe('label', () => {
  it('forwards a tap to the control named by `for`', async () => {
    const host = mount(() =>
      h(FjsLabel, { for: 'agree' }, () => [
        h('text', null, '同意'),
        h(FjsCheckbox, { id: 'agree' }),
      ]),
    );
    await click(host.querySelector('label'));
    expect(host.querySelector('.fjs-checkbox')?.className).toContain('on');
  });

  it('without `for`, takes the first control under it', async () => {
    const host = mount(() =>
      h(FjsLabel, null, () => [h('text', null, '开关'), h(FjsSwitch, {})]),
    );
    await click(host.querySelector('label'));
    expect(host.querySelector('switch')?.className).toContain('on');
  });

  it('focuses an input instead of toggling it', async () => {
    const host = mount(() =>
      h(FjsLabel, null, () => [h('text', null, '昵称'), h(FjsInput, {})]),
    );
    await click(host.querySelector('label'));
    expect(document.activeElement).toBe(host.querySelector('input'));
  });

  it('does not double-toggle when the control itself is clicked', async () => {
    const host = mount(() =>
      h(FjsLabel, null, () => [h('text', null, '开关'), h(FjsSwitch, {})]),
    );
    await click(host.querySelector('switch'));
    expect(host.querySelector('switch')?.className).toContain('on');
  });

  it('warns once when there is nothing to activate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(() =>
      h(FjsLabel, { for: 'nope' }, () => [h(FjsCheckbox, { id: 'other' })]),
    );
    await click(host.querySelector('label'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('for="nope"');
  });
});

describe('form', () => {
  it('collects every named control, untouched ones included', async () => {
    const payloads: string[] = [];
    const resets: number[] = [];
    const host = mount(() =>
      h(
        FjsForm,
        {
          onSubmit: (v: string) => payloads.push(v),
          onReset: () => resets.push(1),
        },
        () => [
          h(FjsInput, { name: 'nickname' }),
          h(FjsSwitch, { name: 'agree' }),
          h(FjsCheckboxGroup, { name: 'tags' }, () => [
            h(FjsCheckbox, { name: 'x' }),
            h(FjsCheckbox, { name: 'y' }),
          ]),
          h(FjsRadioGroup, { name: 'plan' }, () => [
            h(FjsRadio, { name: 'free' }),
          ]),
          h(FjsButton, { formType: 'submit' }, () => 'go'),
          h(FjsButton, { formType: 'reset' }, () => 'clear'),
        ],
      ),
    );

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'zhe';
    input.dispatchEvent(new Event('input'));
    await click(host.querySelector('switch'));
    await click(host.querySelectorAll('checkbox')[1]);

    const buttons = host.querySelectorAll('button');
    await click(buttons[0]);
    // Key order is mount order, i.e. document order — the same order
    // widgets/form.dart produces, which is what makes the two payloads
    // compare equal byte for byte. Untouched controls carry their default
    // (spec Q3), and a nested group contributes one key, not its members'.
    expect(payloads).toEqual([
      '{"nickname":"zhe","agree":true,"tags":["y"],"plan":""}',
    ]);

    await click(buttons[1]);
    expect(resets).toEqual([1]);
  });

  it('warns once about two controls sharing a name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount(() =>
      h(FjsForm, { onSubmit: () => {} }, () => [
        h(FjsInput, { name: 'dup', value: 'a' }),
        h(FjsInput, { name: 'dup', value: 'b' }),
        h(FjsButton, { formType: 'submit' }, () => 'go'),
      ]),
    );
    await click(host.querySelector('button'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"dup"');
  });

  it('a disabled or loading submit button does nothing', async () => {
    const payloads: string[] = [];
    const host = mount(() =>
      h(FjsForm, { onSubmit: (v: string) => payloads.push(v) }, () => [
        h(FjsButton, { formType: 'submit', loading: true }, () => 'go'),
      ]),
    );
    await click(host.querySelector('button'));
    expect(payloads).toEqual([]);
  });
});

describe('input', () => {
  // specs/125: the DOM attributes a page (or vant) writes are kept
  it('keeps the page\'s type and enterkeyhint', () => {
    const host = mount(() => [
      h(FjsInput, { type: 'password' }),
      h(FjsInput, { type: 'tel', inputmode: 'numeric', enterkeyhint: 'done' }),
      h(FjsInput, { type: 'password', keyboard: 'number' }),
      h(FjsInput, {}),
    ]);
    const inputs = host.querySelectorAll('input');
    expect(inputs[0].getAttribute('type')).toBe('password');
    expect(inputs[1].getAttribute('type')).toBe('tel');
    expect(inputs[1].getAttribute('inputmode')).toBe('numeric');
    expect(inputs[1].getAttribute('enterkeyhint')).toBe('done');
    // the fjs prop wins over the DOM attribute
    expect(inputs[2].getAttribute('type')).toBe('number');
    expect(inputs[3].getAttribute('type')).toBe('text');
  });

  it('emits focus and blur with the current text', async () => {
    const seen: Array<[string, string]> = [];
    const host = mount(() =>
      h(FjsInput, {
        value: 'hi',
        onFocus: (v: string) => seen.push(['focus', v]),
        onBlur: (v: string) => seen.push(['blur', v]),
      }),
    );
    const input = host.querySelector('input') as HTMLInputElement;
    input.focus();
    input.blur();
    await nextTick();
    expect(seen).toEqual([
      ['focus', 'hi'],
      ['blur', 'hi'],
    ]);
  });

  it('caps the text at maxlength and treats -1 as no limit', async () => {
    const capped = mount(() => h(FjsInput, { maxlength: 5 }));
    expect(
      (capped.querySelector('input') as HTMLInputElement).getAttribute(
        'maxlength',
      ),
    ).toBe('5');
    const free = mount(() => h(FjsInput, { maxlength: -1 }));
    expect(
      (free.querySelector('input') as HTMLInputElement).getAttribute(
        'maxlength',
      ),
    ).toBeNull();
  });
});
