#!/usr/bin/env bash
# tool/check-publish.mjs against a copy of this package (spec 105): passes
# as is, and fails — naming the problem — for each way a publish went wrong.
set -uo pipefail
PKG=$(cd "$(dirname "$0")/../.." && pwd)
fails=0
fresh() {
  WORK=$(mktemp -d)
  for d in abi ios macos ohos; do cp -R "$PKG/$d" "$WORK/$d"; done
  cp "$PKG/.pubignore" "$WORK/"
  node "$PKG/tool/check-publish.mjs" --root "$WORK" --fix >/dev/null
}
expect() { # label expected-exit expected-text
  local out code
  out=$(node "$PKG/tool/check-publish.mjs" --root "$WORK" 2>&1); code=$?
  if [ "$code" = "$2" ] && printf '%s' "$out" | grep -q -- "$3"; then echo "ok   $1"; else echo "FAIL $1 (exit $code)"; printf '%s\n' "$out"; fails=$((fails+1)); fi
  rm -rf "$WORK"
}
fresh;                                                           expect "complete package passes" 0 "check ok"
fresh; rm -rf "$WORK/ios/abi/quickjs";                           expect "missing quickjs xcframework" 1 "missing ios/abi/quickjs/fjs.xcframework"
fresh; rm "$WORK/ohos/libs/arm64-v8a/libfjs_debugger.so";        expect "ohos libs without debugger" 1 "ohos/libs/arm64-v8a is not identical"
fresh; cp "$WORK/abi/quickjs/ohos/arm64-v8a/libfjs.so" "$WORK/ohos/libs/arm64-v8a/"; expect "quickjs in ohos libs" 1 "not identical"
fresh; printf 'android/\n' > "$WORK/abi/.gitignore";             expect "ignore rule hides android libs" 1 "excluded by abi/.gitignore"
fresh; printf '*.xcframework\n' > "$WORK/ios/.gitignore";        expect "spec 091 ios/.gitignore excludes the frameworks" 1 "excluded by ios/.gitignore"
fresh; rm "$WORK/ohos/.pubignore"; printf '/libs\n' > "$WORK/ohos/.gitignore"; expect "ohos/.gitignore without .pubignore" 1 "excluded by ohos/.gitignore"
fresh; mkdir -p "$WORK/android/src/main/jniLibs";                expect "stale jniLibs" 1 "unexpected android/src/main/jniLibs"
fresh; touch "$WORK/abi/quickjs/android/x86_64/libfjs_debugger.so"; expect "debugger in quickjs" 1 "debugger exists for primjs only"
exit $fails
