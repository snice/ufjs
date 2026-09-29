// specs/158 hostile variant: must run before bench.ts module-evaluates
// (import order, same rule as mode-ts.ts). Plants the two pieces of global
// state the unmount walk used to re-read per subtree element — a hoisted
// fixed element (hoistedFrom) and a fired `.once` handler (onceFired).
(globalThis as { __fjsBenchHostile?: boolean }).__fjsBenchHostile = true;
