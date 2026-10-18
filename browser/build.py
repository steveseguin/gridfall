"""Build the original 3DO C engine as a small, standalone browser module."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from pack_assets import build_assets

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emcc", default=shutil.which("emcc") or shutil.which("emcc.bat"))
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--assets-only", action="store_true")
    parser.add_argument("--code-only", action="store_true", help="Reuse the existing asset bundle")
    args = parser.parse_args()
    output = ROOT / "docs/build"
    output.mkdir(exist_ok=True)
    if not args.code_only:
        build_assets(ROOT, output)
        shutil.copy2(ROOT / "browser/assets/gridfall/skies.png", ROOT / "docs/assets/gridfall/skies.png")
    if args.assets_only:
        return
    if not args.emcc:
        parser.error("Activate the Emscripten SDK first, or pass --emcc path/to/emcc.py")
    # Older sources use Macintosh filename casing. Normalize only build copies.
    excluded = {"threedo.c", "mac.c", "stmain.c", "omain.c"}
    with tempfile.TemporaryDirectory(prefix="doom3do-build-") as temporary:
        stage = Path(temporary)
        sources = []
        for path in (ROOT / "source").iterdir():
            if path.suffix not in (".c", ".h") or path.name in excluded:
                continue
            source = path.read_text()
            source = re.sub(r'(#include [<"])([^>"\n]+)',
                            lambda m: m[1] + m[2].lower(), source)
            target = stage / path.name
            target.write_text(source)
            if path.suffix == ".c":
                sources.append(str(target))
        for name in ("getrandom.c",):
            source = (ROOT / "lib/burger" / name).read_text().replace('"Burger.h"', '"burger.h"')
            (stage / name).write_text(source)
            sources.append(str(stage / name))
        env = os.environ.copy()
        # Cap every compiler/linker worker pool, including first-use library builds.
        cores = max(1, min(2, (os.cpu_count() or 2) // 2))
        env.update(EMCC_CORES=str(cores), BINARYEN_CORES=str(cores),
                   CMAKE_BUILD_PARALLEL_LEVEL=str(cores))
        command = [args.emcc]
        if args.emcc.endswith(".py"):
            import sys
            command.insert(0, sys.executable)
        command += sources + [str(ROOT / "browser/doom-browser.c"),
            "-I" + str(ROOT / "browser/include"), "-I" + str(stage),
            "-std=gnu99", "-fwrapv", "-fno-strict-aliasing",
            "-Wno-incompatible-function-pointer-types", "-Wno-deprecated-non-prototype",
            "-Wno-non-literal-null-conversion", "-Wno-switch",
            "--no-entry", "-sFILESYSTEM=0", "-sMALLOC=emmalloc", "-sMODULARIZE=1", "-sEXPORT_NAME=createDoom",
            "-sENVIRONMENT=web", "-sMIN_CHROME_VERSION=75", "-sMIN_FIREFOX_VERSION=79",
            "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=16777216", "-sSTACK_SIZE=262144",
            "-sEXPORTED_FUNCTIONS=['_malloc','_free','_doom_init','_doom_start','_doom_step','_doom_render','_doom_render_players','_doom_weapon','_doom_state','_doom_multiplayer','_doom_net_step','_doom_net_commands','_doom_predict','_doom_checksum','_doom_seed','_doom_checkpoint','_doom_load_checkpoint','_doom_pause','_doom_map','_doom_map_lines','_doom_view','_doom_roster','_doom_snapshot_ranges']",
            "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32']",
            "-o", str(output / "doom.js")]
        command += ["-O1", "-g", "-sASSERTIONS=2", "-sSAFE_HEAP=1"] if args.debug else ["-O2", "-flto", "-sASSERTIONS=0"]
        subprocess.run(command, env=env, check=True)
    # Emscripten's outer wrapper bypasses its browser-target syntax conversion.
    loader = output / "doom.js"
    loader.write_text(loader.read_text().replace("document.currentScript?.src",
        "(document.currentScript ? document.currentScript.src : undefined)"))
    for name in ("doom.wasm", "doom.js", "doom-assets.bin"):
        data = (output / name).read_bytes()
        print(f"{name}: {len(data):,} bytes")


if __name__ == "__main__":
    main()
