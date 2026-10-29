// The game and software renderer are ahead-of-time translations of gridfall.exe.
// JavaScript supplies disc reads and audio; it never interprets MIPS instructions.
export async function loadBundle(base = new URL('./', import.meta.url)) {
    async function get(name) {
        const response = await fetch(new URL(name, base));
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        return response.arrayBuffer();
    }
    const manifest = JSON.parse(new TextDecoder().decode(await get('build.json')));
    const names = ['gridfall.exe', 'gridfall.wasm', 'GRIDFALL.DAT', 'SOUND.BNK'];
    const files = await Promise.all(names.map(get));
    if (globalThis.crypto && crypto.subtle) {
        await Promise.all(files.map(async (file, i) => {
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file));
            const hex = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
            if (hex !== manifest.sha256[names[i]]) throw new Error(`${names[i]} does not match build.json`);
        }));
    }
    return {manifest, exe: files[0], wasm: files[1], data: files[2], sound: files[3]};
}

export async function createGame(bundle, onSound = () => {}) {
    const symbols = bundle.manifest.symbols;
    const exe = new Uint8Array(bundle.exe), data = new Uint8Array(bundle.data);
    const header = new DataView(bundle.exe);
    if (new TextDecoder().decode(exe.subarray(0, 8)) !== 'PS-X EXE') throw new Error('Invalid PS1 executable');
    let wasm, ram;
    const imports = {host: {
        fatal(message, value) {
            let text = '';
            if (message) for (let p = message & 0x1fffff; p < ram.length && ram[p]; p++) text += String.fromCharCode(ram[p]);
            throw new Error(`PS1 ${text || 'invalid code address'}: ${(value >>> 0).toString(16)}`);
        },
        read(offset, destination, size) {
            if (offset < 0 || size < 0 || offset + size > data.length) throw new Error('Invalid disc read');
            new Uint8Array(wasm.memory.buffer, destination, size).set(data.subarray(offset, offset + size));
        },
        sound: onSound
    }};
    wasm = (await WebAssembly.instantiate(bundle.wasm, imports)).instance.exports;
    const ramAddress = wasm.ram_address();
    ram = new Uint8Array(wasm.memory.buffer, ramAddress, 0x200000);
    const view = new DataView(wasm.memory.buffer, ramAddress, 0x200000);
    ram.set(exe.subarray(2048, 2048 + header.getUint32(0x1c, true)), header.getUint32(0x18, true) & 0x1fffff);
    wasm.initialize();
    const call = (name, a = 0, b = 0, c = 0, d = 0) => wasm.call(symbols[name], a, b, c, d) >>> 0;
    ram.set(data.subarray(0, 16384), symbols.directory_buffer & 0x1fffff);
    if (call('doom_init', symbols.directory_buffer, 16384) !== 1) throw new Error('PS1 resource initialization failed');
    const read = name => view.getUint32(symbols[name] & 0x1fffff, true);
    const originalMoves = ['forwardmove', 'sidemove'].map(name => [read(name), view.getUint32((symbols[name] & 0x1fffff) + 4, true)]);
    const palette = new Uint16Array(wasm.memory.buffer, ramAddress + (symbols.palette & 0x1fffff), 256);
    const originalPalette = palette.slice();
    return {
        manifest: bundle.manifest,
        buttons: {up: 0x40000000, down: 0x80000000, left: 0x10000000, right: 0x20000000,
            fire: read('PadAttack'), use: read('PadUse'), run: read('PadSpeed'),
            strafeLeft: 0x00200000, strafeRight: 0x00400000, pause: 0x01000000},
        step(buttons) { return call('doom_step', buttons); },
        intro() { return call('doom_intro'); },
        render(fraction = 1) {
            fraction = Number(fraction);
            if (!Number.isFinite(fraction)) fraction = 1;
            return new Uint16Array(wasm.memory.buffer, ramAddress +
                (call('doom_render_lerp', Math.round(Math.max(0, Math.min(1, fraction)) * 65536)) & 0x1fffff), 320 * 240);
        },
        state() { return Array.from(new Int32Array(wasm.memory.buffer, ramAddress + (call('doom_state') & 0x1fffff), 43)); },
        restart() { call('doom_start', 1, 2); },
        weapon(number) { call('doom_weapon', number); },
        setSpeed(value) {
            value = Number(value);
            if (!Number.isFinite(value)) throw new Error('Speed must be a number');
            value = Math.max(0.25, Math.min(3, value));
            ['forwardmove', 'sidemove'].forEach((name, i) => originalMoves[i].forEach((n, j) =>
                view.setUint32((symbols[name] & 0x1fffff) + j * 4, Math.round(n * value), true)));
            return value;
        },
        setTint(value) {
            value = Number(value);
            if (!Number.isFinite(value)) throw new Error('Tint must be a number');
            value = Math.max(0, Math.min(1, value));
            for (let i = 1; i < 256; i++) {
                const pixel = originalPalette[i], r = (pixel >> 10) & 31, g = (pixel >> 5) & 31, b = pixel & 31;
                palette[i] = 0x8000 | (Math.round(r * (1 - value) + b * value) << 10) |
                    (Math.round(g * (1 - value) + r * value) << 5) | Math.round(b * (1 - value) + g * value);
            }
            return value;
        }
    };
}

// Decode the disc's PS1 ADPCM sound bank for Web Audio playback.
export function decodeSoundBank(buffer) {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer), result = new Map();
    const filters = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
    for (let i = 0; i < view.getUint32(0, true); i++) {
        const row = 4 + i * 16, id = view.getUint32(row, true), start = 4096 + view.getUint32(row + 4, true);
        const length = view.getUint32(row + 8, true), pitch = view.getUint32(row + 12, true);
        const samples = [], end = start + length;
        let previous = 0, older = 0;
        if (end > buffer.byteLength || length % 16) throw new Error('Invalid PS1 sound bank');
        for (let pos = start; pos < end; pos += 16) {
            const shift = bytes[pos] & 15, filter = filters[bytes[pos] >> 4];
            if (!filter || shift > 12) throw new Error('Invalid PS1 ADPCM block');
            for (let n = 0; n < 28; n++) {
                let sample = (bytes[pos + 2 + (n >> 1)] >> ((n & 1) * 4)) & 15;
                if (sample & 8) sample -= 16;
                sample = (sample << 12) >> shift;
                sample += (previous * filter[0] + older * filter[1] + 32) >> 6;
                sample = Math.max(-32768, Math.min(32767, sample));
                samples.push(sample / 32768); older = previous; previous = sample;
            }
            if (bytes[pos + 1] & 1) break;
        }
        result.set(id, {samples: new Float32Array(samples), rate: pitch * 44100 / 4096});
    }
    return result;
}
