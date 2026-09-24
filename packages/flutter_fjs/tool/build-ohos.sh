#!/usr/bin/env bash
# Builds the ohos libs for both engine flavors (spec 091) from native/ with
# the DevEco Studio toolchain, then strips the output. Run once per native/
# change; abi/ is committed, ohos/libs/ is not (it is published, see
# ohos/.pubignore and tool/check-publish.mjs).
#
# spec 090: TWO files land in libs/, an engine and a module on top of it —
#   libfjs.so            the engine; contains no inspector, every build
#   libfjs_debugger.so   CDP inspector + transport, loaded only by debug
#                        builds; release/profile HAPs drop the file
#                        (see ohos/build-profile.json5)
#
# spec 091/105: the flavors land in the abi cache and the primjs set is ALSO
# copied to ohos/libs/ — a HAR only packages its module's libs/, so unlike
# android/ios/macos the flavor has to be copied there. The engine runner
# (bin/engine.dart) swaps in another flavor, only for a path dependency.
#   abi/primjs/ohos/arm64-v8a/    libfjs.so + libfjs_debugger.so (default)
#   abi/quickjs/ohos/arm64-v8a/   libfjs.so only — the CDP inspector exists
#                                 for PrimJS only
#
# The ohos flutter fork ships no CMake toolchain file, so CMake is pointed at
# the DevEco llvm wrapper compilers (they bake -target/--sysroot/-D__MUSL__)
# and the platform stays generic Linux — the sysroot is musl and everything
# quickjs/fjs needs (pthread, m) lives in libc. -static-libstdc++ folds the
# C++ runtime into the .so so the HAP carries no libc++_shared.so; the
# max-page-size mirrors what the NDK r28+ Android build guarantees for
# 16 KB-page devices.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/ohos"
ABI_CACHE="$ROOT/abi"
LIBS="$ROOT/ohos/libs"

NATIVE=${DEVECO_SDK_HOME:-/Applications/DevEco-Studio.app/Contents/sdk}/default/openharmony/native
CLANG="$NATIVE/llvm/bin/aarch64-unknown-linux-ohos-clang"
CLANGXX="$NATIVE/llvm/bin/aarch64-unknown-linux-ohos-clang++"
STRIP="$NATIVE/llvm/bin/llvm-strip"
if [ ! -x "$CLANGXX" ]; then
    echo "error: ohos native toolchain not found at $NATIVE" >&2
    echo "       install DevEco Studio or point DEVECO_SDK_HOME at its sdk dir" >&2
    exit 1
fi
echo "==> ohos native toolchain ($NATIVE)"

rm -rf "$OUT" "$OUT"-primjs "$OUT"-quickjs \
    "$ABI_CACHE"/primjs/ohos "$ABI_CACHE"/quickjs/ohos "$LIBS"

# flavor <engine> <build-debugger? ON|OFF>
flavor() {
    local engine=$1 debugger=$2
    echo "==> building $engine"
    cmake -S "$ROOT/native" -B "$OUT-$engine" \
        -DCMAKE_SYSTEM_NAME=Linux \
        -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
        -DCMAKE_C_COMPILER="$CLANG" \
        -DCMAKE_CXX_COMPILER="$CLANGXX" \
        -DCMAKE_SHARED_LINKER_FLAGS="-static-libstdc++ -Wl,-z,max-page-size=16384" \
        -DCMAKE_BUILD_TYPE=Release \
        -DFJS_BUILD_TESTS=OFF \
        -DFJS_JS_ENGINE="$engine" \
        -DFJS_DEBUGGER="$debugger" \
        >/dev/null
    if [ "$debugger" = "ON" ]; then
        cmake --build "$OUT-$engine" --target fjs fjs_debugger \
            -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
    else
        cmake --build "$OUT-$engine" --target fjs \
            -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
    fi
    mkdir -p "$ABI_CACHE/$engine/ohos/arm64-v8a"
    for so in libfjs.so; do
        cp "$OUT-$engine/$so" "$ABI_CACHE/$engine/ohos/arm64-v8a/$so"
        "$STRIP" --strip-unneeded "$ABI_CACHE/$engine/ohos/arm64-v8a/$so"
    done
    if [ "$debugger" = "ON" ]; then
        for so in libfjs_debugger.so; do
            cp "$OUT-$engine/$so" "$ABI_CACHE/$engine/ohos/arm64-v8a/$so"
            "$STRIP" --strip-unneeded "$ABI_CACHE/$engine/ohos/arm64-v8a/$so"
        done
    fi
}

flavor primjs  ON
flavor quickjs OFF

# default flavor: primjs into ohos/libs (what the HAR packs and what ships)
mkdir -p "$LIBS/arm64-v8a"
cp "$ABI_CACHE"/primjs/ohos/arm64-v8a/*.so "$LIBS/arm64-v8a/"

echo "built:"
ls -lh "$ABI_CACHE"/{primjs,quickjs}/ohos/arm64-v8a/libfjs*.so \
    | awk '{print "  " $NF " " $5}'

# spec 116: exports narrowed to fjs_* + what the debugger imports
node "$ROOT/tool/test/libfjs_exports_check.mjs" --only ohos
