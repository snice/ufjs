// `fjs/vapor` for web, WITH the VDOM interop (specs/166 split): the DOM
// backend (web-dom.ts) plus the vdom-into-vapor mount and the compile-time
// wrapper's adopt path (web-interop.ts). This is the default web surface —
// an app with vapor AND vdom on the same page needs both halves. An
// enableVapor app aliases `fjs/vapor` to `web-pure.ts`, which ships web-dom
// alone.
export * from './web-dom';
export * from './web-interop';
