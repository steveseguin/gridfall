# GRIDFALL PS1

A single-map PlayStation homebrew port of GRIDFALL's Doom-derived C engine,
with a browser version recompiled from its PS1 executable using psxw.
Explore the Transit Depot, fight the machines, and reach the exit control.

Run the following commands from this `ps1/` directory.

## Play in a browser

Run `python tools/serve.py`, then open **http://127.0.0.1:8196/**.
The welcome screen plays the illustrated story. Press a key or click
**Skip intro / Play** to start; the last story card waits until you are ready.
Use the arrow keys to move and turn, Space to fire, E to use, A/D to strafe,
Shift to run, 1–8 to select a weapon, and P to pause.

The live mod sliders change movement speed and the texture palette immediately.
**Reset mods** restores the original values. Both controls modify the running
game's PS1 memory, and can be changed without restarting the map.

## Play on PS1

Load `build/gridfall.cue` in a PS1 emulator or a compatible homebrew disc loader.
Keep `gridfall.bin` beside it. The disc includes the game, original GRIDFALL
artwork, and sound effects. It has no commercial Doom artwork or maps.

The same welcome and story sequence runs on the console. Press any controller
button to skip it and start Map 1. Release that button before playing.

| Controller | Action |
| --- | --- |
| D-pad | Move forward/back and turn |
| Cross | Fire |
| Circle | Use doors and controls |
| Square | Run |
| L1 / R1 | Strafe |
| Triangle | Cycle owned weapons |
| Start | Pause |
| Select | Restart Map 1 |

The port renders a 320×200 view with colored room lighting and a status bar
below, filling the 320×240 display. It is single-player and includes Map 1 only.
Music, browser multiplayer, and the OBS director are not included.

## Build the PS1 game

On Linux or WSL, install CMake, Make, Python 3, curl, and unzip, then run:

```sh
bash tools/build.sh
```

The script downloads the SHA-256-pinned PSn00bSDK 0.24 Linux toolchain and builds
with at most two jobs. To use an existing installation, set `PSN00BSDK_ROOT`.

Outputs in `build/`:

- `gridfall.bin` and `gridfall.cue`: bootable PS1 disc image.
- `gridfall.exe`: native PS-X executable; it requires the disc's data files.
- `gridfall.elf`: native executable with debug symbols.
- `gridfall.sym`, `gridfall.symbols.txt`, and `manifest.json`: addresses,
  function sizes, executable entry point, and hashes for recompilation tools.

This project is self-contained. Building it does not read or modify the
original GRIDFALL or Doom 3DO checkout.

## Recompile the PS1 game for the browser

After building the PS1 game, install Rust 1.94.1, Git, and Clang with the
WebAssembly target and `wasm-ld`, then run:

```sh
bash tools/build-web.sh
python3 tools/serve.py
```

The script downloads the pinned psxw compiler, translates the MIPS instructions
in `build/gridfall.exe`, and links the translated functions into
`web/gridfall.wasm`. Clang compiles this generated translation; it does not
compile the original game C files for the browser. `web/build.json` records
the compiler revision and hashes of the executable, Wasm, and data files.
Set `PSXW_ROOT`, `CLANG`, or `CARGO` to use existing installations.

The browser host implements four console services: disc reads, fatal errors,
sound playback, and sound stop. It calls the translated game entry points
for initialization, simulation, rendering, and weapon selection, and displays
their framebuffer. No MIPS interpreter, EmulatorJS, or console BIOS is loaded.
The original game logic, software renderer, memory allocator, and arithmetic
helpers run as translated Wasm code.

For custom live controls, `window.gridfall.setSpeed(2)` doubles movement and
`window.gridfall.setTint(0.5)` shifts the palette. `setSpeed(1)` and `setTint(0)`
restore their defaults. `window.gridfall.state()` returns the current game state.

## Source and licenses

The engine and game assets come from [GRIDFALL](https://github.com/steveseguin/gridfall),
which derives from Rebecca Heineman / Olde Skuul's Doom 3DO source release.
The original MIT notice is retained in [LICENSE](LICENSE).

`source/` contains the adapted C engine; `ps1/` provides the console host,
resource loading, controller mapping, software renderer, and SPU sound support.
`assets/gridfall-source.bin` holds the original GRIDFALL resources. `tools/pack.py`
converts textures and sprites to an indexed palette and sound to PS1 ADPCM.
`assets/story.rgb332` contains the four original story illustrations reduced
to a console palette. Their text, timing, and rendering are native PS1 code
in `ps1/intro.c`, which is also translated by psxw for the browser.

The executable links [PSn00bSDK 0.24](https://github.com/Lameguy64/PSn00bSDK/tree/v0.24)
under [MPL 2.0](PSn00bSDK-LICENSE.txt). Its linked libraries and debug font are
unmodified; the port supplies its own loop-based `memset`. The linked repository
provides the SDK's corresponding source. The browser build uses the MIT-licensed
[psxw compiler](https://github.com/steveseguin/playstation-to-web).
