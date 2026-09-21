/* Host-side loader for the pluggable debugger module (spec 090).
 *
 * Mirrors lib/src/ffi.dart on purpose: the engine is already in the process,
 * and attach/detach live ONLY in libfjs_debugger — so the host must dlopen it
 * and degrade to "this build cannot debug" when the file is absent, which is
 * what a release build looks like. Keeping the host tools on the same path as
 * Dart means the desktop suite actually proves the module is pluggable.
 */
#ifndef FJS_TOOLS_DEBUGGER_MODULE_H
#define FJS_TOOLS_DEBUGGER_MODULE_H

#include <dlfcn.h>

#include <string>

#include "fjs.h"

struct FjsDebuggerModule {
    int32_t (*attach)(FJSVM *, const char *, int32_t) = nullptr;
    int32_t (*detach)(FJSVM *) = nullptr;
    void *handle = nullptr;

    bool loaded() const { return attach && detach; }
};

inline FjsDebuggerModule fjs_load_debugger_module() {
    FjsDebuggerModule m;
#ifdef __APPLE__
    static const char kName[] = "libfjs_debugger.dylib";
#else
    static const char kName[] = "libfjs_debugger.so";
#endif
    /* The module sits next to the engine it extends; ask the loader where
     * the engine came from instead of guessing a working directory. */
    std::string path = kName;
    Dl_info info;
    if (dladdr(reinterpret_cast<void *>(&fjs_vm_create), &info) &&
        info.dli_fname) {
        std::string engine = info.dli_fname;
        size_t slash = engine.rfind('/');
        if (slash != std::string::npos)
            path = engine.substr(0, slash + 1) + kName;
    }
    m.handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!m.handle) m.handle = dlopen(kName, RTLD_NOW | RTLD_LOCAL);
    if (!m.handle) return m;
    m.attach = reinterpret_cast<int32_t (*)(FJSVM *, const char *, int32_t)>(
        dlsym(m.handle, "fjs_vm_debugger_attach"));
    m.detach = reinterpret_cast<int32_t (*)(FJSVM *)>(
        dlsym(m.handle, "fjs_vm_debugger_detach"));
    return m;
}

#endif /* FJS_TOOLS_DEBUGGER_MODULE_H */
