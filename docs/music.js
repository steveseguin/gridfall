/* Recorded campaign score, with local MIDI synthesis for imports and fallback playback. */
(function () {
	"use strict";
	function readMidi(data) {
		var bytes = new Uint8Array(data), view = new DataView(data), pos = 0, end = bytes.length;
		function need(count) { if (pos + count > end) throw new Error("Truncated MIDI file."); }
		function byte() { need(1); return bytes[pos++]; }
		function word() { need(2); var n = view.getUint16(pos); pos += 2; return n; }
		function long() { need(4); var n = view.getUint32(pos); pos += 4; return n; }
		function tag() { return String.fromCharCode(byte(), byte(), byte(), byte()); }
		function variable() {
			var n = 0;
			for (var i = 0; i < 4; ++i) { var b = byte(); n = n * 128 + (b & 127); if (b < 128) return n; }
			throw new Error("Invalid MIDI delta time.");
		}
		if (bytes.length > 1048576 || tag() !== "MThd") throw new Error("Choose a MIDI file smaller than 1 MB.");
		var header = long(), format = word(), tracks = word(), division = word();
		if (header < 6 || format > 1 || !tracks || tracks > 128 || (format === 0 && tracks !== 1)) throw new Error("Use a standard type 0 or type 1 MIDI file.");
		if (!division || division & 32768) throw new Error("Use MIDI with musical beat timing (PPQN), not SMPTE timing.");
		need(header - 6); pos += header - 6;
		var events = [], lastTick = 0, notes = 0, order = 0;
		for (var track = 0; track < tracks; ++track) {
			if (tag() !== "MTrk") throw new Error("Missing MIDI track.");
			var length = long(); need(length);
			end = pos + length;
			var tick = 0, running = 0;
			while (pos < end) {
				tick += variable(); lastTick = Math.max(lastTick, tick);
				var status = byte();
				if (status < 128) { if (!running) throw new Error("Invalid MIDI running status."); --pos; status = running; }
				if (status === 255) {
					var type = byte(), size = variable(); need(size);
					if (type === 81) {
						if (size !== 3) throw new Error("Invalid MIDI tempo.");
						var tempo = bytes[pos] * 65536 + bytes[pos + 1] * 256 + bytes[pos + 2];
						if (!tempo) throw new Error("Invalid MIDI tempo.");
						events.push({ tick: tick, order: order++, tempo: tempo });
					}
					pos += size;
					if (type === 47) { pos = end; break; }
				} else if (status === 240 || status === 247) {
					running = 0; var skip = variable(); need(skip); pos += skip;
				} else {
					if (status >= 240) throw new Error("Invalid MIDI channel event.");
					running = status;
					var kind = status >> 4, a = byte(), b = kind === 12 || kind === 13 ? 0 : byte();
					if (a > 127 || b > 127) throw new Error("Invalid MIDI event data.");
					if (kind === 9 && b && ++notes > 4096) throw new Error("Choose a MIDI track with at most 4096 notes.");
					events.push({ tick: tick, order: order++, kind: kind, channel: status & 15, a: a, b: b });
				}
				if (events.length > 60000) throw new Error("This MIDI track contains too many events.");
			}
			end = bytes.length;
		}
		events.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
		var tickTime = 0, seconds = 0, micros = 500000;
		events.forEach(function (event) {
			seconds += (event.tick - tickTime) * micros / division / 1000000;
			tickTime = event.tick; event.time = seconds;
			if (event.tempo) micros = event.tempo;
		});
		seconds += (lastTick - tickTime) * micros / division / 1000000;
		if (!notes || seconds <= 0 || seconds > 180) throw new Error("Choose a MIDI track between 0 and 180 seconds with playable notes.");
		return { events: events, duration: seconds };
	}
	function joinLoop(values, length) {
		var fade = Math.min(220, Math.floor(length / 4)), jump = values[length - 1] - values[0];
		if (fade > 1) for (var j = 0; j < fade; ++j) {
			var blend = j / (fade - 1);
			values[length - fade + j] -= jump * blend * blend * (3 - 2 * blend);
		}
	}
	function renderMidi(data, normalize) {
		var song = readMidi(data), AudioClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
		if (!AudioClass) throw new Error("MIDI rendering is unavailable in this browser.");
		var rate = 22050, length = Math.ceil(song.duration * rate);
		var context = new AudioClass(2, length + 2 * rate, rate), channels = [], voices = [];
		var seed = 12345;
		var waves = {}, drums = {};
		// All instrument shaping and room reflections happen off-line.
		var room = context.createConvolver(), wet = context.createGain(); wet.gain.value = .18;
		var impulse = context.createBuffer(2, Math.floor(rate * .7), rate);
		for (var side = 0; side < 2; ++side) {
			var reflection = impulse.getChannelData(side), smooth = 0;
			for (var j = Math.floor(rate * .019); j < reflection.length; ++j) {
				seed = (seed * 1664525 + 1013904223) >>> 0;
				smooth += (seed / 2147483648 - 1 - smooth) * .32;
				reflection[j] = smooth * Math.pow(1 - j / reflection.length, 3);
			}
		}
		room.buffer = impulse; room.connect(wet); wet.connect(context.destination);
		function instrument(family) {
			if (!waves[family]) {
				var real = new Float32Array(24), imaginary = new Float32Array(24);
				for (var h = 1; h < imaginary.length; ++h) {
					if (family === 1) imaginary[h] = h === 1 ? 1 : h === 3 ? .35 : h === 7 ? .12 : 0;
					else if (family === 4) imaginary[h] = h === 1 ? 1 : .5 / (h * h);
					else if (family === 8 || family === 9 || family === 11) imaginary[h] = h % 2 ? 1 / (h * h) : .04 / h;
					else if (family === 2) imaginary[h] = h === 1 ? 1 : h === 2 ? .4 : h === 4 ? .2 : 0;
					else imaginary[h] = 1 / Math.pow(h, family === 6 || family === 10 ? 1.3 : 1.8);
				}
				waves[family] = context.createPeriodicWave(real, imaginary);
			}
			return waves[family];
		}
		function percussion(note) {
			if (drums[note]) return drums[note];
			var kick = note === 35 || note === 36, snare = note === 38 || note === 40 || note === 39;
			var tom = [41,43,45,47,48,50].indexOf(note) !== -1;
			var duration = kick ? .42 : snare ? .25 : tom ? .38 : note === 46 ? .32 : note === 49 || note === 51 ? .65 : .085;
			var buffer = context.createBuffer(1, Math.ceil(rate * duration), rate), data = buffer.getChannelData(0);
			var phase = 0, low = 0;
			for (var n = 0; n < data.length; ++n) {
				var t = n / rate;
				seed = (seed * 1664525 + 1013904223) >>> 0;
				var noise = seed / 2147483648 - 1; low += (noise - low) * .38;
				phase += 2 * Math.PI * (kick ? 44 + 100 * Math.exp(-t * 36) : tom ? 65 + (note - 41) * 12 + 45 * Math.exp(-t * 25) : 185) / rate;
				var v = kick ? Math.sin(phase) * Math.exp(-t * 12) + (noise - low) * .25 * Math.exp(-t * 160) :
					snare ? (noise - low) * .75 * Math.exp(-t * 20) + Math.sin(phase) * .3 * Math.exp(-t * 35) :
					tom ? Math.sin(phase) * Math.exp(-t * 12) + noise * .06 * Math.exp(-t * 50) :
					(noise - low) * .5 * Math.exp(-t * 5 / duration);
				data[n] = v * Math.min(1, n / 20) * Math.min(1, (data.length - 1 - n) / 80);
			}
			drums[note] = buffer; return buffer;
		}
		for (var i = 0; i < 16; ++i) {
			var gain = context.createGain(), pan = context.createStereoPanner();
			gain.gain.value = 100 / 127; gain.connect(pan); pan.connect(context.destination); pan.connect(room);
			channels.push({ gain: gain, pan: pan, volume: 100, expression: 127, bend: 0, program: 0, sustain: false });
		}
		function release(voice, time, immediate) {
			if (voice.end !== undefined && !immediate) return;
			var gain = voice.gain.gain, elapsed = Math.max(0, time - voice.start);
			var releasing = voice.end !== undefined && !voice.drum;
			var level = releasing ? voice.releaseLevel * Math.max(0, 1 - (time - voice.end) / voice.release) :
				voice.level * (elapsed < voice.attack ? elapsed / voice.attack : voice.sustain + (1 - voice.sustain) * Math.exp(-(elapsed - voice.attack) / voice.decay));
			if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(time);
			else {
				gain.cancelScheduledValues(time);
				// Recreate the truncated ramp: a setValue here would erase its earlier rise/fall.
				if (elapsed < voice.attack || releasing) gain.linearRampToValueAtTime(level, time);
				else gain.setValueAtTime(level, time);
			}
			var tail = immediate ? .005 : voice.release;
			voice.end = time; voice.releaseLevel = level; voice.release = tail;
			gain.linearRampToValueAtTime(0, time + tail);
			voice.source.stop(time + tail);
		}
		function releaseChannel(channel, time, immediate) {
			voices.forEach(function (v) { if (v.channel === channel) { release(v, time, immediate); } });
		}
		song.events.forEach(function (event) {
			if (event.tempo) return;
			var time = event.time, channel = channels[event.channel], kind = event.kind;
			// Prune completed voices before applying controllers or counting polyphony.
			voices = voices.filter(function (v) { return v.end === undefined || v.end + v.release > time; });
			if (kind === 12) { channel.program = event.a; return; }
			if (kind === 14) {
				channel.bend = (event.a + event.b * 128 - 8192) / 8192 * 200;
				voices.forEach(function (v) { if (v.channel === event.channel && v.source.detune) v.source.detune.setValueAtTime(channel.bend, time); });
				return;
			}
			if (kind === 11) {
				if (event.a === 7) channel.volume = event.b;
				if (event.a === 11) channel.expression = event.b;
				if (event.a === 7 || event.a === 11) channel.gain.gain.setValueAtTime(channel.volume * channel.expression / 16129, time);
				if (event.a === 10) channel.pan.pan.setValueAtTime((event.b - 64) / 64, time);
				if (event.a === 64) {
					channel.sustain = event.b >= 64;
					if (!channel.sustain) voices.forEach(function (v) { if (v.channel === event.channel && v.keyUp) release(v, time); });
				}
				if (event.a === 120 || event.a === 123) releaseChannel(event.channel, time, event.a === 120);
				if (event.a === 121) {
					channel.expression = 127; channel.sustain = false; channel.bend = 0;
					channel.gain.gain.setValueAtTime(channel.volume / 127, time); channel.pan.pan.setValueAtTime(0, time);
					voices.forEach(function (v) { if (v.channel === event.channel) { if (v.keyUp) release(v, time); if (v.source.detune) v.source.detune.setValueAtTime(0, time); } });
				}
				return;
			}
			if (kind === 8 || kind === 9 && !event.b) {
				for (var n = 0; n < voices.length; ++n) {
					var old = voices[n];
					if (old.channel === event.channel && old.note === event.a && !old.keyUp && old.end === undefined) {
						old.keyUp = true; if (!channel.sustain && !old.drum) release(old, time); break;
					}
				}
				return;
			}
			if (kind !== 9) return;
			if (voices.length >= 64) throw new Error("This MIDI exceeds the 64-voice limit.");
			var envelope = context.createGain(), source, family = channel.program >> 3;
			var pad = family === 6 || family === 11, drum = event.channel === 9;
			var pluck = family === 0 || family === 1 || family === 3 || family === 13;
			var attack = pad ? .32 : drum ? .002 : .006;
			var tail = pad ? .85 : family === 1 ? .6 : family === 4 ? .12 : .22;
			var level = Math.pow(event.b / 127, 1.35) * (drum ? .42 : family === 4 ? .2 : .15);
			var sustain = pluck ? .08 : .72, decay = family === 1 ? .55 : .23;
			if (drum) {
				source = context.createBufferSource(); source.buffer = percussion(event.a);
				source.connect(envelope); sustain = 1;
			} else {
				source = context.createOscillator(); source.setPeriodicWave(instrument(family));
				source.frequency.value = 440 * Math.pow(2, (event.a - 69) / 12); source.detune.value = channel.bend;
				var filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = .5;
				var cutoff = family === 4 ? 1300 : pad ? 2100 : 3500 + event.b * 22;
				filter.frequency.setValueAtTime(cutoff, time);
				if (pluck || family === 4) filter.frequency.exponentialRampToValueAtTime(Math.max(350, cutoff * .28), time + .35);
				source.connect(filter); filter.connect(envelope);
			}
			envelope.connect(channel.gain);
			envelope.gain.setValueAtTime(0, time);
			envelope.gain.linearRampToValueAtTime(level, time + attack);
			envelope.gain.setTargetAtTime(level * sustain, time + attack, decay);
			var voice = { source: source, gain: envelope, channel: event.channel, note: event.a, release: tail,
				drum: drum, start: time, level: level, attack: attack, sustain: sustain, decay: decay };
			voices.push(voice); source.start(time);
			if (drum) { voice.end = time + source.buffer.duration; voice.release = 0; }
		});
		voices.forEach(function (voice) { release(voice, song.duration); });
		return context.startRendering().then(function (buffer) {
			// Wrap release tails into the loop start, then normalize once, never per frame.
			var peak = 0;
			for (var c = 0; c < 2; ++c) {
				var values = buffer.getChannelData(c);
				for (var j = length; j < values.length; ++j) values[(j - length) % length] += values[j];
				// Join the final few milliseconds smoothly to the wrapped release tail.
				joinLoop(values, length);
				for (j = 0; j < length; ++j) peak = Math.max(peak, Math.abs(values[j]));
			}
			// Match the bundled tracks' mix level; preserve imported MIDI dynamics.
			var scale = peak > 0.85 ? 0.85 / peak : normalize && peak > 0 ? Math.min(4, .42 / peak) : 1;
			if (scale !== 1) for (c = 0; c < 2; ++c) { values = buffer.getChannelData(c); for (j = 0; j < length; ++j) values[j] *= scale; }
			return { buffer: buffer, duration: length / rate };
		});
	}
	var audio, output, source, sourceGain, rendered, renderedName, progressJob, decoder, busy = false, generation = 0, offset = 0, started = 0;
	var renderQueue = Promise.resolve();
	var importVersion = 0;
	var enabled = true, muted = false, active = false, volume = 50, selected = "campaign", custom = null;
	var sceneMap = 0, sceneEnd = false, introPlaying = false;
	var toggle = document.getElementById("music-toggle"), slider = document.getElementById("music-volume");
	var select = document.getElementById("music-track"), status = document.getElementById("music-status");
	try {
		var saved = JSON.parse(localStorage.getItem("gridfall-music"));
		if (saved) {
			if (typeof saved.enabled === "boolean") enabled = saved.enabled;
			if (typeof saved.volume === "number" && isFinite(saved.volume)) volume = Math.max(0, Math.min(100, saved.volume));
			// Move the old default to the campaign score, keeping explicit alternatives.
			if (saved.track === "campaign" || saved.track === "night-grid" || saved.track === "machine-heart" ||
				(saved.track === "signal-lost" && saved.version === 2)) selected = saved.track;
		}
	} catch (error) {}
	function settings() {
		toggle.textContent = enabled ? "Music: on" : "Music: off"; toggle.setAttribute("aria-pressed", String(enabled));
		slider.value = volume; select.value = selected;
		// Bundled ambience needs more presence; imported files retain their own mix level.
		if (output) output.gain.value = volume / 100 * (selected === "custom" ? 1 : 2);
		try { localStorage.setItem("gridfall-music", JSON.stringify({ enabled: enabled, volume: volume, track: selected, version: 2 })); } catch (error) {}
	}
	function trackName() {
		if (selected !== "campaign") return selected;
		if (sceneEnd) return "route-forward";
		return sceneMap ? "level-" + (sceneMap < 10 ? "0" : "") + sceneMap : "signal-lost";
	}
	function stop(fade) {
		if (!source) return;
		offset = (offset + audio.currentTime - started) % rendered.duration;
		var previous = source, gain = sourceGain, now = audio.currentTime;
		source = null; sourceGain = null;
		if (fade) {
			gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now);
			gain.gain.linearRampToValueAtTime(0, now + .18);
			previous.onended = function () { previous.disconnect(); gain.disconnect(); };
			previous.stop(now + .18);
		} else { previous.stop(); previous.disconnect(); gain.disconnect(); }
	}
	function update() {
		if (!audio || !active || !enabled || muted || !volume || document.hidden) { stop(); return; }
		// Prepare the score during the bulb sound, but keep playback silent until it ends.
		if (introPlaying) stop();
		if (!rendered || renderedName !== trackName()) { if (!busy) load(); return; }
		if (introPlaying || source) return;
		source = audio.createBufferSource(); source.buffer = rendered.buffer;
		sourceGain = audio.createGain(); sourceGain.gain.setValueAtTime(0, audio.currentTime);
		sourceGain.gain.linearRampToValueAtTime(1, audio.currentTime + .35);
		source.loop = true; source.loopEnd = rendered.duration; source.connect(sourceGain); sourceGain.connect(output);
		started = audio.currentTime; source.start(0, offset);
	}
	function fetchMidi(name) {
		return fetch("music/" + name + ".mid?v=4").then(function (response) {
			if (!response.ok) throw new Error("Music file could not be loaded."); return response.arrayBuffer();
		});
	}
	function prepareScore(name, version) {
		// Bundled scores are already synthesized. Decode at their native sample rate
		// to avoid rebuilding thousands of audio nodes or doubling buffer memory.
		return fetch("music/" + name + ".ogg?v=1").then(function (response) {
			if (!response.ok) throw new Error("Music file could not be loaded.");
			return response.arrayBuffer();
		}).then(function (data) {
			if (version !== undefined && version !== generation) return null;
			if (!decoder) {
				var AudioClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
				decoder = AudioClass ? new AudioClass(2, 1, 22050) : audio;
			}
			return decoder.decodeAudioData(data).then(function (buffer) {
				// Lossy decoding can reintroduce a tiny discontinuity at the loop boundary.
				for (var c = 0; c < buffer.numberOfChannels; ++c) joinLoop(buffer.getChannelData(c), buffer.length);
				return { buffer: buffer, duration: buffer.duration };
			});
		}).catch(function () {
			// Keep MIDI playback available on hosts or browsers without the recordings.
			if (version !== undefined && version !== generation) return null;
			return fetchMidi(name).then(function (data) {
				var job = renderQueue.then(function () {
					return version === undefined || version === generation ? renderMidi(data, true) : null;
				});
				renderQueue = job.catch(function () {}); return job;
			});
		});
	}
	function prepareProgress() {
		if (progressJob) return progressJob;
		// Keep just the short progress cue ready; level buffers are replaced as we travel.
		progressJob = prepareScore("route-forward").catch(function (error) { progressJob = null; throw error; });
		return progressJob;
	}
	function load() {
		var version = ++generation, name = trackName(); busy = true;
		status.textContent = "Preparing music…";
		var request = name === "route-forward" ? prepareProgress() : name === "custom" ? Promise.resolve(custom) : prepareScore(name, version);
		request.then(function (data) {
			if (name !== "custom") return data;
			// Serialize off-line renders even when tracks are changed rapidly.
			var job = renderQueue.then(function () { return version === generation ? renderMidi(data, name !== "custom") : null; });
			renderQueue = job.catch(function () {}); return job;
		}).then(function (result) {
			if (version !== generation || !result) return;
			stop(true); offset = 0; rendered = result; renderedName = name; busy = false; status.textContent = ""; update();
			if (selected === "campaign" && name !== "route-forward") prepareProgress().catch(function () {});
		}).catch(function (error) {
			if (version !== generation) return;
			// A temporary fetch/render failure must not save a permanent Music: off preference.
			busy = false; status.textContent = error.message + " Toggle music to retry.";
		});
	}
	function changeTrack() { ++generation; busy = false; renderedName = null; update(); }
	function unlock() { if (window.doomGame) window.doomGame.enableAudio(); }
	toggle.onclick = function () { ++importVersion; enabled = !enabled; settings(); unlock(); update(); };
	slider.oninput = function () { volume = Number(slider.value); settings(); unlock(); update(); };
	select.onchange = function () { ++importVersion; selected = select.value; settings(); changeTrack(); unlock(); };
	document.getElementById("music-open").onclick = function () { document.getElementById("music-file").click(); };
	document.getElementById("music-file").onchange = function () {
		var file = this.files[0]; this.value = ""; if (!file) return;
		var version = ++importVersion;
		if (file.size > 1048576) { status.textContent = "Choose a MIDI file smaller than 1 MB."; return; }
		unlock();
		var reader = new FileReader();
		reader.onerror = function () { if (version === importVersion) status.textContent = "The MIDI file could not be read."; };
		reader.onload = function () {
			// A delayed import must not replace a newer track or undo Music: off.
			if (version !== importVersion) return;
			try { readMidi(reader.result); } catch (error) { status.textContent = error.message; return; }
			custom = reader.result;
			var option = select.querySelector('option[value="custom"]');
			if (!option) { option = document.createElement("option"); option.value = "custom"; select.appendChild(option); }
			option.textContent = file.name; selected = "custom"; enabled = true; settings(); changeTrack();
		};
		reader.readAsArrayBuffer(file);
	};
	document.addEventListener("visibilitychange", update);
	window.doomMusic = {
		// The first user gesture unlocks music in menus as well as gameplay.
		attach: function (context, destination) { audio = context; active = true; output = audio.createGain(); output.gain.value = volume / 100 * (selected === "custom" ? 1 : 2); output.connect(destination); update(); },
		setMuted: function (value) { muted = value; update(); },
		setIntroPlaying: function (value) { if (introPlaying !== value) { introPlaying = value; update(); } },
		setScene: function (map, end) {
			var previous = trackName();
			sceneMap = map >= 1 && map <= 24 ? Math.floor(map) : 0; sceneEnd = !!end;
			if (trackName() !== previous) {
				// End the old scene's cue now, even while the next MIDI is loading.
				stop(); offset = 0; changeTrack();
			}
		}
	};
	window.addEventListener("doom-stopped", function () { window.doomMusic.setScene(0, false); });
	settings();
}());
