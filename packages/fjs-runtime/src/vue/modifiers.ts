// Event modifier helpers shared by the 'vue' shim and the runtime-dom shim
// (specs/148: Vapor components compile `@tap.stop` against the latter).

/** Key filters (`@keyup.enter`) degenerate to pass-through: fjs events carry
 * no key codes, so the guard has nothing to test — the handler runs on every
 * event instead of never. */
export function withKeys<T extends (event: unknown) => void>(fn: T): T {
  return fn;
}

/** The event shape modifier guards read. On the app side a handler gets
 * renderer.ts asDomEvent()'s object (stopPropagation / preventDefault /
 * target / currentTarget are real there) or a touch event; key and button
 * fields are absent, which reads as "not pressed" / "not a mouse button". */
interface ModifierEvent {
  stopPropagation?(): void;
  preventDefault?(): void;
  target?: unknown;
  currentTarget?: unknown;
  button?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

const SYSTEM_MODIFIERS = ['ctrl', 'shift', 'alt', 'meta'] as const;

/** runtime-dom's modifierGuards: a guard returning true skips the handler. */
const MODIFIER_GUARDS: Record<string, (e: ModifierEvent, modifiers: string[]) => boolean | void> = {
  stop: (e) => e.stopPropagation?.(),
  prevent: (e) => e.preventDefault?.(),
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey,
  shift: (e) => !e.shiftKey,
  alt: (e) => !e.altKey,
  meta: (e) => !e.metaKey,
  left: (e) => 'button' in e && e.button !== 0,
  middle: (e) => 'button' in e && e.button !== 1,
  right: (e) => 'button' in e && e.button !== 2,
  exact: (e, modifiers) =>
    SYSTEM_MODIFIERS.some((m) => e[`${m}Key`] && !modifiers.includes(m)),
};

/** Event modifiers (`@click.stop`, vant/NutUI's precompiled
 * `withModifiers(onClose, ["stop"])`), runtime-dom's semantics. Unlike key
 * filters these CAN be honoured: the app's tap event carries a working
 * stopPropagation() (the tap bubbles, ui/element.ts) and target /
 * currentTarget. Wrappers are cached on the handler like runtime-dom does,
 * so a re-render hands the renderer the same function and the prop does not
 * churn (specs/139: NutUI Tag's close icon). */
export function withModifiers<T extends (event: ModifierEvent, ...args: unknown[]) => unknown>(
  fn: T & { _withMods?: Record<string, T> },
  modifiers: string[],
): T {
  const cache = (fn._withMods ??= {});
  const key = modifiers.join('.');
  return (cache[key] ??= ((event: ModifierEvent, ...args: unknown[]) => {
    for (const modifier of modifiers) {
      const guard = MODIFIER_GUARDS[modifier];
      if (guard && event && typeof event === 'object' && guard(event, modifiers)) return;
    }
    return fn(event, ...args);
  }) as T);
}
