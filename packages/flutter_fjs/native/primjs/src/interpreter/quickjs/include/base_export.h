// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

#ifndef SRC_INTERPRETER_QUICKJS_INCLUDE_BASE_EXPORT_H_
#define SRC_INTERPRETER_QUICKJS_INCLUDE_BASE_EXPORT_H_

#if defined(WIN32)
// fjs local patch (specs/114-fjsc-dual-engine): upstream marks everything
// __declspec(dllimport) because it consumes PrimJS as a DLL. fjs only builds
// Windows host tools (fjsc, fjsrun, fjs-test) that link the engine
// statically, where dllimport on a definition is an error ("definition of
// dllimport data", inspector_hooks.cc) and on a reference just adds an
// indirection. Plain declarations are right for a static archive.
#define QJS_EXPORT
#define QJS_EXPORT_FOR_DEVTOOL
#define QJS_HIDE
#elif defined(FJS_EXPORT_ENGINE_INTERNALS)
// fjs local patch (specs/090-devtools-split): the inspector is built as a
// separate module (libfjs_debugger), so the ~two dozen engine internals it
// uses must cross the .so boundary. Upstream can hide them because it links
// the inspector into the engine; we cannot. Widening the whole QJS_HIDE set
// instead of annotating individual declarations keeps the patch to one file
// and survives PrimJS upgrades — the cost is a larger dynamic symbol table.
#define QJS_EXPORT __attribute__((visibility("default")))
#define QJS_EXPORT_FOR_DEVTOOL __attribute__((visibility("default")))
#define QJS_HIDE __attribute__((visibility("default")))
#else  // defined(WIN32)
#define QJS_EXPORT __attribute__((visibility("default")))
#define QJS_EXPORT_FOR_DEVTOOL __attribute__((visibility("default")))
#define QJS_HIDE __attribute__((visibility("hidden")))
#endif  // defined(WIN32)

#endif  // SRC_INTERPRETER_QUICKJS_INCLUDE_BASE_EXPORT_H_
