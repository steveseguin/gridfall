#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=40d0989cf222ae2a2912def47bc64a2cece2632b
compiler="${PSXW_ROOT:-$PWD/.toolchain/psxw}"
if [ ! -d "$compiler/.git" ]; then
  if [ -n "${PSXW_ROOT:-}" ]; then echo 'PSXW_ROOT must point to a psxw checkout' >&2; exit 1; fi
  mkdir -p "$compiler"
  git -C "$compiler" init -q
  git -C "$compiler" fetch --depth 1 https://github.com/steveseguin/playstation-to-web "$revision"
  git -C "$compiler" checkout -q --detach FETCH_HEAD
fi
test "$(git -C "$compiler" rev-parse HEAD)" = "$revision"
git -C "$compiler" diff --exit-code HEAD -- crates Cargo.toml Cargo.lock
test -f build/gridfall.exe || { echo 'Run bash tools/build.sh first' >&2; exit 1; }
python3 tools/prepare-lift.py "$compiler"
export CARGO_BUILD_JOBS=2 RAYON_NUM_THREADS=2
"${CARGO:-cargo}" +1.94.1 run --manifest-path build/lift-driver/Cargo.toml -j 2 -- \
  build/gridfall.exe build/manifest.json build/lifted
python3 tools/link-web.py "${CLANG:-clang}"
