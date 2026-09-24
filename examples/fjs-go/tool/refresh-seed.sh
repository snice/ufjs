#!/usr/bin/env bash
# Refreshes the shared-runtime seed fjs go ships (assets/shared.fjsbundle.gz,
# spec 109).
#
# The seed is a copy of the hosted showcase's shared.fjsbundle.gz, used on
# first launch only when its hash matches the deployed manifest
# (lib/src/hosted_build.dart, `_seeds`). A stale seed never breaks anything
# — it simply stops matching and every install carries dead bytes — but a
# seed built for the wrong ENGINE is worse: when the hash does match, the app
# evaluates bytecode its engine refuses ("bundle engine mismatch"). The seed
# committed before this script existed was quickjs-ng bytecode while the
# default engine had become PrimJS; this script refuses that case.
#
#   tool/refresh-seed.sh                       # from the deployed showcase
#   tool/refresh-seed.sh <url|file>            # from another build
#   FJS_SEED_ENGINE=quickjs-ng-0.9.0 tool/refresh-seed.sh   # other flavor
#   FJS_SEED_OUT=/tmp/x.gz tool/refresh-seed.sh <file>      # write elsewhere
#
# The expected id is the default flavor's (packages/fjs/src/project/engine.ts
# ENGINE_IDS.primjs); keep the two in step.
set -euo pipefail
cd "$(dirname "$0")/.."

SOURCE=${1:-https://fjs-showcase.zhuzhe.dev/shared.fjsbundle.gz}
EXPECT=${FJS_SEED_ENGINE:-primjs-4.1.1}
OUT=${FJS_SEED_OUT:-assets/shared.fjsbundle.gz}

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
if [ -f "$SOURCE" ]; then
    cp "$SOURCE" "$tmp"
else
    curl -fsSL "$SOURCE" -o "$tmp"
fi

# .fjsbundle header (native/include/fjs.h): "FJSB", u16 version, u16 id
# length (little endian), then the engine id the bytecode was compiled for.
id=$(node -e '
  const zlib = require("node:zlib");
  const raw = require("node:fs").readFileSync(process.argv[1]);
  let b;
  try { b = zlib.gunzipSync(raw); } catch { console.log("<not gzip>"); process.exit(0); }
  if (b.length < 8 || b.toString("latin1", 0, 4) !== "FJSB") { console.log("<not an fjsbundle>"); process.exit(0); }
  const n = b.readUInt16LE(6);
  console.log(b.toString("latin1", 8, 8 + n));
' "$tmp")

if [ "$id" != "$EXPECT" ]; then
    echo "refresh-seed: $SOURCE is built for '$id', but the app's default engine is '$EXPECT'" >&2
    echo "              rebuild and redeploy the showcase for $EXPECT first; $OUT left unchanged" >&2
    exit 1
fi
mv "$tmp" "$OUT"
trap - EXIT
echo "refresh-seed: $OUT <- $SOURCE ($id, $(wc -c < "$OUT" | tr -d ' ') bytes)"
