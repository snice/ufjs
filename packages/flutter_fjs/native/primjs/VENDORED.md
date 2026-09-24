# Vendored: PrimJS 4.1.1

- **Upstream**: https://github.com/lynx-family/primjs (Apache-2.0; see
  LICENSE / LICENSE.nodejs / LICENSE.v8 / NOTICE)
- **Tag**: `4.1.1` — commit `8d129eab500c86e3b2171144e45d3f19e5dce421`
  (the repo's own `PRIMJS_VERSION` file says `2.11.1-rc.1` and is out of
  sync with the git tag; the git tag is the identity that
  `fjs_engine_id()` encodes as `primjs-4.1.1`)
- **Why**: built-in Chrome DevTools Protocol debugger (spec 088). The
  previous vendored engine, quickjs-ng 0.9.0, has no debugger support at
  all (upstream discussion: quickjs-ng #757).

## What was pruned from the upstream tree

Everything not needed by the `quickjs` CMake target was dropped:
`Android/`, `harmony/`, `packages/`, `tools/`, `testing/`, `third_party/`,
`docs/`, `patches/`, `.github/` and the gn/ninja build files
(`BUILD.gn`, `.gn`, `config.gni`, `Primjs.gni`, `DEPS`, `Gemfile*`,
`*.podspec`). `src/interpreter/primjs/` (snapshot/embedded asm, only used
when `ENABLE_COMPATIBLE_MM` + arm64 is on) was removed too.

`src/wasm/` (616 KB) went later (spec 109): no CMakeLists references it, so it
was never compiled — the pruning above had simply missed it. Removing it left
the desktop build and `fjs-test` (debugger cases included) unchanged.

`src/napi/` (812 KB) is also never compiled into anything we ship, but it
**stays**: `src/gc/trace-gc.h` includes `src/napi/internal/primjs_napi_defines.h`,
and upstream's CMakeLists declares the napi targets (EXCLUDE_FROM_ALL still
needs their sources at generate time). Dropping it means one more local CMake
patch to carry on every upgrade, for source that never reaches a binary.

## Local patches (spec 090: inspector as a separate module)

Upstream links the inspector into the engine. We ship it as its own module
so release builds contain no debugger at all (~430 KB and, more to the
point, no reachable CDP surface). Five files carry the patch — re-apply
them on every upgrade, and expect link errors, not silence, if something
drifts:

| File | Patch |
|------|-------|
| `src/interpreter/quickjs/include/inspector_hooks.h` | **new** — the six-entry function table the interpreter reaches the inspector through |
| `src/interpreter/quickjs/source/inspector_hooks.cc` | **new** — the table itself + a link anchor for the GC write barriers in `gc/collector.cc`, which only the inspector calls |
| `src/interpreter/quickjs/source/quickjs.cc` (8 sites), `quickjs_gc.cc` (2 sites) | the ten direct inspector calls now go through the table; each already sat behind `#ifdef ENABLE_QUICKJS_DEBUGGER` + a runtime flag |
| `src/interpreter/quickjs/include/quickjs-inner.h` | includes `inspector_hooks.h` |
| `src/interpreter/quickjs/include/base_export.h` | `QJS_HIDE` becomes default-visible under `FJS_EXPORT_ENGINE_INTERNALS`: the inspector binds ~two dozen engine internals across the module boundary |
| `CMakeLists.txt` | `PRIMJS_INSPECTOR_AS_MODULE` keeps the inspector sources out of the `quickjs` target and gives them their own `quickjs_inspector` OBJECT target |

**Never define the six seam functions in the engine as forwarders.** Same
name on both sides would preempt the module's own definitions at
dynamic-link time and turn each call into infinite recursion. The engine
holds a pointer table and nothing else.

One cosmetic patch rides along with the module split:

| File | Patch |
|------|-------|
| `src/inspector/debugger_struct.h` | the literal-pool fallback for the DevTools console's JavaScript-context dropdown reads `V(debugger_context, "fjs engine")` instead of upstream's `"debugger context"` (the name `Runtime.executionContextCreated` reports when the host never calls `SetJSDebuggerName`) |

## Local patch (spec 114: Windows host tools)

| File | Patch |
|------|-------|
| `src/interpreter/quickjs/include/base_export.h` | the `WIN32` branch defines `QJS_EXPORT` / `QJS_EXPORT_FOR_DEVTOOL` empty instead of `__declspec(dllimport)`: fjs only builds Windows host tools (fjsc, fjsrun) that link PrimJS statically, and clang-cl rejects dllimport on a definition (`inspector_hooks.cc`) |

Upstream's CMakeLists also only supports clang (clang-cl on Windows); see
`native/CMakeLists.txt` and `packages/fjsc/build.mjs` for how we select it.

## Build choices (deviations from upstream defaults)

- `ENABLE_QUICKJS_DEBUGGER=ON` is forced from our `CMakeLists.txt` — the
  debugger is the reason this fork is vendored. It stays ON for release
  builds too: it is what keeps the debugger fields in the engine's structs,
  so the module and the engine agree on layout. The inspector *sources* are
  what `PRIMJS_INSPECTOR_AS_MODULE` moves out.
- **Compatible memory management stays OFF** (upstream default). PrimJS's
  tracing GC only activates on `ENABLE_COMPATIBLE_MM` + arm64; keeping it
  off gives every platform the classic reference-counting semantics our
  core (`src/vm.cpp` timer table, `value.cpp` conversions) was written
  against. Adopting the tracing GC is a separate, deliberate change.
- `include/` at the root is upstream's symlink farm into `src/**` and is
  kept as-is (rsync `--copy-links` resolved the links into real files).

## Upgrading

Drop in a new tag the same way (rsync-prune, keep this file's structure),
re-apply the local patches above, re-run
`cmake -B build-native -DFJS_BUILD_TESTS=ON`, run `fjs-test`, and
bump `fjs_engine_id()` in `src/vm.cpp` (`.fjsbundle` lockstep — see
docs/toolchain.md). To find the seam afresh after an upgrade, diff the
symbol sets: `nm` the engine objects for undefined names that the
`src/inspector/**` objects define — that list IS the hook table.
Watch the two spike findings in
`specs/088-devtools-debugger/spike/README.md`: the debugger callback
registration order and the pause-loop contract.
