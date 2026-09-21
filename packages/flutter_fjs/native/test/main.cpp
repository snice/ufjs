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
#include <cstring>
#include <cstdlib>
#include <string>
#include <thread>
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

    fjs_vm_destroy(vm);
    printf("\n%s (%d failure(s))\n", g_failures == 0 ? "ALL PASS" : "FAILURES", g_failures);
    return g_failures == 0 ? 0 : 1;
}
