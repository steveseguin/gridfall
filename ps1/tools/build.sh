#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${PSN00BSDK_ROOT:-$PWD/.toolchain/PSn00bSDK-0.24-Linux}"
if [ ! -f "$sdk/lib/libpsn00b/cmake/sdk.cmake" ]; then
  if [ -n "${PSN00BSDK_ROOT:-}" ]; then echo "PSN00BSDK_ROOT does not contain PSn00bSDK 0.24" >&2; exit 1; fi
  mkdir -p .toolchain
  curl --fail --location --retry 3 https://github.com/Lameguy64/PSn00bSDK/releases/download/v0.24/PSn00bSDK-0.24-Linux.zip -o .toolchain/sdk.zip
  printf '%s  %s\n' 5ada7c9478d795b22bde96ee23d6869290c14a740bcde3d57c01c342a26ded35 .toolchain/sdk.zip | sha256sum --check
  unzip -q -o .toolchain/sdk.zip -d .toolchain
  chmod -R u+x "$sdk/bin" "$sdk/libexec"
fi
python3 tools/pack.py
cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE="$sdk/lib/libpsn00b/cmake/sdk.cmake" -DPSN00BSDK_TC="$sdk/bin" -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
"$sdk/bin/mipsel-none-elf-nm" -n build/gridfall.elf > build/gridfall.sym
python3 tools/manifest.py "$sdk/bin/mipsel-none-elf-readelf"
