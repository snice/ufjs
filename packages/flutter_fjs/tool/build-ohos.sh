#!/usr/bin/env bash
# Builds ohos/libs/arm64-v8a/ from native/ with the DevEco Studio toolchain,
# then strips the output. Run once per native/ change and commit.
#
# spec 090: TWO files land in libs/, an engine and a module on top of it —
#   libfjs.so            the engine; contains no inspector, every build
#   libfjs_debugger.so   CDP inspector + transport, loaded only by debug
#                        builds; release/profile HAPs drop the file
#                        (see ohos/build-profile.json5)
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
LIBS="$ROOT/ohos/libs/arm64-v8a"

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

rm -rf "$OUT" "$LIBS"
cmake -S "$ROOT/native" -B "$OUT" \
    -DCMAKE_SYSTEM_NAME=Linux \
    -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
    -DCMAKE_C_COMPILER="$CLANG" \
    -DCMAKE_CXX_COMPILER="$CLANGXX" \
    -DCMAKE_SHARED_LINKER_FLAGS="-static-libstdc++ -Wl,-z,max-page-size=16384" \
    -DCMAKE_BUILD_TYPE=Release \
    -DFJS_BUILD_TESTS=OFF \
    >/dev/null
cmake --build "$OUT" --target fjs fjs_debugger -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
mkdir -p "$LIBS"
for so in libfjs.so libfjs_debugger.so; do
    cp "$OUT/$so" "$LIBS/$so"
    "$STRIP" --strip-unneeded "$LIBS/$so"
done

echo "built:"
ls -lh "$LIBS"/libfjs*.so | awk '{print "  " $NF " " $5}'
