/*
 * fjsrun — offline harness: runs a source file or .fjsbundle with the fjs
 * native core, prints console output and decodes UI op frames to stdout.
 * Lets you verify app bundles without launching Flutter:
 *
 *   fjsrun dist/bundle.js          # source mode
 *   fjsrun dist/app.fjsbundle      # bytecode mode
 *   fjsrun --pump 2000 dist/bundle.js   # keep pumping timers for 2s
 *   fjsrun --debug-connect 127.0.0.1:38903 dist/bundle.js --pump 60000
 *         # attach the CDP debugger (spec 088); Chrome DevTools can then
 *         # break in through `fjs debug` — desktop rehearsal of the
 *         # on-device path without a phone.
 */
#include "fjs.h"

#include "debugger-module.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void dump_ops(const uint8_t *ops, int32_t len) {
    printf("--- ui frame (%d bytes) ---\n", len);
    int p = 0;
    auto need = [&](int n) {
        if (p + n > len) { printf("  truncated\n"); p = len + 1; return false; }
        return true;
    };
    auto u32 = [&]() -> uint32_t {
        uint32_t v = ops[p] | (ops[p+1] << 8) | (ops[p+2] << 16) | ((uint32_t)ops[p+3] << 24);
        p += 4; return v;
    };
    auto u16 = [&]() -> uint16_t {
        uint16_t v = ops[p] | (ops[p+1] << 8); p += 2; return v;
    };
    while (p < len) {
        uint8_t op = ops[p++];
        switch (op) {
            case 1: { if (!need(6)) return; uint32_t id = u32(); uint16_t tl = u16();
                      if (!need(tl)) return;
                      printf("create #%u tag=%.*s\n", id, tl, (const char *)ops + p); p += tl; break; }
            case 2: { if (!need(4)) return; printf("remove #%u\n", u32()); break; }
            case 3: { if (!need(12)) return; uint32_t a = u32(), b = u32(), c = u32();
                      printf("insert parent=#%u child=#%u index=%u\n", a, b, c); break; }
            case 4: { if (!need(8)) return; uint32_t a = u32(), b = u32();
                      printf("removeChild parent=#%u child=#%u\n", a, b); break; }
            case 5: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("setText #%u = %.*s\n", id, (int)l, (const char *)ops + p); p += l; break; }
            case 6: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("setProps #%u = %.*s\n", id, (int)l, (const char *)ops + p); p += l; break; }
            case 7: { if (!need(8)) return; uint32_t sid = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("defineStyle @%u = %.*s\n", sid, (int)l, (const char *)ops + p); p += l; break; }
            case 8: { if (!need(12)) return; uint32_t id = u32(), sid = u32(), aid = u32();
                      printf("setStyle #%u style=@%u active=@%u\n", id, sid, aid); break; }
            /* :hover variant slot (op 12), keyed like op 8's active id. */
            case 12: { if (!need(8)) return; uint32_t id = u32(), hid = u32();
                      printf("setHoverStyle #%u hover=@%u\n", id, hid); break; }
            case 9: { printf("resetStyles\n"); break; }
            /* canvas display list: the bytes are the 2D command stream
             * (canvas/display-list.ts), not decoded here — this dump is
             * about the node protocol. */
            case 10: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("canvas #%u %u bytes\n", id, l); p += l; break; }
            /* webgl command stream (canvas/webgl/protocol.ts), not decoded
             * here either — same reasoning as op 10. */
            case 11: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("webgl #%u %u bytes\n", id, l); p += l; break; }
            default: printf("unknown op %u at %d\n", op, p - 1); return;
        }
    }
}

static void on_log(int32_t level, const char *msg, int32_t len) {
    printf("[log %d] %.*s\n", level, len, msg);
}
static int g_hex = 0;
/* --frames: one accounting line per frame instead of the per-op dump. The
 * dump printf's every op, which costs far more than anything a benchmark is
 * trying to measure, so the two modes are exclusive. */
static int g_frames = 0;
static long g_frame_count = 0, g_frame_bytes = 0, g_frame_ops = 0;

static long count_ops(const uint8_t *ops, int32_t len) {
    /* opcode -> fixed payload size; -1 marks the ones with a length prefix */
    long n = 0;
    int p = 0;
    while (p < len) {
        uint8_t op = ops[p++];
        int skip;
        switch (op) {
            case 2: skip = 4; break;
            case 3: skip = 12; break;
            case 4: skip = 8; break;
            case 8: skip = 12; break;
            case 9: skip = 0; break;
            case 12: skip = 8; break;
            case 1: { if (p + 6 > len) return n; skip = 6 + (ops[p+4] | (ops[p+5] << 8)); break; }
            case 5: case 6: case 7: case 10: case 11: {
                if (p + 8 > len) return n;
                uint32_t l = ops[p+4] | (ops[p+5] << 8) | (ops[p+6] << 16) | ((uint32_t)ops[p+7] << 24);
                skip = 8 + (int)l;
                break;
            }
            default: return n;
        }
        if (p + skip > len) return n;
        p += skip;
        n++;
    }
    return n;
}

static void on_ui_ops(const uint8_t *ops, int32_t len) {
    if (g_frames) {
        long n = count_ops(ops, len);
        g_frame_count++;
        g_frame_bytes += len;
        g_frame_ops += n;
        printf("[frame] ops=%ld bytes=%d\n", n, len);
        return;
    }
    if (g_hex) {
        printf("--- ui frame raw (%d bytes) ---\n", len);
        for (int32_t i = 0; i < len && i < 48; i++) {
            printf("%02x ", ops[i]);
            if ((i + 1) % 16 == 0) printf("\n");
        }
        printf("\n");
    }
    dump_ops(ops, len);
}
static int32_t on_invoke_host(const char *name, int32_t argc,
                              const FJSValue *args, FJSValue *out) {
    /* delegate to the built-in demo natives is unnecessary here; report */
    std::string msg = std::string("invokeHost('") + name + "') has no handler in fjsrun";
    out->tag = FJS_T_STRING;
    out->s = strdup(msg.c_str());
    out->len = (int32_t)msg.size();
    return 0;
}

int main(int argc, char **argv) {
    int pump_ms = 0;
    int tap_id = -1;
    const char *tap_text = nullptr;
    const char *debug_addr = nullptr;
    std::vector<const char *> paths;
    /* action sequence: repeatable --tap/--pump steps executed in order */
    struct Action { enum { Tap, Pump } kind; int id; int ms; const char *text; };
    std::vector<Action> actions;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--pump") && i + 1 < argc)
            actions.push_back({Action::Pump, 0, atoi(argv[++i]), nullptr});
        else if (!strcmp(argv[i], "--tap") && i + 1 < argc)
            actions.push_back({Action::Tap, atoi(argv[++i]), 0, nullptr});
        else if (!strcmp(argv[i], "--tap-text") && i + 1 < argc && !actions.empty())
            actions.back().text = argv[++i];
        else if (!strcmp(argv[i], "--hex")) g_hex = 1;
        else if (!strcmp(argv[i], "--frames")) g_frames = 1;
        else if (!strcmp(argv[i], "--debug-connect") && i + 1 < argc)
            debug_addr = argv[++i];
        else paths.push_back(argv[i]);
    }
    if (paths.size() != 1) {
        fprintf(stderr, "usage: fjsrun [--pump ms] [--tap node-id] [--hex] [--frames] "
                        "[--debug-connect host:port] <bundle.js | app.fjsbundle>\n");
        return 2;
    }

    FILE *f = fopen(paths[0], "rb");
    if (!f) { fprintf(stderr, "fjsrun: cannot open %s\n", paths[0]); return 1; }
    fseek(f, 0, SEEK_END); long size = ftell(f); fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> data((size_t)size + 1, 0); /* +1: NUL for eval */
    if (fread(data.data(), 1, (size_t)size, f) != (size_t)size) {
        fprintf(stderr, "fjsrun: read failed\n");
        fclose(f);
        return 1;
    }
    fclose(f);

    FJSVM *vm = fjs_vm_create();
    fjs_set_callbacks(vm, on_log, on_ui_ops, on_invoke_host);

    /* Attach before evaluating so the scripts land in the debugger's
     * script table (a later Debugger.enable replays them all). */
    if (debug_addr) {
        std::string addr = debug_addr;
        auto colon = addr.rfind(':');
        if (colon == std::string::npos) {
            fprintf(stderr, "fjsrun: --debug-connect needs host:port\n");
            return 2;
        }
        std::string host = addr.substr(0, colon);
        int port = atoi(addr.substr(colon + 1).c_str());
        /* spec 090: the debugger is a separate module, so a build that did
         * not ship it has no attach at all — say so instead of pretending. */
        FjsDebuggerModule dbg = fjs_load_debugger_module();
        if (!dbg.loaded()) {
            fprintf(stderr, "fjsrun: this build has no debugger module "
                            "(libfjs_debugger) next to the engine\n");
            return 1;
        }
        if (dbg.attach(vm, host.c_str(), port) != 0) {
            fprintf(stderr, "fjsrun: %s\n", fjs_last_error(vm));
            return 1;
        }
        printf("[fjsrun] debugger attached to %s\n", debug_addr);
    }

    /* Announce what dump_ops above can decode, exactly as the Flutter host
     * does. Without this the runtime assumes a pre-interning host and falls
     * back to the old per-node style encoding — which would quietly make
     * every benchmark here measure the wrong path. Keep in step with
     * FjsEngine.uiOpsVersion. */
    {
        static const char kCaps[] = "globalThis.__fjsHost = { uiOpsVersion: 3 };";
        fjs_vm_eval_source(vm, (const uint8_t *)kCaps, (int32_t)sizeof(kCaps) - 1,
                           "fjs:capabilities");
    }

    const bool is_bundle = size >= 4 && data[0] == 'F' && data[1] == 'J' && data[2] == 'S' && data[3] == 'B';
    int32_t rc;
    const char *filename = is_bundle ? paths[0] : "app.js";
    if (is_bundle) {
        rc = fjs_vm_eval_bundle(vm, data.data(), (int32_t)size);
    } else {
        rc = fjs_vm_eval_source(vm, data.data(), (int32_t)size, filename);
    }
    if (rc != 0) {
        fprintf(stderr, "fjsrun: %s\n", fjs_last_error(vm));
        fjs_vm_destroy(vm);
        return 1;
    }

    for (const auto &act : actions) {
        if (act.kind == Action::Tap) {
            printf("--- tap #%d%s ---\n", act.id, act.text ? " (text)" : "");
            if (act.text) {
                fjs_vm_dispatch_event(vm, act.id, 3, (const uint8_t *)act.text,
                                      (int32_t)strlen(act.text));
            } else {
                fjs_vm_dispatch_event(vm, act.id, 1, nullptr, 0);
            }
        } else {
            int64_t start = fjs_vm_now(vm);
            while (fjs_vm_now(vm) - start < act.ms) {
                fjs_vm_pump(vm, fjs_vm_now(vm));
                struct timespec ts = {0, 2 * 1000 * 1000}; /* 2ms */
                nanosleep(&ts, nullptr);
            }
        }
    }
    if (g_frames) {
        printf("[frames] total=%ld ops=%ld bytes=%ld\n",
               g_frame_count, g_frame_ops, g_frame_bytes);
    }
    fjs_vm_destroy(vm);
    return 0;
}
