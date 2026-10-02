// SFC <style> injection on web (specs/168): its own leaf module because the
// compiler emits an import of it into EVERY component with a <style> block.
// It used to come from 'fjs/web', whose entry statically imports the whole
// VDOM web component table (canvas 2d, form, rich-text, picker…) — a
// pure-vapor app never instantiates any of them (vapor templates compile
// fjs tags to native elements) yet carried ~100 KB of them for this one
// function. The generated code imports 'fjs/web-style' instead; 'fjs/web'
// re-exports it for user code.
import { rewriteFjsCss } from './css-compat';

const injected = new Set<string>();

/** Adds one SFC <style> block to the document. Called by the code the fjs
 * esbuild plugin injects; `key` dedupes across hot reloads and repeated
 * imports of the same component. */
export function injectStyle(key: string, css: string): void {
  if (injected.has(key)) return;
  injected.add(key);
  const style = document.createElement('style');
  style.setAttribute('data-fjs', key);
  style.textContent = rewriteFjsCss(css);
  document.head.appendChild(style);
}
