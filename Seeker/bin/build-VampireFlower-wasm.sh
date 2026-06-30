#!/bin/sh

# Builds the client-side (WebAssembly) VampireFlower seed seeker.
# Requires Emscripten (emcc). The native build (build-VampireFlower.sh) is
# unaffected and remains the source of truth for server-side seeking.
#
# Output is emitted into the asset directory so the Ruby server serves it at
# /asset/seeker-vampireflower.js (+ .wasm).

set -e

root=$(realpath "$(dirname "$0")"/..)
asset="$root/../lib/battle-cats-rolls/asset"

emcc -O3 "$root/Seeker-VampireFlower-wasm.c" \
  -o "$asset/seeker-vampireflower.js" \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createSeekerModule \
  -sENVIRONMENT=worker \
  -sEXPORTED_FUNCTIONS=_seek_seed,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,setValue,HEAP32,HEAPU32 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=16MB

echo "Built $asset/seeker-vampireflower.js (+ .wasm)"
