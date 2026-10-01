#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p "$ROOT/libs" "$ROOT/include/switch"

if [[ ! -f "$ROOT/libs/libtesla/include/tesla.hpp" ]]; then
  rm -rf "$ROOT/libs/libtesla"
  git clone --depth 1 https://github.com/WerWolv/libtesla.git "$ROOT/libs/libtesla"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --depth 1 https://github.com/Insektaure/Shiny-Stash-Live-Map.git "$TMP/dmnt"

install -m 0644 "$TMP/dmnt/lib/libdmntcht.a" "$ROOT/libs/libdmntcht.a"
install -m 0644 "$TMP/dmnt/include/switch/dmntcht.h" "$ROOT/include/switch/dmntcht.h"

echo "Dependencies ready."
