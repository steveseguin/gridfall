# Rebuild GRIDFALL

The repository includes the playable site and everything needed to rebuild its engine and game data.

## Setup

Install Python 3.10 or newer and the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html). In the SDK folder:

```sh
emsdk install 3.1.74
emsdk activate 3.1.74
source ./emsdk_env.sh
```

On Windows, use `emsdk.bat` and run `emsdk_env.bat` in a Command Prompt. Then, from the GRIDFALL repository:

```sh
python -m pip install -r browser/requirements.txt
python browser/build.py
python -m http.server 8080 --bind 127.0.0.1 --directory docs
```

Open **http://localhost:8080/** for the game or **http://localhost:8080/director.html** for the director. If the compiler is not on your path, pass `--emcc /path/to/emsdk/upstream/emscripten/emcc.py` to the build command.

## Files and edits

| Location | Contents |
| --- | --- |
| `docs/` | Browser JavaScript, HTML, runtime art, MIDI scores, Ogg recordings and compiled game |
| `source/` | C engine and headers used by the browser build |
| `lib/burger/getrandom.c` | Engine random-number generator |
| `browser/doom-browser.c`, `browser/include/` | Browser platform support |
| `browser/maps/` | GRIDFALL campaign layouts and room plans |
| `browser/assets/gridfall/` | Original artwork used to build textures and sprites |
| `browser/asset-layout.json` | Numeric texture sizes, sprite bounds and sound timing |
| `browser/*.py` | Engine build, map generation and asset packing |

Edit the web interface directly in `docs/`. Rebuild C changes with `python browser/build.py --code-only`. Rebuild maps, sprites, textures and synthesized sound with `python browser/build.py --assets-only`. Use `--debug` for an engine build with symbols and memory checks. Build workers are capped at two and at half the machine's logical processors.

Maps 1–8 are edited in `browser/maps/levels.json`. For maps 9–24, edit `browser/map_designs.py` and `browser/maps/plans.json`, run `python browser/map_designs.py`, then rebuild assets. Keep level titles and objectives in `docs/hud.js` consistent with the maps. The map compiler checks required cards, switches and reachable exits.

Music scores and their recordings are included in `docs/music/`. Keep both `.mid` and `.ogg` files: browsers use MIDI synthesis if a recording cannot play. The engine build does not regenerate these recordings.

## Publish

Serve the complete `docs/` folder. For GitHub Pages, select **Deploy from a branch**, the repository's default branch, and **/docs** in **Settings → Pages**. No custom build workflow is required. Other HTTPS hosts should serve `.wasm` as `application/wasm`.

When changing gameplay or networking, increment `release` near the top of `docs/watch-host.js` and update the changed files' `?v=` tags in both HTML pages and asset fetch URLs. Publish the site together and have players and directors reload; a room requires compatible versions.
