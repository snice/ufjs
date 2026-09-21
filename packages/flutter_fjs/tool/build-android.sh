#!/usr/bin/env bash
# Builds android/src/main/jniLibs/<abi>/ from native/ for every ABI the
# plugin ships, then strips them. Run once per native/ change and commit.
#
# spec 090: TWO files land in jniLibs, an engine and a module on top of it —
#   libfjs.so            the engine; contains no inspector, every build
#   libfjs_debugger.so   CDP inspector + transport, loaded only by debug
#                        builds; release APKs drop the file automatically
#                        (see android/build.gradle)
#
# Needs ANDROID_NDK_HOME (or ANDROID_NDK_ROOT / ANDROID_HOME with an ndk/ dir),
# r28 or newer: from r28 the NDK aligns LOAD segments to 16 KB by default, which
# Android 15+ devices with 16 KB pages require. Keep the NDK current instead of
# passing linker flags here.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/android"
JNILIBS="$ROOT/android/src/main/jniLibs"
API=21
ABIS=(armeabi-v7a arm64-v8a x86_64)

NDK=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
if [ -z "$NDK" ] && [ -n "${ANDROID_HOME:-}" ]; then
    NDK=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1 || true)
fi
if [ -z "$NDK" ] || [ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]; then
    echo "error: Android NDK not found; set ANDROID_NDK_HOME" >&2
    exit 1
fi

NDK_VERSION=$(sed -n 's/^Pkg.Revision *= *//p' "$NDK/source.properties" 2>/dev/null)
NDK_MAJOR=$(printf '%s' "${NDK_VERSION%%.*}" | tr -cd '0-9')
if [ -z "$NDK_MAJOR" ] || [ "$NDK_MAJOR" -lt 28 ]; then
    echo "error: NDK ${NDK_VERSION:-<unknown>} at $NDK is unusable; r28+ is required" >&2
    echo "       for 16 KB page alignment. Point ANDROID_NDK_HOME at a newer NDK." >&2
    exit 1
fi
echo "==> NDK $NDK_VERSION ($NDK)"

HOST_TAG=$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64
[ "$(uname -s)" = "Darwin" ] && HOST_TAG=darwin-x86_64
STRIP="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-strip"

rm -rf "$OUT" "$JNILIBS"
for abi in "${ABIS[@]}"; do
    echo "==> building $abi"
    cmake -S "$ROOT/native" -B "$OUT/$abi" \
        -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI="$abi" \
        -DANDROID_PLATFORM="android-$API" \
        -DANDROID_STL=c++_static \
        -DCMAKE_BUILD_TYPE=Release \
        -DFJS_BUILD_TESTS=OFF \
        >/dev/null
    # two targets: the engine (libfjs.so) and the pluggable debugger
    # module — inspector + transport (libfjs_debugger.so, spec 090)
    cmake --build "$OUT/$abi" --target fjs fjs_debugger -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
    mkdir -p "$JNILIBS/$abi"
    cp "$OUT/$abi/libfjs.so" "$JNILIBS/$abi/libfjs.so"
    "$STRIP" --strip-unneeded "$JNILIBS/$abi/libfjs.so"
    cp "$OUT/$abi/libfjs_debugger.so" "$JNILIBS/$abi/libfjs_debugger.so"
    "$STRIP" --strip-unneeded "$JNILIBS/$abi/libfjs_debugger.so"
done

echo "built:"
ls -lh "$JNILIBS"/*/libfjs*.so | awk '{print "  " $NF " " $5}'
