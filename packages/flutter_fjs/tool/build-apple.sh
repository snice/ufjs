#!/usr/bin/env bash
# Builds both engine flavors (spec 091) as xcframeworks from native/:
#
#   abi/primjs/{ios,macos}/fjs.xcframework + fjs_debugger.xcframework
#   abi/quickjs/{ios,macos}/fjs.xcframework   (no debugger: the CDP
#                                             inspector only exists for PrimJS)
#
# The primjs set is ALSO copied to the ios/ and macos/ pod roots (CocoaPods
# resolves vendored paths inside the pod root, so each gets a copy) — the
# committed materialized state must build without @ufjs/cli. `fjs run/build
# --js-engine <flavor>` copies a flavor from the cache over the pod roots at
# run time (see packages/fjs/src/project/engine.ts).
#
# The debugger archive is linked but not referenced in Release/Profile, so the
# linker pulls nothing from it; only Classes/FlutterFjsPlugin.m's `#if DEBUG`
# keep-alive table drags it into a Debug binary.
#
# The slices are static libraries, not frameworks: pub.dev refuses to publish
# packages containing directory symlinks, and a versioned macOS framework bundle
# is built out of them. Static also means nothing to embed or code-sign — the
# engine links into the app binary and Dart reaches it via
# DynamicLibrary.process(). Classes/FlutterFjsPlugin.m keeps the entry points
# from being dead-stripped.
#
# Slices: ios-arm64, ios-arm64_x86_64-simulator, macos-arm64_x86_64.
# Run on macOS with Xcode + CMake installed, then commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/apple"
ABI_CACHE="$ROOT/abi"
IOS_MIN=12.0
MACOS_MIN=10.14

rm -rf "$OUT" "$ABI_CACHE"/primjs/ios "$ABI_CACHE"/primjs/macos \
    "$ABI_CACHE"/quickjs/ios "$ABI_CACHE"/quickjs/macos \
    "$ROOT/ios/fjs.xcframework" "$ROOT/macos/fjs.xcframework" \
    "$ROOT/ios/fjs_debugger.xcframework" "$ROOT/macos/fjs_debugger.xcframework"
mkdir -p "$OUT"

# flavor <engine> <build-debugger? ON|OFF>
flavor() {
    local engine=$1 debugger=$2

    # slice <name> <cmake system> <sysroot> <archs> <deployment target>
    slice() {
        local name=$1 system=$2 sysroot=$3 archs=$4 target=$5
        echo "==> building $engine/$name ($archs)"
        cmake -S "$ROOT/native" -B "$OUT/$engine-$name" \
            -DCMAKE_BUILD_TYPE=Release \
            -DFJS_APPLE_STATIC=ON \
            -DFJS_BUILD_TESTS=OFF \
            -DFJS_JS_ENGINE="$engine" \
            -DFJS_DEBUGGER="$debugger" \
            -DCMAKE_SYSTEM_NAME="$system" \
            -DCMAKE_OSX_SYSROOT="$sysroot" \
            -DCMAKE_OSX_ARCHITECTURES="$archs" \
            -DCMAKE_OSX_DEPLOYMENT_TARGET="$target" \
            >/dev/null
        # one archive per slice: fjs core objects + vendored engine objects.
        # Both engines' static lib lands at libquickjs.a (PrimJS renames its
        # upstream "quick" target; the ng target is ours).
        cmake --build "$OUT/$engine-$name" --target fjs_core quickjs \
            --config Release -j"$(sysctl -n hw.ncpu)" >/dev/null
        libtool -static -no_warning_for_no_symbols \
            -o "$OUT/$engine-$name/libfjs.a" \
            "$OUT/$engine-$name/libfjs_core.a" "$OUT/$engine-$name/libquickjs.a"
        if [ "$debugger" = "ON" ]; then
            # the debugger module: transport + the whole PrimJS inspector,
            # which is NOT in libfjs.a above
            cmake --build "$OUT/$engine-$name" --target fjs_debugger_core \
                --config Release -j"$(sysctl -n hw.ncpu)" >/dev/null
            cp "$OUT/$engine-$name/libfjs_debugger_core.a" \
               "$OUT/$engine-$name/libfjs_debugger.a"
        fi
        # quickjs ships NO debugger artifact at all — the CDP inspector only
        # exists for PrimJS (spec 091)
    }

    slice ios-device    iOS    iphoneos          "arm64"        "$IOS_MIN"
    slice ios-simulator iOS    iphonesimulator   "arm64;x86_64" "$IOS_MIN"
    slice macos         Darwin macosx            "arm64;x86_64" "$MACOS_MIN"

    echo "==> creating $engine xcframeworks"
    mkdir -p "$ABI_CACHE/$engine/ios" "$ABI_CACHE/$engine/macos"
    xcodebuild -create-xcframework \
        -library "$OUT/$engine-ios-device/libfjs.a"    -headers "$ROOT/native/include" \
        -library "$OUT/$engine-ios-simulator/libfjs.a" -headers "$ROOT/native/include" \
        -library "$OUT/$engine-macos/libfjs.a"         -headers "$ROOT/native/include" \
        -output "$ABI_CACHE/$engine/ios/fjs.xcframework" >/dev/null
    cp -R "$ABI_CACHE/$engine/ios/fjs.xcframework" "$ABI_CACHE/$engine/macos/"

    if [ "$debugger" = "ON" ]; then
        xcodebuild -create-xcframework \
            -library "$OUT/$engine-ios-device/libfjs_debugger.a" \
            -library "$OUT/$engine-ios-simulator/libfjs_debugger.a" \
            -library "$OUT/$engine-macos/libfjs_debugger.a" \
            -output "$ABI_CACHE/$engine/ios/fjs_debugger.xcframework" >/dev/null
        cp -R "$ABI_CACHE/$engine/ios/fjs_debugger.xcframework" "$ABI_CACHE/$engine/macos/"
    fi
}

flavor primjs  ON
flavor quickjs OFF

# default materialization: primjs into the committed pod roots
cp -R "$ABI_CACHE/primjs/ios/fjs.xcframework" "$ROOT/ios/"
cp -R "$ABI_CACHE/primjs/macos/fjs.xcframework" "$ROOT/macos/"
cp -R "$ABI_CACHE/primjs/ios/fjs_debugger.xcframework" "$ROOT/ios/"
cp -R "$ABI_CACHE/primjs/macos/fjs_debugger.xcframework" "$ROOT/macos/"

if find "$ROOT/ios" "$ROOT/macos" -maxdepth 1 -name '*.xcframework' -type d \
        -exec find {} -type l \; | grep -q .; then
    echo "error: xcframework contains symlinks (pub.dev rejects them)" >&2
    exit 1
fi

echo "built:"
find "$ABI_CACHE" -name 'libfjs*.a' -path '*.xcframework*' -exec ls -lh {} \; \
    | awk '{print "  " $NF " " $5}'
