#!/usr/bin/env bash
# Refreshes the showcase runtime baked into fjs go (assets/shared.fjsbundle.gz).
# fjs go uses it only while it matches the hash in the showcase manifest, so
# a stale copy is harmless — it just costs one download at first launch.
set -euo pipefail
cd "$(dirname "$0")/.."
base=https://fjs-showcase.zhuzhe.dev
manifest=$(curl -fsS "$base/manifest.json")
shared=$(printf '%s' "$manifest" | python3 -c 'import json,sys; print(json.load(sys.stdin)["shared"])')
want=$(printf '%s' "$manifest" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("hashes", {}).get(d["shared"], ""))')
curl -fsS -o assets/shared.fjsbundle.gz "$base/$shared"
got=$(shasum -a 256 assets/shared.fjsbundle.gz | cut -c1-16)
if [ -n "$want" ] && [ "$got" != "$want" ]; then
  echo "downloaded $shared hashes to $got, manifest says $want — deploy in progress?" >&2
  exit 1
fi
echo "seed updated: $(wc -c < assets/shared.fjsbundle.gz) bytes, hash $got"
