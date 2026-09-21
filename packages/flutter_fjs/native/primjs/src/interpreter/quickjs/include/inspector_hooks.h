// fjs local patch (specs/090-devtools-split) — not upstream PrimJS.
//
// The interpreter reaches the inspector through exactly six functions. Calling
// them directly forces the inspector's ~430 KB of CDP semantics into every
// build of the engine, including releases that must not be debuggable at all.
// Routing them through this table instead lets the inspector live in its own
// module (libfjs_debugger.so / libfjs_debugger.a) that release builds simply
// do not ship: no table entries, no way in.
//
// The table is filled by the debugger module at attach and cleared at detach.
// The engine must NOT define fallbacks under the upstream names — a same-named
// forwarder in the engine would preempt the module's own definitions at
// dynamic-link time and turn every inspector call into infinite recursion.
//
// Cost when absent: one already-predicted null check at nine call sites, all
// of which sit behind the pre-existing `#ifdef ENABLE_QUICKJS_DEBUGGER` plus a
// runtime flag (is_debug_mode / debugger_mode / debugger_need_polling).

#ifndef SRC_INTERPRETER_QUICKJS_INCLUDE_INSPECTOR_HOOKS_H_
#define SRC_INTERPRETER_QUICKJS_INCLUDE_INSPECTOR_HOOKS_H_

#include <stddef.h>
#include <stdint.h>

#include "quickjs/include/base_export.h"
#include "quickjs/include/quickjs.h"

struct JSFunctionDef;
struct LEPUSScriptSource;
struct LEPUSFunctionBytecode;

#ifdef __cplusplus
extern "C" {
#endif

typedef struct QJSInspectorHooks {
  // inspector/interface.h: DoInspectorCheck
  void (*inspector_check)(LEPUSContext *ctx);
  // quickjs-inner.h: DebuggerPause
  void (*debugger_pause)(LEPUSContext *ctx, LEPUSValue val, const uint8_t *pc);
  // inspector/interface.h: HandleDebuggerException
  void (*debugger_exception)(LEPUSContext *ctx);
  // inspector/debugger_inner.h: AdjustBreakpoints
  void (*adjust_breakpoints)(LEPUSContext *ctx, struct LEPUSScriptSource *s);
  // inspector/debugger_inner.h: DebuggerParseScript
  void (*parse_script)(LEPUSContext *ctx, const char *input, size_t input_len,
                       struct JSFunctionDef *fd, const char *filename,
                       int32_t end_line_num, int32_t err,
                       int start_line_number);
  // inspector/debugger_inner.h: DebuggerSetFunctionBytecodeScript
  void (*set_function_bytecode_script)(LEPUSContext *ctx,
                                       struct JSFunctionDef *fd,
                                       struct LEPUSFunctionBytecode *b);
} QJSInspectorHooks;

// NULL until a debugger module installs itself; back to NULL after detach.
QJS_EXPORT_FOR_DEVTOOL extern const QJSInspectorHooks *qjs_inspector_hooks;

QJS_EXPORT_FOR_DEVTOOL void QJSSetInspectorHooks(const QJSInspectorHooks *h);

#ifdef __cplusplus
}
#endif

#endif  // SRC_INTERPRETER_QUICKJS_INCLUDE_INSPECTOR_HOOKS_H_
