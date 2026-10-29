import {loadBundle, createGame, decodeSoundBank} from './engine.mjs';

const $ = id => document.getElementById(id);
const canvas = $('screen'), context = canvas.getContext('2d'), image = context.createImageData(320, 240);
const keys = new Set(), voices = [];
let game, audio, soundBank, started = false, paused = false, last = 0, elapsed = 0, pending = 0;
const audioBuffers = new Map();
function sound(id, on) {
    if (!audio) return;
    if (!on) { voices.filter(v => v.id === id).forEach(v => v.source.stop()); return; }
    const data = soundBank.get(id);
    if (!data) return;
    if (!audioBuffers.has(id)) {
        const buffer = audio.createBuffer(1, data.samples.length, data.rate);
        buffer.copyToChannel(data.samples, 0); audioBuffers.set(id, buffer);
    }
    while (voices.length >= 16) voices.shift().source.stop();
    const source = audio.createBufferSource(), volume = audio.createGain();
    source.buffer = audioBuffers.get(id); volume.gain.value = 0.45;
    source.connect(volume).connect(audio.destination);
    const voice = {id, source}; voices.push(voice);
    source.onended = () => { const n = voices.indexOf(voice); if (n >= 0) voices.splice(n, 1); };
    source.start();
}
function paint(fraction = 1) {
    const intro = game.intro();
    if (canvas.width !== 320 || canvas.height !== 240) { canvas.width = 320; canvas.height = 240; canvas.style.aspectRatio = '4 / 3'; }
    const pixels = game.render(fraction);
    for (let i = 0; i < 320 * 240; i++) {
        const pixel = pixels[i], p = i * 4;
        image.data[p] = (pixel & 31) * 255 / 31;
        image.data[p + 1] = ((pixel >> 5) & 31) * 255 / 31;
        image.data[p + 2] = ((pixel >> 10) & 31) * 255 / 31;
        image.data[p + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const state = game.state();
    paused = !!state[14];
    $('stats').textContent = intro ? 'Press a key to play' : `HP ${state[1]} · AMMO ${state[4]} · ${state[5]}/${state[6]}`;
    $('status').textContent = intro ? (intro === 1 ? 'GRIDFALL · The story' : `The story · ${intro - 1}/4`) : paused ? 'Paused' : state[36] ? 'Map complete' : state[1] <= 0 ? 'Down — fire to respawn' : 'Transit Depot';
    $('pause').textContent = paused ? 'Resume' : 'Pause';
    $('pause').disabled = !!intro; $('restart').disabled = !!intro; $('start').disabled = !intro;
}
function input() {
    let buttons = pending; pending = 0;
    const map = {ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',ArrowRight:'right',
        KeyA:'strafeLeft',KeyD:'strafeRight',Space:'fire',KeyE:'use',ShiftLeft:'run',ShiftRight:'run'};
    keys.forEach(key => { if (map[key]) buttons |= game.buttons[map[key]]; });
    return buttons;
}
function animate(now) {
    if (!started) return;
    elapsed += Math.min(now - last, 250); last = now;
    try {
        while (elapsed >= 1000 / 15) { game.step(input()); elapsed -= 1000 / 15; }
        paint(elapsed / (1000 / 15)); requestAnimationFrame(animate);
    } catch (error) { fail(error); }
}
function fail(error) {
    started = false; keys.clear(); voices.slice().forEach(v => v.source.stop());
    $('status').textContent = error.message; $('status').classList.add('error');
    document.querySelectorAll('button,input').forEach(el => el.disabled = true);
    console.error(error);
}
function togglePause() { if (started && !game.intro()) pending |= game.buttons.pause; }
document.addEventListener('keydown', event => {
    if (!started || /INPUT|BUTTON/.test(document.activeElement.tagName)) return;
    if (game.intro()) {
        if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
            !['Tab','ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight','Escape'].includes(event.code)) {
            event.preventDefault(); startGame();
        }
        return;
    }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (!event.repeat && event.code === 'KeyP') togglePause();
    if (!event.repeat && /^Digit[1-8]$/.test(event.code)) game.weapon(Number(event.code.slice(-1)) - 1);
});
document.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); if (started && !game.intro() && !paused) pending |= game.buttons.pause; });
async function startGame() {
    try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (Audio && !audio) audio = new Audio();
        if (audio) await audio.resume();
        if (game.intro()) pending |= game.buttons.pause;
        canvas.focus();
    } catch (error) { fail(error); }
}
$('start').onclick = startGame;
$('pause').onclick = () => { togglePause(); canvas.focus(); };
$('restart').onclick = () => { voices.slice().forEach(v => v.source.stop()); game.restart(); pending = 0; elapsed = 0; keys.clear(); paint(); canvas.focus(); };
function updateMods() {
    $('speed-value').textContent = game.setSpeed($('speed').value).toFixed(2) + '×';
    $('tint-value').textContent = Math.round(game.setTint($('tint').value) * 100) + '%';
    if (!started) paint();
}
$('speed').oninput = updateMods; $('tint').oninput = updateMods;
$('reset-mods').onclick = () => { $('speed').value = 1; $('tint').value = 0; updateMods(); canvas.focus(); };
try {
    const bundle = await loadBundle(); soundBank = decodeSoundBank(bundle.sound);
    game = await createGame(bundle, sound);
    // Console/API access uses the same live PS1 data as the visible controls.
    window.gridfall = game;
    ['start','restart','speed','tint','reset-mods'].forEach(id => $(id).disabled = false);
    paint(); started = true; last = performance.now(); requestAnimationFrame(animate);
} catch (error) { fail(error); }
