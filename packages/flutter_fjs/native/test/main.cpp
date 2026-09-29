/*
 * Host-side smoke test for the fjs C++ core. Runs without Flutter:
 *   cmake -B build-native && cmake --build build-native && ./build-native/fjs-test
 * Exercises the full JSI surface: natives, host callbacks, timers,
 * bytecode round-trip, bundle validation, GC churn and the CDP debugger
 * (spec 088) through a real loopback socket.
 */
#include "fjs.h"

#include "debugger-module.h"

#include <atomic>
#include <cstdio>
#include <cctype>
#include <cstddef>
#include <cstring>
#include <cstdlib>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#ifndef _WIN32
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

static int g_failures = 0;

#define CHECK(cond, msg)                                                       \
    do {                                                                       \
        if (cond) {                                                            \
            printf("  ok  - %s\n", msg);                                       \
        } else {                                                               \
            printf("  FAIL - %s\n", msg);                                      \
            g_failures++;                                                      \
        }                                                                      \
    } while (0)

/* captured log lines */
static std::vector<std::string> g_logs;
static void on_log(int32_t level, const char *msg, int32_t len) {
    g_logs.emplace_back(msg, msg + len);
    printf("[log %d] %s\n", level, std::string(msg, len).c_str());
}

/* captured toasts — spec 088: while the debugger is attached, the engine
 * routes console.log through the CDP channel and the on_log path is
 * bypassed, so completion assertions there ride __fjs.toast instead. */
static std::vector<std::string> g_toasts;
static void on_toast(const char *msg, int32_t len) {
    g_toasts.emplace_back(msg, msg + len);
}

static std::vector<std::vector<uint8_t>> g_ui_batches;
static void on_ui_ops(const uint8_t *ops, int32_t len) {
    g_ui_batches.emplace_back(ops, ops + len);
}

/* host-module echo prints doubles without trailing .0 noise */
static std::string fmt_double(double d) {
    return d == (double)(long long)d ? std::to_string((long long)d)
                                     : std::to_string(d);
}

/* fake host module: echo(name, ...) -> string of uppercased args */
static int32_t on_invoke_host(const char *name, int32_t argc,
                              const FJSValue *args, FJSValue *out) {
    std::string result = "[";
    result += name;
    result += "]";
    for (int32_t i = 0; i < argc; i++) {
        result += " ";
        switch (args[i].tag) {
            case FJS_T_BOOL:  result += args[i].i ? "true" : "false"; break;
            case FJS_T_INT32: result += std::to_string(args[i].i); break;
            case FJS_T_FLOAT64: result += fmt_double(args[i].d); break;
            case FJS_T_STRING:
                for (int32_t k = 0; k < args[i].len; k++)
                    result += (char)toupper((unsigned char)args[i].s[k]);
                break;
            default: result += "null";
        }
    }
    out->tag = FJS_T_STRING;
    out->s = strdup(result.c_str()); /* engine free()s it (contract) */
    out->len = (int32_t)result.size();
    return 0;
}

static void eval_ok(FJSVM *vm, const char *src) {
    int32_t rc = fjs_vm_eval_source(vm, (const uint8_t *)src, (int32_t)strlen(src), "test.js");
    if (rc != 0) printf("  eval error: %s\n", fjs_last_error(vm));
    CHECK(rc == 0, "eval succeeds");
}

/* ---- object ABI (spec 159) fake bridge ------------------------------------ */
/* A minimal ObjectBridge in C: enough of construct/invoke/get/set/release/
 * callback to exercise proxies, callbacks, promises, GC release and stale
 * handles without a Dart host. */
static_assert(sizeof(FJSValue) == 40, "FJSValue layout: tag@0 i@4 d@8 s@16 len@24 j@32");
static_assert(offsetof(FJSValue, j) == 32, "FJSValue.j must sit at 32");

struct FakeObject {
    int value = 0;
    bool released = false;
};
static std::unordered_map<int64_t, FakeObject> g_objects;
static int64_t g_next_handle = 1;
static int64_t g_next_call = 100;
static int64_t g_pending_call = 0;
static int64_t g_last_cb_id = 0;      /* JS fn passed to onTick */
static int64_t g_last_dart_id = -1;   /* host closure the JS side called */
static int g_seen_arg_tag = -1;
static int64_t g_seen_arg_handle = -1;
static std::vector<int64_t> g_released_handles;
static FJSVM *g_obj_vm = nullptr;     /* for fjs_vm_call_callback in "loop" */

/* JS numbers cross as FJS_T_FLOAT64 (the scalar path never emits INT32);
 * only values the native side built (callback ids, handles) are INT32. */
static int as_int(const FJSValue &v) {
    return v.tag == FJS_T_INT32 ? v.i : (v.tag == FJS_T_FLOAT64 ? (int)v.d : 0);
}
static bool is_num(const FJSValue &v) {
    return v.tag == FJS_T_INT32 || v.tag == FJS_T_FLOAT64;
}

static std::string g_innermost_error;
static int32_t on_invoke_host_object(const char *name, int32_t argc,
                                     const FJSValue *args, FJSValue *out) {
    std::string n = name;
    out->tag = FJS_T_NULL;
    if (n == "fjs.object.construct") {
        FakeObject o;
        o.value = argc > 2 && is_num(args[2]) ? as_int(args[2]) : 0;
        int64_t h = g_next_handle++;
        g_objects[h] = o;
        out->tag = FJS_T_HANDLE;
        out->j = h;
        return 0;
    }
    if (n == "fjs.object.invoke") {
        int64_t h = args[0].j;
        auto it = g_objects.find(h);
        std::string member = args[1].s ? args[1].s : "";
        if (it == g_objects.end() || it->second.released) {
            out->tag = FJS_T_STRING;
            out->s = strdup("object released");
            out->len = (int32_t)strlen(out->s);
            return -1;
        }
        if (member == "add") {
            it->second.value += as_int(args[2]);
            out->tag = FJS_T_INT32;
            out->i = it->second.value;
            return 0;
        }
        if (member == "takeRef") {
            g_seen_arg_tag = args[2].tag;
            g_seen_arg_handle = args[2].tag == FJS_T_HANDLE ? args[2].j : -1;
            return 0;
        }
        if (member == "onTick") {
            g_last_cb_id = args[2].tag == FJS_T_CALLBACK ? args[2].j : 0;
            return 0;
        }
        if (member == "getPromise") {
            g_pending_call = g_next_call++;
            out->tag = FJS_T_PENDING;
            out->j = g_pending_call;
            return 0;
        }
        if (member == "makeFn") {
            out->tag = FJS_T_CALLBACK;
            out->j = -7; /* host closure id 7 */
            return 0;
        }
        if (member == "loop") {
            /* re-entry bomb: the callback calls back in; the guard's
             * message rides back as the JS exception text */
            FJSValue ret{};
            int32_t rc = fjs_vm_call_callback(g_obj_vm, g_last_cb_id, 0, nullptr, &ret);
            if (rc != 0) {
                /* first failure = innermost frame: that is where the
                 * depth guard fired, before the messages start nesting */
                if (g_innermost_error.empty()) {
                    g_innermost_error = fjs_last_error(g_obj_vm);
                }
                out->tag = FJS_T_STRING;
                out->s = strdup(fjs_last_error(g_obj_vm));
                out->len = (int32_t)strlen(out->s);
                return -1;
            }
            return 0;
        }
        if (member == "echoBack") {
            *out = args[2]; /* identity probe: the value crosses back */
            return 0;
        }
        if (member == "boom") {
            out->tag = FJS_T_STRING;
            out->s = strdup("kaboom: the detail");
            out->len = (int32_t)strlen(out->s);
            return -1;
        }
        out->tag = FJS_T_STRING;
        out->s = strdup("no such member");
        out->len = (int32_t)strlen(out->s);
        return -1;
    }
    if (n == "fjs.object.get") {
        auto it = g_objects.find(args[0].j);
        std::string member = args[1].s ? args[1].s : "";
        if (it != g_objects.end() && member == "value") {
            out->tag = FJS_T_INT32;
            out->i = it->second.value;
            return 0;
        }
        if (it != g_objects.end() && member == "allKeys") {
            /* FJS_T_JSON: the engine parses it into a real JS array */
            out->tag = FJS_T_JSON;
            out->s = strdup("[\"a\",\"b\"]");
            out->len = (int32_t)strlen(out->s);
            return 0;
        }
        out->tag = FJS_T_METHOD; /* everything else is a method here */
        return 0;
    }
    if (n == "fjs.object.set") {
        auto it = g_objects.find(args[0].j);
        std::string member = args[1].s ? args[1].s : "";
        if (it != g_objects.end() && member == "value" && is_num(args[2])) {
            it->second.value = as_int(args[2]);
        }
        return 0;
    }
    if (n == "fjs.object.release") {
        int64_t h = args[0].j;
        auto it = g_objects.find(h);
        if (it == g_objects.end() || it->second.released) return -1;
        it->second.released = true;
        g_released_handles.push_back(h);
        return 0;
    }
    if (n == "fjs.object.callback") {
        g_last_dart_id = args[0].i;
        int sum = 0;
        for (int32_t i = 1; i < argc; i++) {
            if (is_num(args[i])) sum += as_int(args[i]);
        }
        out->tag = FJS_T_INT32;
        out->i = sum;
        return 0;
    }
    if (n == "fjs.object.releaseCallback") return 0;
    /* plain invokeHost error-message path (v3) */
    out->tag = FJS_T_STRING;
    out->s = strdup("module exploded: the reason");
    out->len = (int32_t)strlen(out->s);
    return -1;
}

int main() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    printf("fjs core smoke test — engine %s, abi %d\n", fjs_engine_id(), fjs_abi_version());

    /* ---- create + natives ---- */
    FJSVM *vm = fjs_vm_create();
    CHECK(vm != nullptr, "vm created");
    fjs_set_callbacks(vm, on_log, on_ui_ops, on_invoke_host);
    fjs_set_toast_callback(vm, on_toast);

    eval_ok(vm, "console.log('hello', 1 + 2)");
    CHECK(g_logs.size() >= 1 && g_logs.back().find("hello 3") != std::string::npos,
          "console.log marshals args");

    eval_ok(vm, "globalThis.r20 = __fjs.natives.fibonacci(20)");
    eval_ok(vm, "console.log('fib20', r20)");
    CHECK(g_logs.back().find("6765") != std::string::npos, "C++ fibonacci(20) == 6765");

    eval_ok(vm, "globalThis.hostRet = __fjs.fns.invokeHost('echo', 'abc', 42, true)");
    eval_ok(vm, "console.log('host:', hostRet)");
    CHECK(g_logs.back().find("[echo] ABC 42 true") != std::string::npos,
          "invokeHost round-trips tagged values");

    /* ---- UI op buffer ---- */
    eval_ok(vm, "globalThis.u8 = new Uint8Array([1,2,3,255]); __fjs.fns.uiOps(u8); __fjs.fns.uiOps(u8.buffer);");
    CHECK(g_ui_batches.size() == 2 && g_ui_batches[0].size() == 4 &&
              g_ui_batches[0][3] == 255,
          "uiOps accepts Uint8Array and ArrayBuffer");

    /* ---- timers + pump (must use the engine's own clock) ---- */
    int64_t now = fjs_vm_now(vm);
    eval_ok(vm, "__fjs.fns.setTimeout(function(){ console.log('timeout ran') }, 50)");
    int32_t ran = fjs_vm_pump(vm, now); /* before deadline */
    CHECK(ran == 0, "pump before deadline runs nothing");
    ran = fjs_vm_pump(vm, now + 1000);
    CHECK(ran == 1 && g_logs.back().find("timeout ran") != std::string::npos,
          "pump after deadline runs timer");

    /* promise jobs */
    eval_ok(vm, "Promise.resolve(7).then(v => console.log('then', v))");
    ran = fjs_vm_pump(vm, now + 2000);
    CHECK(g_logs.back().find("then 7") != std::string::npos, "promise jobs execute");

    /* regression (specs/070 D1): a throwing timer must not starve the
     * promise jobs queued behind it — the error is reported and the pump
     * still drains. vant's useRect throws `window is not defined` from a
     * timer; one dropped Vue-scheduler flush used to blank whole pages. */
    eval_ok(vm,
            "__fjs.fns.setTimeout(function(){ throw new ReferenceError('window is not defined') }, 10);"
            "Promise.resolve().then(function(){ console.log('job survived the throwing timer') });");
    ran = fjs_vm_pump(vm, now + 3000);
    bool job_ran = false, err_logged = false;
    for (const auto &l : g_logs) {
        if (l.find("job survived the throwing timer") != std::string::npos) job_ran = true;
        if (l.find("window is not defined") != std::string::npos) err_logged = true;
    }
    CHECK(job_ran, "throwing timer does not starve queued jobs");
    CHECK(err_logged, "throwing timer's error is reported");

    /* spec 111: a promise rejected with no handler by the end of a pump's
     * job drain is reported once, error level — both engine flavors. A
     * handler attached within the same drain means it was handled. */
    {
        auto rejections_since = [](size_t from, const char *needle) {
            int n = 0;
            for (size_t i = from; i < g_logs.size(); i++) {
                if (g_logs[i].find("unhandled promise rejection") != std::string::npos &&
                    (!needle || g_logs[i].find(needle) != std::string::npos))
                    n++;
            }
            return n;
        };
        size_t mark = g_logs.size();
        eval_ok(vm, "Promise.reject(new Error('rej-boom'))");
        fjs_vm_pump(vm, now + 4000);
        CHECK(rejections_since(mark, "rej-boom") == 1,
              "unhandled rejection is reported once, with its message");
        fjs_vm_pump(vm, now + 4001);
        CHECK(rejections_since(mark, "rej-boom") == 1,
              "the same rejection is not reported again by a later pump");

        mark = g_logs.size();
        eval_ok(vm, "Promise.reject(new Error('rej-caught')).catch(function(){})");
        fjs_vm_pump(vm, now + 4002);
        CHECK(rejections_since(mark, nullptr) == 0, "a caught rejection is not reported");

        mark = g_logs.size();
        eval_ok(vm,
                "var lateP = Promise.reject(new Error('rej-late'));"
                "Promise.resolve().then(function(){ lateP.catch(function(){}) });");
        fjs_vm_pump(vm, now + 4003);
        CHECK(rejections_since(mark, nullptr) == 0,
              "a rejection caught later in the same drain is not reported");

        mark = g_logs.size();
        eval_ok(vm, "(async function(){ throw new Error('rej-async') })()");
        fjs_vm_pump(vm, now + 4004);
        CHECK(rejections_since(mark, "rej-async") == 1, "an async function's throw is reported");

        mark = g_logs.size();
        eval_ok(vm, "Promise.reject('rej-plain-string')");
        fjs_vm_pump(vm, now + 4005);
        CHECK(rejections_since(mark, "rej-plain-string") == 1,
              "a non-Error rejection reason is reported too");
    }

    /* ---- exceptions ---- */
    const char *bad_src = "undefinedFn()";
    int32_t rc = fjs_vm_eval_source(vm, (const uint8_t *)bad_src,
                                    (int32_t)strlen(bad_src), "bad.js");
    CHECK(rc == -1 && strstr(fjs_last_error(vm), "undefinedFn") != nullptr,
          "JS exceptions reported with message");

    /* ---- regression: source buffers must not need NUL termination ----
     * quickjs-ng's JS_Eval reads input[input_len]; heap garbage after the
     * buffer used to leak into the parser. */
    {
        const char *body = "console.log('nonul ok', 3 * 4);";
        size_t blen = strlen(body);
        auto *poisoned = (uint8_t *)malloc(blen);
        memcpy(poisoned, body, blen);
        int32_t rc3 = fjs_vm_eval_source(vm, poisoned, (int32_t)blen, "nonul.js");
        free(poisoned);
        CHECK(rc3 == 0 && g_logs.back().find("nonul ok 12") != std::string::npos,
              "eval handles non-NUL-terminated source");
    }

    /* ---- bytecode round-trip ---- */
    {
        std::vector<uint8_t> bundle;
        const char *payload = "globalThis.bcRan = __fjs.natives.fibonacci(10); console.log('bc ok', bcRan)";
        int32_t need = fjs_compile_bundle(vm, (const uint8_t *)payload,
                                          (int32_t)strlen(payload), nullptr, 0);
        CHECK(need > 0, "compile-only eval + JS_WriteObject produce bytecode");
        bundle.resize((size_t)need);
        int32_t wrote = fjs_compile_bundle(vm, (const uint8_t *)payload,
                                           (int32_t)strlen(payload),
                                           bundle.data(), (int32_t)bundle.size());
        CHECK(wrote == need, "bundle written in one shot");

        /* header sanity */
        CHECK(bundle[0] == 'F' && bundle[1] == 'J' && bundle[2] == 'S' && bundle[3] == 'B',
              "bundle magic written");
        const char *eid = nullptr;
        int32_t off = 0, plen = 0;
        const char *err = nullptr;
        CHECK(fjs_bundle_check(bundle.data(), (int32_t)bundle.size(), &eid, &off, &plen, &err) == 0 &&
                  strcmp(eid, fjs_engine_id()) == 0,
              "bundle header validates against engine id");

        /* run bytecode in a FRESH vm */
        FJSVM *vm2 = fjs_vm_create();
        fjs_set_callbacks(vm2, on_log, nullptr, nullptr);
        size_t before = g_logs.size();
        int32_t rc2 = fjs_vm_eval_bundle(vm2, bundle.data(), (int32_t)bundle.size());
        CHECK(rc2 == 0, "bytecode bundle executes on fresh vm");
        CHECK(g_logs.size() > before && g_logs.back().find("bc ok 55") != std::string::npos,
              "bytecode execution produces identical result");
        fjs_vm_destroy(vm2);

        /* corrupt engine id -> must be rejected */
        std::vector<uint8_t> bad = bundle;
        bad[9] = 'X';
        FJSVM *vm3 = fjs_vm_create();
        rc2 = fjs_vm_eval_bundle(vm3, bad.data(), (int32_t)bad.size());
        CHECK(rc2 == -1 && strstr(fjs_last_error(vm3), "mismatch") != nullptr,
              "engine id mismatch rejected with actionable error");
        fjs_vm_destroy(vm3);
    }

    /* ---- binary handles (spec 038) ---- */
    {
        const uint8_t payload[] = {9, 8, 7, 6};
        int64_t id = fjs_handle_put_bytes(vm, 0, payload, 4);
        CHECK(id > 0, "put assigns a positive id");
        int64_t id2 = fjs_handle_put_bytes(vm, 0, payload, 4);
        CHECK(id2 != id, "ids are never reused");

        const uint8_t *out = nullptr;
        int32_t olen = 0;
        fjs_handle_bytes(vm, id, &out, &olen);
        CHECK(out && olen == 4 && out[0] == 9 && out[3] == 6,
              "borrowed bytes round-trip");

        fjs_handle_release(vm, id);
        out = nullptr;
        fjs_handle_bytes(vm, id, &out, &olen);
        CHECK(out == nullptr && olen == 0, "released handle reads as absent");

        int64_t stale = 0;
        {
            /* a handle outliving its VM must miss in the other VM, never
             * alias — ids are monotonic and the table dies with the VM */
            FJSVM *vm4 = fjs_vm_create();
            stale = fjs_handle_put_bytes(vm4, 0, payload, 4);
            fjs_vm_destroy(vm4);
        }
        out = nullptr;
        fjs_handle_bytes(vm, stale, &out, &olen);
        CHECK(out == nullptr && olen == 0, "another VM's id reads as absent");

        /* the JS side: create from a view, read back, release */
        eval_ok(vm,
                "globalThis.hid = __fjs.fns.handleBytes(new Uint8Array([1, 2, 3]));"
                "const ab = __fjs.fns.readHandleBytes(hid);"
                "console.log('handle', hid, new Uint8Array(ab).join(','));"
                "__fjs.fns.releaseHandle(hid);");
        CHECK(g_logs.back().find("handle ") != std::string::npos &&
                  g_logs.back().find("1,2,3") != std::string::npos,
              "fns handleBytes/readHandleBytes round-trip");
        eval_ok(
            vm,
            "try { __fjs.fns.readHandleBytes(globalThis.hid); console.log('NO-THROW'); }"
            "catch (e) { console.log('stale-throws', String(e).length > 0); }");
        CHECK(g_logs.back().find("stale-throws true") != std::string::npos,
              "reading a released handle throws loudly (constitution V)");
    }

    /* ---- GC churn (spec 088: engine swap regression guard) ----
     * PrimJS's allocator differs from quickjs-ng's; a few thousand
     * short-lived objects, strings and closures make any refcount/heap
     * mismatch visible immediately instead of in the field. */
    {
        size_t logs_before = g_logs.size();
        eval_ok(vm,
                "globalThis.churn = [];"
                "for (let i = 0; i < 20000; i++) {"
                "  churn.push({ i, s: 'str' + i, f: () => i });"
                "}"
                "churn = null;"
                "const report = __fjs.fns.gc();"
                "console.log('gc churn ok', report.after > 0);");
        CHECK(g_logs.size() > logs_before &&
                  g_logs.back().find("gc churn ok true") != std::string::npos,
              "20k-object churn + forced gc survives");
    }

#ifdef FJS_DEBUGGER
#ifndef _WIN32
    {
        /* Load it the way Dart does — this is the assertion that the
         * debugger really is a pluggable module and not engine cargo. */
        FjsDebuggerModule dbg = fjs_load_debugger_module();
        CHECK(dbg.loaded(), "debugger module dlopens with attach/detach");

        const int listener = socket(AF_INET, SOCK_STREAM, 0);
        CHECK(listener >= 0, "debug test: listener socket");
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (bind(listener, (sockaddr *)&addr, sizeof(addr)) == 0 &&
            listen(listener, 1) == 0) {
            socklen_t alen = sizeof(addr);
            getsockname(listener, (sockaddr *)&addr, &alen);
            const int port = ntohs(addr.sin_port);

            CHECK(dbg.loaded() && dbg.attach(vm, "127.0.0.1", port) == 0,
                  "debugger attach dials the relay");
            const int conn = accept(listener, nullptr, nullptr);
            CHECK(conn >= 0, "debugger: engine connected to the relay");

            auto send_msg = [&](const std::string &m) {
                std::string line = m + "\n";
                ssize_t n = write(conn, line.data(), line.size());
                (void)n;
            };

            /* Single-threaded: the resume command is pre-written to the
             * socket BEFORE the final pump. When the breakpoint hits and
             * the pause loop starts recv'ing, the resume is already in
             * the kernel buffer — no second thread, no read race. */
            send_msg(R"({"id":1,"method":"Runtime.enable"})");
            send_msg(R"({"id":2,"method":"Debugger.enable"})");
            eval_ok(vm,
                    "function work(n) {\n"
                    "  let s = 0;\n"
                    "  for (let i = 0; i < n; i++) s += i * 2;\n"
                    "  return s;\n"
                    "}\n"
                    "__fjs.fns.setTimeout(function () {\n"
                    "  console.log('before work');\n"
                    "  const r = work(1000);\n"
                    "  console.log('after work', r);\n"
                    "  __fjs.fns.toast('done:' + r);\n"
                    "}, 30);\n");
            send_msg(
                R"({"id":3,"method":"Debugger.setBreakpointByUrl",)"
                R"("params":{"url":"test.js","lineNumber":1}})");

            /* Process enables + bp; the bp response goes back to the
             * socket. We verify arming by checking the last error is
             * empty (a failed bp would set it). */
            fjs_vm_pump(vm, fjs_vm_now(vm));

            /* Resume arrives AFTER the bp is hit: a short-lived thread
             * writes it while the main thread is blocked inside the
             * engine's pause loop. No race — the writer thread owns the
             * socket exclusively during the pause (the main thread is
             * blocked in run_message_loop_on_pause). */
            std::thread resume_writer([&conn]() {
                fprintf(stderr, "[test] resume_writer started\n");
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                fprintf(stderr, "[test] writing resume\n");
                std::string resume = R"({"id":99,"method":"Debugger.resume"})" "\n";
                ssize_t w = write(conn, resume.data(), resume.size());
                (void)w;
            });

            const int64_t t0 = fjs_vm_now(vm);
            fjs_vm_pump(vm, t0 + 5000);

            resume_writer.join();
            bool resumed_ok = false;
            for (const auto &t : g_toasts)
                if (t.find("done:999000") != std::string::npos) resumed_ok = true;
            CHECK(resumed_ok, "debugger: bp hit + resume lets program finish");

            CHECK(dbg.detach(vm) == 0, "debugger detach");
            close(conn);
        }
        close(listener);
    }
#endif
#endif

    /* ---- object ABI (spec 159) ---- */
    {
        FJSVM *ovm = fjs_vm_create();
        CHECK(ovm != nullptr, "object-abi vm created");
        fjs_set_callbacks(ovm, on_log, on_ui_ops, on_invoke_host_object);
        g_obj_vm = ovm;

        /* construct: JS gets a proxy, and the value constructor arg crossed
         * as a plain scalar */
        eval_ok(ovm, "globalThis.c = __fjs.fns.objectCall('construct', 'test', 'Counter', 10)");
        eval_ok(ovm, "console.log('ctor kind:', typeof c)");
        CHECK(g_logs.back().find("object") != std::string::npos,
              "constructed Dart object arrives as an object");

        /* bound method: get('add') answers FJS_T_METHOD, the call funnels */
        eval_ok(ovm, "globalThis.sum = c.add(5)");
        CHECK(g_objects[1].value == 15, "invoke reached the fake bridge");
        eval_ok(ovm, "console.log('sum:', sum)");
        CHECK(g_logs.back().find("sum: 15") != std::string::npos,
              "bound method returns the Dart result");

        /* field read: get('value') answers the scalar */
        eval_ok(ovm, "console.log('field:', c.value)");
        CHECK(g_logs.back().find("field: 15") != std::string::npos,
              "field read crosses fjs.object.get");

        /* FJS_T_JSON answers materialize as real JS values */
        eval_ok(ovm, "console.log('json:', c.allKeys, c.allKeys.length)");
        CHECK(g_logs.back().find("json: a,b 2") != std::string::npos,
              "FJS_T_JSON answer becomes a real JS array");

        /* field write: no silent local property — funnels to Dart */
        eval_ok(ovm, "c.value = 42; console.log('after set:', c.value)");
        CHECK(g_logs.back().find("after set: 42") != std::string::npos,
              "field write funnels to fjs.object.set");

        /* reserved members stay native (an `await proxy` must be a no-op,
         * not a Dart call) */
        eval_ok(ovm, "console.log('then:', c.then)");
        CHECK(g_logs.back().find("then: undefined") != std::string::npos,
              "reserved members are not proxied into Dart");

        /* a proxy passed as an argument arrives as FJS_T_HANDLE */
        eval_ok(ovm, "c.takeRef(c)");
        CHECK(g_seen_arg_tag == FJS_T_HANDLE && g_seen_arg_handle == 1,
              "proxy argument crosses as its handle");

        /* a function argument crosses as FJS_T_CALLBACK and the host can
         * call it back through fjs_vm_call_callback */
        eval_ok(ovm, "globalThis.cbRan = 0; c.onTick(function (n) { cbRan = n; })");
        CHECK(g_last_cb_id > 0, "function argument became a callback id");
        {
            FJSValue arg{};
            arg.tag = FJS_T_INT32;
            arg.i = 7;
            FJSValue out{};
            int32_t rc = fjs_vm_call_callback(ovm, g_last_cb_id, 1, &arg, &out);
            CHECK(rc == 0, "host -> JS callback succeeds");
            eval_ok(ovm, "console.log('cbRan:', cbRan)");
            CHECK(g_logs.back().find("cbRan: 7") != std::string("").npos,
                  "callback received the rich-converted argument");
            if (out.tag == FJS_T_STRING && out.s) free((void *)out.s);

            /* calling it twice works until it is released */
            rc = fjs_vm_release_callback(ovm, g_last_cb_id);
            CHECK(rc == 0, "release_callback drops the engine's reference");
            rc = fjs_vm_call_callback(ovm, g_last_cb_id, 0, nullptr, &out);
            CHECK(rc == -1, "calling a released callback is a loud error");
        }

        /* identity: a function passed in and handed back by Dart is the
         * very same JS object (positive callback ids round-trip) */
        eval_ok(ovm,
                "globalThis.f1 = function () { return 'identity'; };"
                "c.onTick(f1);"
                "globalThis.f2 = __fjs.fns.objectCall('invoke', c, 'echoBack', f1);"
                "console.log('same fn:', f2 === f1)");
        CHECK(g_logs.back().find("same fn: true") != std::string::npos,
              "callback identity survives the round trip");

        /* Future: a FJS_T_PENDING reply is a native Promise the host
         * settles later */
        eval_ok(ovm,
                "globalThis.p = c.getPromise();"
                "p.then(function (v) { console.log('promise got', v); });");
        eval_ok(ovm, "console.log('isPromise:', p instanceof Promise)");
        CHECK(g_logs.back().find("isPromise: true") != std::string::npos,
              "pending reply is a native Promise");
        {
            FJSValue v{};
            v.tag = FJS_T_INT32;
            v.i = 99;
            int32_t rc = fjs_vm_settle_promise(ovm, g_pending_call, 1, &v);
            CHECK(rc == 0, "settle_promise resolves");
            CHECK(!g_logs.empty() &&
                      g_logs.back().find("promise got 99") != std::string::npos,
                  "then-handler ran (pump after settle)");

            rc = fjs_vm_settle_promise(ovm, g_pending_call, 1, &v);
            CHECK(rc == -1, "double settle is a loud error");
        }
        /* rejection path */
        eval_ok(ovm,
                "globalThis.p2 = c.getPromise();"
                "p2.catch(function (e) { console.log('rejected:', String(e)); });");
        {
            FJSValue err{};
            const char *msg = "boom from Dart";
            char *buf = (char *)malloc(strlen(msg) + 1);
            memcpy(buf, msg, strlen(msg) + 1);
            err.tag = FJS_T_STRING;
            err.s = buf; /* engine free()s it */
            err.len = (int32_t)strlen(msg);
            int32_t rc = fjs_vm_settle_promise(ovm, g_pending_call, 0, &err);
            CHECK(rc == 0, "settle_promise rejects");
            CHECK(g_logs.back().find("rejected: boom from Dart") != std::string::npos,
                  "catch-handler got the rejection reason");
        }

        /* host closure: a negative FJS_T_CALLBACK becomes a callable that
         * funnels to fjs.object.callback */
        eval_ok(ovm, "globalThis.dartFn = c.makeFn(); console.log('via dart:', dartFn(3, 4))");
        CHECK(g_last_dart_id == 7, "wrapper funnels to the closure id");
        CHECK(g_logs.back().find("via dart: 7") != std::string::npos,
              "host closure returns its Dart result");

        /* reentry guard: an adapter that ping-pongs JS<->Dart trips the
         * depth limit instead of the native stack */
        {
            eval_ok(ovm, "c.onTick(function loopFn() { c.loop(); })");
            const char *src =
                "try { c.loop(); console.log('LOOP-NO-ERROR'); }"
                "catch (e) { console.log('loop error:', e.message); }";
            fjs_vm_eval_source(ovm, (const uint8_t *)src, (int32_t)strlen(src), "loop.js");
            bool terminated = false;
            for (const auto &l : g_logs) {
                if (l.find("LOOP-NO-ERROR") != std::string::npos) break;
                if (l.find("loop error:") != std::string::npos) terminated = true;
            }
            CHECK(terminated && g_innermost_error.find("nesting too deep") != std::string::npos,
                  "reentry depth guard fires before the stack does");
        }

        /* host error messages surface as the JS exception text (v3) */
        {
            const char *src =
                "try { __fjs.fns.invokeHost('boom'); }"
                "catch (e) { console.log('caught:', e.message); }";
            fjs_vm_eval_source(ovm, (const uint8_t *)src, (int32_t)strlen(src), "boom.js");
            CHECK(g_logs.back().find("caught: host module call failed: module "
                                     "exploded: the reason") != std::string::npos,
                  "Dart error message reaches the JS exception");
        }
        {
            eval_ok(ovm, "try { c.boom(); } catch (e) { console.log('obj-caught:', e.message); }");
            CHECK(g_logs.back().find("obj-caught: object call failed: invoke: "
                                     "kaboom: the detail") != std::string::npos,
                  "object-call error message reaches the JS exception");
        }

        /* GC: dropping the last proxy queues the release; the flush at the
         * pump boundary tells the host. A bound method captured before the
         * drop survives and must fail loudly afterwards. */
        eval_ok(ovm, "globalThis.staleAdd = c.add; c = null; __fjs.fns.gc()");
        fjs_vm_pump(ovm, fjs_vm_now(ovm));
        bool released = false;
        for (int64_t h : g_released_handles) {
            if (h == 1) released = true;
        }
        CHECK(released, "GC'd proxy releases its Dart object at the pump boundary");

        /* stale use after release: loud error, never an alias */
        {
            const char *src =
                "try { staleAdd(1); console.log('STALE-NO-ERROR'); }"
                "catch (e) { console.log('stale error:', e.message); }";
            fjs_vm_eval_source(ovm, (const uint8_t *)src, (int32_t)strlen(src), "stale.js");
            CHECK(g_logs.back().find("stale error:") != std::string::npos &&
                      g_logs.back().find("STALE-NO-ERROR") == std::string::npos,
                  "using a released object throws");
        }

        /* an unknown op is rejected at the native gate */
        {
            const char *src =
                "try { __fjs.fns.objectCall('eval'); }"
                "catch (e) { console.log('op error:', e.message); }";
            fjs_vm_eval_source(ovm, (const uint8_t *)src, (int32_t)strlen(src), "op.js");
            CHECK(g_logs.back().find("op error: objectCall: unknown op") != std::string::npos,
                  "objectCall ops are allowlisted");
        }

        fjs_vm_destroy(ovm);
        g_obj_vm = nullptr;
    }

    fjs_vm_destroy(vm);
    printf("\n%s (%d failure(s))\n", g_failures == 0 ? "ALL PASS" : "FAILURES", g_failures);
    return g_failures == 0 ? 0 : 1;
}
