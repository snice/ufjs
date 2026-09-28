// libfjs-style — the per-element half of the fjs style engine (specs/150).
//
// Pure C++17 behind a C ABI, with no JS engine in it: libfjs's PrimJS and
// quickjs-ng flavors each bind it with a thin natives layer, and any other
// host can do the same. It keeps the element tree (read from the UI op frames
// on their way to Dart), the style inputs (tag / classes / scopes / inline
// key), signatures, the match and compute caches, selector matching, dirty
// tracking and the flush that writes SetStyle / DefineStyle. CSS semantics —
// folding a match into a cascade, inheritance, var(), em, calc, keyframes —
// stay in the host (fjs-runtime's StyleEngine), reached through callbacks
// that fire once per DISTINCT match set / computed style, not per element.
//
// Frame flow: the host hands every UI frame to fjs_style_process. Structural
// ops pass through untouched (and update the tree), style input ops (opcodes
// >= FJS_STYLE_OP_FIRST) are consumed, and the flush appends SetStyle /
// SetHoverStyle / DefineStyle for every element whose style changed. The
// output frame is what Dart decodes; the Dart protocol does not change.
#ifndef FJS_STYLE_H
#define FJS_STYLE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct fjs_style fjs_style;

// ---- style input ops (host -> libfjs-style, never reach Dart) --------------
//
// Little-endian like the rest of the frame. Atoms are host-interned integer
// ids for tag / class / scope names; an atom is defined before its first use
// and never redefined.
//
//  0x40 ATOM      u32 atom, u16 len, utf8 name
//  0x41 EL        u32 id, u32 tagAtom, u32 defaultsId, u8 flags
//                   flags bit0: raw text (a synthesized text run: no sibling
//                   position, see StyleEngine.ensure). Registers the element;
//                   unregistered nodes (anchors, pseudo boxes, overlay hosts)
//                   never match and are skipped by sibling position.
//  0x42 CLASSES   u32 id, u16 n, u32 atom[n]   replaces the class set
//  0x43 SCOPE     u32 id, u32 scopeAtom        adds a scope
//  0x44 INLINE    u32 id, u32 inlineKey        0 = no inline style; the key
//                   joins the compute cache key (the host resolves the style)
//  0x45 FORGET    u32 id                       drops the element's state
//  0x46 RESTYLE   u32 id, u8 subtree           recompute (a host-side input
//                   changed); id 0 = every element, with the caches dropped
//  0x47 RULES     u32 len, <rule table>        replaces the rule table; every
//                   cache is dropped and every element recomputed
//  0x48 ATTR      u32 id, u32 nameAtom, u8 present, u32 len, utf8 value
//                   a reported attribute (data-* / aria-* / role / tabindex);
//                   present 0 removes it. Only names some selector tests
//                   restyle (StyleEngine.setAttribute).
//  0x49 RULES_APPEND  u32 len, <rule table>    adds rules without dropping
//                   any cache: the host sends it only for a table that cannot
//                   change a cached answer (a scoped sheet whose scope no
//                   element has carried). A table that changes the shape
//                   flags or the tested attribute names still invalidates.
//  0x4a SEED_CHAIN    u32 seed, u32 parentSeed (0 = none), <sig> self,
//                   u8 hasPrev, [<sig> prev], u32 match
//  0x4b SEED_COMPUTE  u32 match, u32 parentResult, u32 defaultsId,
//                   u32 inlineKey, u8 rawText, u32 result, u32 flags — no
//                   JSON: the first element to hit the entry asks the host
//                   through `compute` with subject.seeded set (writing JSON
//                   into the frame from JS costs more than the whole import)
//                   A build-time style snapshot (specs/119) replayed into the
//                   caches, so a page's first open runs warm: chains in tree
//                   order (seed counts up from 0 per import; a parent is an
//                   earlier seed), computes keyed as the compute cache is.
//                   <sig>: u32 tag, u16 n + class atoms, u16 n + scope atoms,
//                   u32 bits (0xffffffff = none), and for `self` only u16 n +
//                   (u32 name atom, u32 len, utf8 value) attributes.
//
// Rule table:
//   u32 nRules, then per rule:
//     u32 hostIndex        passed back in fjs_style_hit.rule
//     u32 scopeAtom        0 = global
//     u8  kind             0 plain, 1 ::before, 2 ::after, 3 ::placeholder
//     u8  nSelectors, then per selector:
//       u8  flags          bit0 :deep, bit1 :active, bit2 :hover
//       u16 specificity
//       u8  nCompounds, then per compound (source order, subject last):
//         u8  combinator   to the previous compound: 0 descendant, 1 child,
//                          2 next sibling (ignored on the first)
//         u32 tagAtom      0 = universal
//         u8  position     bit0 :first-child, bit1 :last-child,
//                          bit2 :not(:first-child), bit3 :not(:last-child)
//         u8  nClasses, u32 classAtom[nClasses]
//         u8  nClassAttr, then per `[class<op>v]` test:  u8 op, u16 len, utf8 v
//         u8  nAttr, then per `[name]` / `[name<op>v]`:   u32 nameAtom, u8 op,
//                                                         u16 len, utf8 v
//           op: 0 present (attributes only), 1 =, 2 ~=, 3 |=, 4 ^=, 5 $=, 6 *=
//   Media conditions are evaluated by the host, which leaves failing rules
//   out and resends the table when the viewport flips one. RULES_APPEND
//   host indices continue the table's.
enum {
  FJS_STYLE_OP_FIRST = 0x40,
  FJS_STYLE_OP_ATOM = 0x40,
  FJS_STYLE_OP_EL = 0x41,
  FJS_STYLE_OP_CLASSES = 0x42,
  FJS_STYLE_OP_SCOPE = 0x43,
  FJS_STYLE_OP_INLINE = 0x44,
  FJS_STYLE_OP_FORGET = 0x45,
  FJS_STYLE_OP_RESTYLE = 0x46,
  FJS_STYLE_OP_RULES = 0x47,
  FJS_STYLE_OP_ATTR = 0x48,
  FJS_STYLE_OP_RULES_APPEND = 0x49,
  FJS_STYLE_OP_SEED_CHAIN = 0x4a,
  FJS_STYLE_OP_SEED_COMPUTE = 0x4b,
};

// ---- the word stream (host -> libfjs-style) ---------------------------------
//
// The per-element inputs a mount writes for every element, as uint32 words in
// host byte order (fjs_style_process_words): under an interpreter a word
// store costs what a byte store does, and EL is 5+ words instead of 14
// bytes. Same meaning as the byte ops above; a host may use either.
//
//  1 EL       id, tagAtom, defaultsId, flags, scopeAtom (0 = none),
//             nClasses, classAtom[nClasses] (source order)
//  2 CLASSES  id, n, classAtom[n]
//  3 SCOPE    id, scopeAtom
//  4 INLINE   id, inlineKey
//  5 FORGET   id
//  6 RESTYLE  id, subtree
enum {
  FJS_STYLE_W_EL = 1,
  FJS_STYLE_W_CLASSES = 2,
  FJS_STYLE_W_SCOPE = 3,
  FJS_STYLE_W_INLINE = 4,
  FJS_STYLE_W_FORGET = 5,
  FJS_STYLE_W_RESTYLE = 6,
};

// Wire style ids libfjs-style mints start here, so they never collide with
// the ones the host's own op writer mints from 1 (anchors, pseudo boxes).
#define FJS_STYLE_WIRE_ID_BASE 0x40000000u

// One rule a new match set drew on: its best matching selector's specificity
// per cascade, -1 when no selector of that kind matched. `plain` counts
// selectors with neither :active nor :hover, `active` those without :hover,
// `hover` those without :active (StyleEngine.scanPlainBucket). Pseudo rules
// use `plain` / `active` the same way (active = any selector) and leave
// `hover` at -1. The scoped tie-break bump is NOT included: the host adds it.
// Hits are in no particular order.
typedef struct {
  uint32_t rule;
  int32_t plain;
  int32_t active;
  int32_t hover;
} fjs_style_hit;

enum {
  // The host must see every element that takes this result (fixed hoisting,
  // modal masks, pseudo boxes): libfjs-style calls `styled` for each.
  FJS_STYLE_RESULT_NOTIFY = 1,
};

// A compute callback's answer. Strings are UTF-8 JSON owned by the host and
// read only until the callback returns; NULL active / hover = none.
typedef struct {
  uint32_t result;  // host id; passed as parent_result for the children
  uint32_t flags;   // FJS_STYLE_RESULT_*
  const char* style;
  size_t style_len;
  const char* active;
  size_t active_len;
  const char* hover;
  size_t hover_len;
} fjs_style_result;

// Everything a computed style depends on, as libfjs-style knows it: the
// compute cache key plus the element and its tag. The host needs no record
// of its own per element — only per inline key and per defaults id, the two
// inputs it resolves itself.
typedef struct {
  uint32_t element;
  uint32_t match;
  uint32_t parent_result;  // 0 when the parent has no result (a root)
  uint32_t tag;            // atom
  uint32_t defaults;
  uint32_t inline_key;
  uint32_t flags;          // bit0: raw text
  // nonzero: a snapshot seeded this entry with result `seeded` but no JSON
  // (SEED_COMPUTE); the host only describes that result, computes nothing
  uint32_t seeded;
} fjs_style_subject;

typedef struct {
  void* user;
  // A match set not seen before. Returns the host's match id (nonzero), or 0
  // on failure (the frame then fails, see fjs_style_process).
  uint32_t (*define_match)(void* user, const fjs_style_hit* hits, uint32_t count);
  // A (match, parent result, defaults, raw text, inline key) combination not
  // seen before. Returns 0 on success.
  int (*compute)(void* user, const fjs_style_subject* subject, fjs_style_result* out);
  // An element took a result flagged FJS_STYLE_RESULT_NOTIFY (after its
  // SetStyle was written). May be NULL when no result is ever flagged.
  void (*styled)(void* user, uint32_t element, uint32_t result);
} fjs_style_callbacks;

typedef struct {
  uint32_t elements;
  uint32_t rules;
  uint32_t recompute;
  uint32_t match_hit;
  uint32_t match_miss;
  uint32_t compute_hit;
  uint32_t compute_miss;
  uint32_t applied;
  double flush_ms;
} fjs_style_stats;

fjs_style* fjs_style_create(const fjs_style_callbacks* callbacks);
void fjs_style_destroy(fjs_style* style);

// Consumes one UI frame. Points *out at the frame to hand Dart (valid until
// the next call on this instance) and returns 0. A malformed frame or a
// failed callback returns a negative code; *out is then the input minus the
// style input ops (as far as it parses), so Dart keeps its structure, and
// the instance refuses every later frame (-3, *out NULL): its tree may be
// out of step, the host should detach and restyle with its own engine.
int fjs_style_process(fjs_style* style, const uint8_t* in, size_t len,
                      const uint8_t** out, size_t* out_len);

// Copies `in` minus its style input ops into `out` (room for `len` bytes;
// may be `in` itself) and returns the length written — stops at the first op
// it cannot parse. What a host routes frames through once an instance has
// failed: the runtime keeps writing style ops, Dart must never see them.
size_t fjs_style_strip(const uint8_t* in, size_t len, uint8_t* out);

// fjs_style_process with a word stream (FJS_STYLE_W_*) consumed first.
int fjs_style_process_words(fjs_style* style, const uint32_t* words, size_t nwords, const uint8_t* in, size_t len,
                            const uint8_t** out, size_t* out_len);

// The host result id an element's style currently comes from (0: none yet).
uint32_t fjs_style_result_of(const fjs_style* style, uint32_t element);

// The element's class atoms (ascending, not source order), valid until the
// next fjs_style_process; returns the count. For the host's rare reads — a
// class list it would otherwise have to keep per element.
size_t fjs_style_classes_of(const fjs_style* style, uint32_t element, const uint32_t** atoms);

// The hits of the element's current match (DevTools), valid until the next
// fjs_style_process; returns the count.
size_t fjs_style_hits_of(const fjs_style* style, uint32_t element, const fjs_style_hit** hits);

void fjs_style_get_stats(const fjs_style* style, fjs_style_stats* out);
void fjs_style_reset_stats(fjs_style* style);

#ifdef __cplusplus
}
#endif

#endif  // FJS_STYLE_H
