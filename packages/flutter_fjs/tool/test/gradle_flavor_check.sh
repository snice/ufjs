#!/usr/bin/env bash
# Runs the flavor-resolution block of flutter_fjs/android/build.gradle
# (spec 105) in a throwaway Gradle project — no AGP, no network — once per
# flavor source, and checks what it resolves to.
set -uo pipefail
PKG=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
WORK=$(mktemp -d)
mkdir -p "$WORK/android"
ln -s "$PKG/abi" "$WORK/abi"
# the block, verbatim: from `def fjsJsEngine` up to the buildscript block
awk '/^def fjsJsEngine = \{/{on=1} /^buildscript \{/{on=0} on' "$PKG/android/build.gradle" > "$WORK/android/build.gradle"
cat >> "$WORK/android/build.gradle" <<'G'
tasks.register('show') { doLast { println "FLAVOR=${fjsJsEngine} LIBS=${fjsEngineLibs.name == 'android' && fjsEngineLibs.isDirectory()}" } }
G
echo "rootProject.name = 'fjs-flavor-check'" > "$WORK/android/settings.gradle"
b64() { printf '%s' "$1" | base64 -w0; }
fails=0
run() { # label expect [env] -- gradle args
  local label=$1 expect=$2 envval=$3; shift 3
  local out
  out=$(cd "$WORK/android" && env ${envval:+FJS_JS_ENGINE=$envval} gradle -q --offline show "$@" 2>&1)
  if printf '%s' "$out" | grep -q -- "$expect"; then echo "ok   $label"; else echo "FAIL $label"; printf '%s\n' "$out" | tail -5; fails=$((fails+1)); fi
}
run "default -> primjs"                "FLAVOR=primjs LIBS=true"  ""
run "dart-defines -> quickjs"          "FLAVOR=quickjs LIBS=true" "" "-Pdart-defines=$(b64 FJS_DEV=ws://x),$(b64 FJS_JS_ENGINE=quickjs)"
run "env -> quickjs"                   "FLAVOR=quickjs LIBS=true" quickjs
run "env beats dart-defines"           "FLAVOR=primjs"            primjs "-Pdart-defines=$(b64 FJS_JS_ENGINE=quickjs)"
run "-Pfjs.jsEngine beats env"         "FLAVOR=quickjs"           primjs "-Pfjs.jsEngine=quickjs"
run "dart-defines w/o engine -> primjs" "FLAVOR=primjs"           "" "-Pdart-defines=$(b64 FJS_DEV=ws://x)"
run "unknown flavor fails"             "unknown FJS_JS_ENGINE 'v8'" v8
rm -rf "$WORK"
exit $fails
