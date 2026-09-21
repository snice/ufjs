/*
 * fjs — JS/TS runtime for Flutter, JSI-style C ABI.
 *
 * This header is the single boundary between the Dart host (via dart:ffi)
 * and the C++ core (embedding QuickJS-ng). All functions are pure C,
 * pointer-based, and callable from Dart's FFI.
 *
 * Threading contract (v1): every function must be called from the thread
 * that owns the Dart isolate. JS execution is fully synchronous; the host
 * drives the event loop via fjs_vm_pump().
 */
#ifndef FJS_H
#define FJS_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FJS_ABI_VERSION 2

/* Engine identity. Must match the header inside .fjsbundle files produced
 * by `fjs build --bytecode`. See docs/toolchain.md for the lockstep rule. */
const char *fjs_engine_id(void);   /* e.g. "quickjs-ng-0.9.0" */
int32_t     fjs_abi_version(void);

typedef struct FJSVM FJSVM;

/* ---- shared enums -------------------------------------------------- */

enum {
    FJS_LOG_DEBUG = 0,
    FJS_LOG_INFO  = 1,
    FJS_LOG_WARN  = 2,
    FJS_LOG_ERROR = 3,
};

/* UI events flowing host -> JS (gesture/text callbacks on Flutter side). */
enum {
    FJS_EVENT_TAP             = 1,
    FJS_EVENT_LONG_PRESS      = 2,
    FJS_EVENT_TEXT_CHANGED    = 3, /* params: utf8 text */
    FJS_EVENT_TEXT_SUBMITTED  = 4, /* params: utf8 text */
    FJS_EVENT_VALUE_CHANGED   = 5, /* params: "1"/"0" or numeric string */
    FJS_EVENT_PAGE_CHANGED    = 6, /* params: index string */
    FJS_EVENT_MODAL_CLOSED    = 7,
    FJS_EVENT_REFRESH         = 8,
    FJS_EVENT_WORKER_MESSAGE  = 9, /* worker <-> main messaging (nodeId=workerId) */
    FJS_EVENT_NAV_MOUNT       = 10, /* native route is ready; JS mounts page */
    FJS_EVENT_NAV_POP         = 11, /* native route was removed */
    FJS_EVENT_SCROLL          = 12, /* params: {scrollTop,scrollLeft,scrollHeight,
                                       scrollWidth,deltaX,deltaY} JSON */
    /* 13-19 are runtime-internal (dev reload, http, touch, raf); see
       lib/src/ffi.dart. The engine only relays these numbers — nothing in
       native/ interprets them — so this enum is the contract's only doc. */
    FJS_EVENT_FOCUS           = 20, /* params: the field's current text */
    FJS_EVENT_BLUR            = 21, /* params: the field's current text */
    FJS_EVENT_FORM_SUBMIT     = 22, /* params: {name: value} JSON string */
    FJS_EVENT_FORM_RESET      = 23,
    FJS_EVENT_SCROLL_TO_UPPER = 24,
    FJS_EVENT_SCROLL_TO_LOWER = 25,
    /* A node's resource loaded / failed. The payload's SHAPE is the tag's:
       image sends {"width":n,"height":n}, web-view sends {"src":"..."}.
       Named for the event, not for one tag, because a template's `@load`
       becomes the prop `onLoad` whatever the tag is. */
    FJS_EVENT_LOAD             = 26,
    FJS_EVENT_ERROR            = 27, /* params: {"errMsg":"..."} plus tag's */
    FJS_EVENT_LINE_CHANGE      = 28, /* params: {"height":n,"lineCount":n} */
    FJS_EVENT_MESSAGE          = 29, /* params: {"data":"..."} JSON */
    /* A canvas subsystem callback for the node. One number for three
       messages, discriminated by the payload's "t": {"t":"size",...} when
       the box was laid out or resized, {"t":"image",...} when loadImage
       finished, {"t":"dataurl",...} when toDataURL finished. They belong to
       one subsystem and event numbers are scarce, so they share a number
       rather than taking three. */
    FJS_EVENT_CANVAS           = 30,
    /* the route's push transition finished (nodeId = the route key, no
       params). Lets a page defer expensive first-paint work until the
       animation is over — see fjs-runtime/src/router onPageSettled. */
    FJS_EVENT_NAV_SETTLED      = 31,
    /* one invokeHostAsync() call finished (nodeId = the call id JS allocated).
       Payload is a fixed JSON string, "ok" first: success
       {"ok":true,"value":<JSON>} (value absent when the handler returned
       null/undefined), failure {"ok":false,"errMsg":"..."}. The call is
       initiated synchronously through invokeHost('fjs.async.invoke', id,
       name, argsJson) — the fetch paradigm, generalized; see
       fjs-runtime/src/host-async.ts and engine.dart's built-in handler. */
    FJS_EVENT_ASYNC_RESULT     = 32,
    /* the Flutter window's logical size changed (nodeId = 0, no per-node
       identity — the viewport belongs to the app). Payload is a fixed JSON
       string {"width":n,"height":n}, one decimal place, logical pixels —
       the same basis as a browser viewport's CSS pixels. The Dart side
       pushes one right after every VM start (specs/043-media-queries),
       so JS never has to ask. Consumed by the CSS engine's @media support;
       web does not need this (the browser evaluates @media itself). */
    FJS_EVENT_VIEWPORT_CHANGED = 33,
    /* sticky-header's pin state flipped (specs/052). Payload is the JSON
       {"isStickOnTop":boolean} — a string, like every event payload. */
    FJS_EVENT_STICK_ON_TOP_CHANGE = 34,
    /* page-container's transition lifecycle (specs/065). No params. The
       leave chain fires on every close path, including a JS-driven
       show=false, because the native side owns the animation clock. */
    FJS_EVENT_BEFORE_ENTER     = 35,
    FJS_EVENT_ENTER            = 36,
    FJS_EVENT_AFTER_ENTER      = 37,
    FJS_EVENT_BEFORE_LEAVE     = 38,
    FJS_EVENT_LEAVE            = 39,
    FJS_EVENT_AFTER_LEAVE      = 40,
    FJS_EVENT_CLICK_OVERLAY    = 41,
    /* a CSS transform/opacity transition ran to its end (specs/073). No
       params; a retarget mid-flight cancels it without the event. */
    FJS_EVENT_TRANSITION_END   = 42,
    /* a pointer went down anywhere (specs/073); nodeId = the deepest node
       under it, 0 for none; payload {"x":n,"y":n}. System event. */
    FJS_EVENT_GLOBAL_POINTER_DOWN = 43,
};

/* Tagged value tags for the FJSValue C ABI struct. */
enum {
    FJS_T_NULL    = 0,
    FJS_T_BOOL    = 1,
    FJS_T_INT32   = 2,
    FJS_T_FLOAT64 = 3,
    FJS_T_STRING  = 4, /* u.s = utf8 pointer, valid only during the call */
};

/*
 * A tagged value crossing the JSI boundary. Kept as flat fields (not a
 * union) so dart:ffi can mirror the exact layout.
 *
 * Strings are NOT copied by the engine:
 *  - JS -> host: u.s points to utf8 owned by QuickJS, valid only for the
 *    duration of the callback.
 *  - host -> JS (out param of fjs_invoke_host): the host must malloc() the
 *    utf8 buffer and the engine free()s it after conversion.
 * Layout (64-bit): tag@0 i@4 d@8 s@16 len@24, size 32.
 */
typedef struct FJSValue {
    int32_t tag;
    int32_t i;          /* FJS_T_BOOL (0/1), FJS_T_INT32 */
    double  d;          /* FJS_T_FLOAT64 */
    const char *s;      /* FJS_T_STRING */
    int32_t len;        /* byte length when tag == FJS_T_STRING */
    int32_t _pad;       /* keep 8-byte alignment */
} FJSValue;

/* ---- embedder callbacks (all synchronous, same thread as VM) -------- */

typedef void (*fjs_on_log_fn)(int32_t level, const char *msg, int32_t len);
typedef void (*fjs_on_ui_ops_fn)(const uint8_t *ops, int32_t len);

/* Host module invocation from JS: __fjs.invokeHost(name, ...args).
 * Writes the return value into *out, returns 0 on success, -1 if the
 * host threw (engine raises a JS TypeError with the host's message). */
typedef int32_t (*fjs_invoke_host_fn)(const char *name, int32_t argc,
                                      const FJSValue *args, FJSValue *out);

/* ---- VM lifecycle --------------------------------------------------- */

FJSVM *fjs_vm_create(void);
void   fjs_vm_destroy(FJSVM *vm);

/* Install embedder callbacks before evaluating anything. NULL disables. */
void fjs_set_callbacks(FJSVM *vm, fjs_on_log_fn on_log,
                       fjs_on_ui_ops_fn on_ui_ops,
                       fjs_invoke_host_fn on_invoke_host);

/* JS `__fjs.toast(msg)` lands here (separate from fjs_set_callbacks so the
 * core ABI stays stable). May be set before or after VM creation. */
typedef void (*fjs_on_toast_fn)(const char *msg, int32_t len);
void fjs_set_toast_callback(FJSVM *vm, fjs_on_toast_fn on_toast);

/* Evaluate utf8 JS source (script, not module). Returns 0 on success,
 * -1 on JS exception or invalid arguments. Message via fjs_last_error(). */
int32_t fjs_vm_eval_source(FJSVM *vm, const uint8_t *src, int32_t len,
                           const char *filename);

/* Evaluate a .fjsbundle (engine-id header + QuickJS bytecode).
 * Validates magic, format version and engine id before loading. */
int32_t fjs_vm_eval_bundle(FJSVM *vm, const uint8_t *bundle, int32_t len);

/* Run due timers and pending promise jobs. now_ms is a monotonic clock in
 * milliseconds (host decides the epoch). Returns the number of callbacks
 * + jobs executed. */
int32_t fjs_vm_pump(FJSVM *vm, int64_t now_ms);

/* The engine's monotonic clock in ms. Hosts MUST drive fjs_vm_pump with
 * this value (or any clock sharing its epoch) so timer deadlines line up. */
int64_t fjs_vm_now(FJSVM *vm);

/* Heap size in bytes and live object count, WITHOUT collecting.
 *
 * `__fjs.fns.gc()` reports the same two numbers, but it has to run a full
 * mark-and-sweep to get them — which is the wrong tool for a monitor that
 * samples once a second: it would be forcing the very collections whose cost
 * it exists to show. Either pointer may be NULL.
 *
 * Added after FJS_ABI_VERSION 1 shipped, so a host must treat the symbol as
 * OPTIONAL: look it up, and degrade gracefully when an older engine binary
 * does not export it. */
void fjs_vm_heap(FJSVM *vm, int64_t *bytes, int64_t *objects);

/* Dispatch a UI event to the JS runtime. Calls the global function
 * __fjsDispatchEvent(nodeId, eventType, paramsOrNull) if it exists.
 * params is utf8 (may be NULL / len 0). Returns 0 ok, -1 JS exception. */
int32_t fjs_vm_dispatch_event(FJSVM *vm, int32_t node_id, int32_t event_type,
                              const uint8_t *params, int32_t len);

/* Last error message for this VM (thread-local static buffer, valid until
 * the next fjs_* call on the same VM). Empty string when no error. */
const char *fjs_last_error(FJSVM *vm);

/* Compile utf8 JS source into .fjsbundle bytes (header + QuickJS bytecode)
 * using this VM's engine. Writes up to cap bytes into out and returns the
 * total length needed; pass out=NULL/cap=0 to query the size first.
 * Returns -1 on compile error (message via fjs_last_error). */
int32_t fjs_compile_bundle(FJSVM *vm, const uint8_t *src, int32_t len,
                           uint8_t *out, int32_t cap);

/* ---- devtools debugger (spec 088/090) --------------------------------- */

/* The engine contains NO debugger: the inspector (CDP semantics) and the
 * transport (a TCP client that dials the `fjs debug` relay) both live in
 * the separate module libfjs_debugger, which release builds do not ship.
 * All the engine holds is an empty hook table the module fills at attach,
 * so before attach — and in any build without the module — there is
 * nothing to reach. Dart opens the module and calls its attach/detach:
 *
 *   int32_t fjs_vm_debugger_attach(FJSVM *vm, const char *host, int32_t port);
 *   int32_t fjs_vm_debugger_detach(FJSVM *vm);
 *
 * Attach enables the inspector for this VM before scripts are evaluated
 * (the Dart side reloads afterwards so every script registers), then serves
 * the CDP session on the JS thread. Both symbols are OPTIONAL for hosts
 * (same rule as fjs_vm_heap): a build without the plugin module simply has
 * no debugger. */

/* Transport seam between the engine and libfjs_debugger. The module owns
 * the socket and ALL line I/O; the engine only says WHEN to pump queued
 * frontend messages (fjs_vm_pump) and WHEN everything must be shut down
 * (VM teardown). The OTHER seam — the six inspector entry points the
 * interpreter calls — is internal to the vendored engine; see
 * primjs/src/interpreter/quickjs/include/inspector_hooks.h. */
typedef struct FjsDebuggerTransport FjsDebuggerTransport;
struct FjsDebuggerTransport {
    void *opaque;
    /* Called from fjs_vm_pump: feed any queued frontend lines. */
    void (*feed)(void *opaque, FJSVM *vm);
    /* Called when the frontend sends Debugger.resume: the transport must
     * unblock its pause loop so the engine can continue. */
    void (*quit)(void *opaque);
    /* Called once at VM teardown, before the context is freed. */
    void (*close)(void *opaque);
};

/* Installs (t != NULL) or clears (t == NULL) the transport for this VM.
 * While installed, fjs_vm_pump feeds frontend messages through it and the
 * inspector's pause loop reads from it. NOT part of the exported ABI
 * contract beyond the engine itself — the pluggable module uses it. */
void fjs_debugger_set_transport(FJSVM *vm, const FjsDebuggerTransport *t);

/* Exported by the PLUGGABLE MODULE (libfjs_debugger), not by libfjs — see
 * the comment above. Signatures kept here so hosts that ship the module
 * have the exact contract in one place. */
int32_t fjs_vm_debugger_attach(FJSVM *vm, const char *host, int32_t port);
int32_t fjs_vm_debugger_detach(FJSVM *vm);

/* ---- binary handles (FJS_ABI_VERSION 2, spec 038) -------------------- */

/* Bytes live in a VM-owned table so binary bodies (fetch request/response)
 * cross the boundary as an int handle instead of base64 inside JSON. Ids
 * are monotonic and NEVER reused: a stale id — any handle outliving its VM,
 * or one already released — always misses and reads as absent, never as
 * someone else's bytes. */
/* Stores a copy of the bytes and returns the handle id; pass id=0 to have
 * the VM assign one (the common case: the host does not track ids). */
int64_t fjs_handle_put_bytes(FJSVM *vm, int64_t id,
                             const uint8_t *data, int32_t len);

/* Borrows the bytes for reading (Dart copies out of them). *data is NULL
 * and *len 0 when the id is unknown or already released. The pointer stays
 * valid until fjs_handle_release / fjs_vm_destroy on this VM. */
void fjs_handle_bytes(FJSVM *vm, int64_t id,
                      const uint8_t **data, int32_t *len);

void fjs_handle_release(FJSVM *vm, int64_t id);

/* ---- .fjsbundle format ---------------------------------------------- */
/*
 * layout (all integers little-endian):
 *   [0..4)   magic  "FJSB"
 *   [4..6)   u16 format version (currently 1)
 *   [6..8)   u16 engine-id byte length L
 *   [8..8+L) engine id utf8 (e.g. "quickjs-ng-0.9.0")
 *   [8+L..)  QuickJS bytecode (JS_WriteObject, JS_WRITE_OBJ_BYTECODE)
 */

/* Validates the bundle; on success returns 0 and fills engine_id_out
 * (pointer into the buffer), payload offset/length. Returns -1 with a
 * reason in *err_out (static buffer) on failure. */
int32_t fjs_bundle_check(const uint8_t *bundle, int32_t len,
                         const char **engine_id_out,
                         int32_t *payload_off, int32_t *payload_len,
                         const char **err_out);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* FJS_H */
