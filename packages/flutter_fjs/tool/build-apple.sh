#!/usr/bin/env bash
# Builds both engine flavors (spec 091) as xcframeworks from native/:
#
#   {ios,macos}/abi/primjs/fjs.xcframework + fjs_debugger.xcframework
#   {ios,macos}/abi/quickjs/fjs.xcframework   (no debugger: the CDP
#                                             inspector only exists for PrimJS)
#
# They live inside the pod roots, not the package-level abi/, because
# CocoaPods only matches vendored paths inside the pod root — and each
# podspec vendors abi/<flavor>/ directly for the flavor the build asked for
# (spec 105), so nothing is copied anywhere else. ios/ and macos/ each get
# their own identical copy for the same reason.
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
# Run on macOS with Xcode + CMake installed.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/apple"
IOS_MIN=12.0
MACOS_MIN=10.14

rm -rf "$OUT" "$ROOT/ios/abi" "$ROOT/macos/abi"
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
    mkdir -p "$ROOT/ios/abi/$engine" "$ROOT/macos/abi/$engine"
    xcodebuild -create-xcframework \
        -library "$OUT/$engine-ios-device/libfjs.a"    -headers "$ROOT/native/include" \
        -library "$OUT/$engine-ios-simulator/libfjs.a" -headers "$ROOT/native/include" \
        -library "$OUT/$engine-macos/libfjs.a"         -headers "$ROOT/native/include" \
        -output "$ROOT/ios/abi/$engine/fjs.xcframework" >/dev/null
    cp -R "$ROOT/ios/abi/$engine/fjs.xcframework" "$ROOT/macos/abi/$engine/"

    if [ "$debugger" = "ON" ]; then
        xcodebuild -create-xcframework \
            -library "$OUT/$engine-ios-device/libfjs_debugger.a" \
            -library "$OUT/$engine-ios-simulator/libfjs_debugger.a" \
            -library "$OUT/$engine-macos/libfjs_debugger.a" \
            -output "$ROOT/ios/abi/$engine/fjs_debugger.xcframework" >/dev/null
        cp -R "$ROOT/ios/abi/$engine/fjs_debugger.xcframework" "$ROOT/macos/abi/$engine/"
    fi
}

flavor primjs  ON
flavor quickjs OFF

if find "$ROOT/ios/abi" "$ROOT/macos/abi" -type l | grep -q .; then
    echo "error: xcframework contains symlinks (pub.dev rejects them)" >&2
    exit 1
fi

echo "built:"
find "$ROOT/ios/abi" "$ROOT/macos/abi" -name 'libfjs*.a' -exec ls -lh {} \; \
    | awk '{print "  " $NF " " $5}'
