#!/usr/bin/env bash
# Builds the Android .so for BOTH engine flavors (spec 091) from native/,
# then strips them. Run once per native/ change; abi/ is committed, the
# conventional materialized dirs are NOT (gitignored) — fresh checkouts
# materialize before building via the engine runner or these scripts.
#
# The flavors land in the abi cache — one directory per engine, no renaming
# of files (Dart always opens libfjs.so):
#   abi/primjs/android/<abi>/    libfjs.so + libfjs_debugger.so (default)
#   abi/quickjs/android/<abi>/   libfjs.so only — the CDP inspector exists
#                                for PrimJS only
# The primjs set is ALSO copied to android/src/main/jniLibs/<abi>/ (what
# gradle packs) so the local tree builds out of the box; that directory is
# gitignored — only abi/ is committed.
#
# spec 090: libfjs.so is the engine and goes into every build;
# libfjs_debugger.so is the CDP inspector + transport, loaded only by debug
# builds; release APKs drop the file automatically (see android/build.gradle).
#
# Needs ANDROID_NDK_HOME (or ANDROID_NDK_ROOT / ANDROID_HOME with an ndk/ dir),
# r28 or newer: from r28 the NDK aligns LOAD segments to 16 KB by default, which
# Android 15+ devices with 16 KB pages require. Keep the NDK current instead of
# passing linker flags here.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/android"
ABI_CACHE="$ROOT/abi"
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

rm -rf "$OUT" "$ABI_CACHE"/primjs/android "$ABI_CACHE"/quickjs/android "$JNILIBS"

# flavor <engine> <build-debugger? ON|OFF>
flavor() {
    local engine=$1 debugger=$2
    for abi in "${ABIS[@]}"; do
        echo "==> building $engine/$abi"
        cmake -S "$ROOT/native" -B "$OUT/$engine-$abi" \
            -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
            -DANDROID_ABI="$abi" \
            -DANDROID_PLATFORM="android-$API" \
            -DANDROID_STL=c++_static \
            -DCMAKE_BUILD_TYPE=Release \
            -DFJS_BUILD_TESTS=OFF \
            -DFJS_JS_ENGINE="$engine" \
            -DFJS_DEBUGGER="$debugger" \
            >/dev/null
        if [ "$debugger" = "ON" ]; then
            # two targets: the engine (libfjs.so) and the pluggable debugger
            # module — inspector + transport (libfjs_debugger.so, spec 090)
            cmake --build "$OUT/$engine-$abi" --target fjs fjs_debugger \
                -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
        else
            cmake --build "$OUT/$engine-$abi" --target fjs \
                -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
        fi
        mkdir -p "$ABI_CACHE/$engine/android/$abi"
        for so in libfjs.so; do
            cp "$OUT/$engine-$abi/$so" "$ABI_CACHE/$engine/android/$abi/$so"
            "$STRIP" --strip-unneeded "$ABI_CACHE/$engine/android/$abi/$so"
        done
        if [ "$debugger" = "ON" ]; then
            for so in libfjs_debugger.so; do
                cp "$OUT/$engine-$abi/$so" "$ABI_CACHE/$engine/android/$abi/$so"
                "$STRIP" --strip-unneeded "$ABI_CACHE/$engine/android/$abi/$so"
            done
        fi
    done
}

flavor primjs  ON
flavor quickjs OFF

# default materialization: primjs into the committed jniLibs
for abi in "${ABIS[@]}"; do
    mkdir -p "$JNILIBS/$abi"
    cp "$ABI_CACHE"/primjs/android/"$abi"/*.so "$JNILIBS/$abi/"
done

echo "built:"
ls -lh "$ABI_CACHE"/{primjs,quickjs}/android/*/libfjs*.so | awk '{print "  " $NF " " $5}'
