(function () {
	"use strict";
	var canvas = document.getElementById("game");
	var context = canvas.getContext("2d", { alpha: false });
	var frame, stateView;
	var displayFrames = 0, displayAt = 0, displayFPS = 0, lastDisplay = 0;
	var status = document.getElementById("status");
	var setting = document.getElementById("setting"), shownMap = -1;
	var start = document.getElementById("start");
	var level = document.getElementById("level");
	var skill = document.getElementById("skill");
	var module, active = false, focused = false, muted = false;
	var keys = {}, tapped = 0, pendingWeapon = -1, lastTime = 0, accumulator = 0, networkGame = false;
	var touchButtons = 0;
	var renderDirty = true, replaying = false;
	var rollbackParts = [], rollbackMapped;
	var commandBuffer = 0, predictedPose = null, predictedEye = 0, predictedWeapon = null;
	var renderedPlayers = [], renderedAt = 0, renderedMap = 0;
	var controlsLearned = false, controlHint = false, hintTimer, hintStarted = 0, hintClicks = 0, hintTravel = 0, menuOpen = false;
	var hintDelay = 7000;
	var chatEntry = document.getElementById("chat-entry"), chatLog = document.getElementById("chat-log");
	var chatMessages = [], chatTimer, chatLayer = document.createElement("canvas");
	chatLayer.width = 384; chatLayer.height = 216;
	var chatContext = chatLayer.getContext("2d");
	function drawChat() {
		clearTimeout(chatTimer);
		var now = Date.now();
		chatMessages = chatMessages.filter(function (message) { return message.until > now; });
		var c = chatContext, lines = [], colors = ["#b7d997", "#a5cfff", "#ffafa0", "#ffda83"];
		c.clearRect(0, 0, 384, 216); c.font = "9px monospace";
		chatMessages.forEach(function (message) {
			var text = (message.slot < 0 ? "" : "P" + (message.slot + 1) + ": ") + message.text;
			while (text) {
				var count = text.length > 66 ? text.lastIndexOf(" ", 66) : text.length;
				if (count < 20) count = Math.min(66, text.length);
				lines.push({ text: text.slice(0, count), color: colors[message.slot] || "#d7d0b4" });
				text = text.slice(count).replace(/^ +/, "");
			}
		});
		// Keep messages below the objective and above the HUD or open chat entry.
		lines = lines.slice(-6);
		var y = (chatEntry.hidden ? 169 : 141) - (lines.length - 1) * 11;
		lines.forEach(function (line) {
			c.fillStyle = "rgba(0,0,0,.7)"; c.fillRect(4, y - 9, 376, 11);
			c.fillStyle = line.color; c.fillText(line.text, 8, y); y += 11;
		});
		if (!chatEntry.hidden) {
			c.fillStyle = "rgba(0,0,0,.85)"; c.fillRect(4, 148, 376, 27);
			var caret = chatEntry.selectionEnd || 0, first = Math.max(0, caret - 60);
			c.fillStyle = "#ffe0a0"; c.fillText("SAY: " + chatEntry.value.slice(first, first + 61), 8, 159);
			c.fillRect(Math.round(8 + c.measureText("SAY: " + chatEntry.value.slice(first, caret)).width), 151, 1, 9);
			c.fillStyle = "#a1a38b"; c.fillText("ENTER: SEND   ESC: CANCEL", 8, 171);
		}
		renderDirty = true;
		if (chatMessages.length) chatTimer = setTimeout(drawChat, Math.max(1, Math.min.apply(null, chatMessages.map(function (message) { return message.until; })) - now));
	}
	function closeChat(refocus) {
		if (chatEntry.hidden) return;
		chatEntry.hidden = true; chatEntry.value = ""; drawChat();
		if (refocus) focus();
	}
	function resetChat() {
		closeChat(false); chatMessages = []; chatLog.textContent = ""; drawChat();
	}
	chatEntry.addEventListener("input", drawChat);
	chatEntry.addEventListener("keyup", function () { if (!chatEntry.hidden) drawChat(); });
	chatEntry.addEventListener("blur", function () { closeChat(false); });
	chatEntry.addEventListener("keydown", function (event) {
		event.stopPropagation();
		if (event.isComposing || event.keyCode === 229) return;
		if (event.code === "Enter" || event.code === "NumpadEnter" || event.code === "Escape") {
			event.preventDefault();
			if (event.repeat) return;
			if (event.code !== "Escape" && chatEntry.value.trim() && !window.doomRoom.sendChat(chatEntry.value)) return;
			closeChat(true);
		}
	});
	var savedCheckpoint = null, saveError = "";
	var completedLevels = 0, savedCompletedLevels = 0;
	var storedCheckpoint = null;
	try { storedCheckpoint = localStorage.getItem("gridfall-checkpoint"); }
	catch (error) { saveError = "Browser storage is unavailable; progress will last only for this visit."; }
	try {
		var saved = JSON.parse(storedCheckpoint);
		if (Array.isArray(saved) && saved.length === 16 && saved.every(Number.isInteger) && saved[0] === 1 && saved[1] >= 1 && saved[1] <= 24 && saved[2] >= 0 && saved[2] <= 4) savedCheckpoint = saved;
	} catch (error) { saveError = "The saved checkpoint is unreadable. Start a new campaign to replace it."; }
	try {
		var route = JSON.parse(localStorage.getItem("gridfall-route"));
		if (savedCheckpoint && route && JSON.stringify(route.checkpoint) === JSON.stringify(savedCheckpoint) && Number.isInteger(route.completed))
			completedLevels = savedCompletedLevels = route.completed & 0xffffff;
	} catch (error) {}
	var audio, master, audioOutput, soundBuffers = {}, soundSources = {}, soundTakes = {};
	var menuSamples = {}, menuBuffers = {}, menuSource;
	var introBuffer, introSource;
	var pad = { up: 0x40000000, down: 0x80000000, left: 0x10000000, right: 0x20000000,
		fire: 0x08000000, use: 0x04000000, run: 0x02000000, pause: 0x01000000,
		strafeLeft: 0x00200000, strafeRight: 0x00400000 };
	var handled = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ControlLeft", "ControlRight",
		"Space", "Enter", "NumpadEnter", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "Tab", "KeyP",
		"KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8"];
	for (var i = 1; i <= 24; ++i) {
		var option = document.createElement("option");
		option.value = i;
		option.textContent = i + ". " + window.doomLevels[i - 1].slice(0, 2).join(" / ");
		level.appendChild(option);
	}
	function enableAudio() {
		if (!audio) {
			var AudioClass = window.AudioContext || window.webkitAudioContext;
			if (!AudioClass) return;
			audio = new AudioClass();
			master = audio.createGain();
			master.gain.value = muted ? 0 : 0.5;
			master.connect(audio.destination);
			audioOutput = audio.createMediaStreamDestination();
			master.connect(audioOutput);
			if (window.doomMusic) window.doomMusic.attach(audio, master);
		}
		if (audio.state === "suspended") audio.resume().catch(function () {});
	}
	function stopSound(id) {
		if (replaying) return;
		if (soundSources[id]) {
			try { soundSources[id].stop(); } catch (e) {}
			delete soundSources[id];
		}
	}
	function menuSound(kind) {
		// PC-style navigation/confirm/switch cues, using GRIDFALL's own effects.
		var id = kind === "move" ? 17 : kind === "select" ? 1 : kind === "back" ? 22 : 21;
		var sample = menuSamples[id];
		if (muted) return;
		enableAudio();
		if (!sample || !audio || audio.state === "closed") return;
		if (!menuBuffers[id]) {
			var length = Math.min(sample.pcm.length, Math.floor(sample.rate * (kind === "select" ? 0.2 : 0.12)));
			var buffer = audio.createBuffer(1, length, sample.rate), values = buffer.getChannelData(0);
			for (var i = 0; i < length; ++i) {
				var value = sample.pcm[i];
				values[i] = (value > 127 ? value - 256 : value) / 128 * Math.min(1, (length - 1 - i) / (sample.rate * 0.015));
			}
			menuBuffers[id] = buffer;
		}
		if (menuSource) { try { menuSource.stop(); } catch (error) {} }
		var source = audio.createBufferSource(), gain = audio.createGain();
		source.buffer = menuBuffers[id]; gain.gain.value = 0.65;
		source.connect(gain); gain.connect(master); menuSource = source;
		source.onended = function () { if (menuSource === source) menuSource = null; source.disconnect(); gain.disconnect(); };
		// Scheduling on a suspended context preserves the first cue while resume completes.
		source.start();
	}
	function stopIntroSound() {
		if (introSource) { try { introSource.stop(); } catch (error) {} introSource = null; }
	}
	function introSound(elapsed, cues) {
		// Use the existing unlocked audio context and master mute/capture routing.
		// Never queue this on a suspended context: it must not play late over a menu.
		var duration = cues[cues.length - 1][0] + 80;
		if (muted || elapsed < 0 || elapsed >= duration) return false;
		if (!audio) enableAudio();
		if (!audio || audio.state !== "running") return false;
		if (!introBuffer) {
			var rate = 22050, length = Math.ceil(rate * duration / 1000), random = 130219, noise = 0, lowNoise = 0, envelope = 0, cue = 1;
			var grain = 0, grainTarget = 0, grainEnd = 0;
			introBuffer = audio.createBuffer(1, length, rate);
			var data = introBuffer.getChannelData(0);
			for (var i = 0; i < length; ++i) {
				var t = i / rate, ms = t * 1000;
				while (cue < cues.length - 1 && ms >= cues[cue][0]) ++cue;
				var power = ms >= cues[cue][0] ? cues[cue][1] : cues[cue - 1][1];
				// Short ramps prevent sample discontinuities; the light itself cuts instantly.
				envelope += Math.max(-1 / (rate * .003), Math.min(1 / (rate * .002), power - envelope));
				random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
				noise = noise * .25 + ((random >>> 0) / 2147483648 - 1) * .75;
				lowNoise += (noise - lowNoise) * .22;
				if (i >= grainEnd) {
					grainTarget = (random & 7) < 3 ? .08 : .45 + ((random >>> 8) & 255) / 464;
					grainEnd = i + Math.floor(rate * (.004 + ((random >>> 16) & 255) / 15000));
				}
				grain += (grainTarget - grain) * .06;
				var failing = Math.max(0, Math.min(1, (ms - cues[1][0] + 130) / 60));
				// Irregular, band-limited crackle without a bass note or pitched decay.
				data[i] = (noise - lowNoise) * grain * (.008 + failing * .95) * envelope * Math.min(1, t / .7);
			}
		}
		stopIntroSound();
		var source = audio.createBufferSource(); source.buffer = introBuffer; source.connect(master); introSource = source;
		source.onended = function () { if (introSource === source) introSource = null; source.disconnect(); };
		source.start(0, elapsed / 1000); return true;
	}
	function playSound(id, pointer, size, rate, left, right) {
		if (replaying) return;
		if (!audio || audio.state !== "running") return;
		// Player pain, effort and death resources contain three voiced takes.
		var human = id === 23 || id === 29 || id === 44 || id === 59;
		var take = soundTakes[id] || 0;
		soundTakes[id] = (take + 1) % 3;
		if (human) { size = Math.floor(size / 3); pointer += take * size; }
		var key = human ? id + "/" + take : String(id);
		if (!soundBuffers[key]) {
			var buffer = audio.createBuffer(1, size, rate);
			var samples = buffer.getChannelData(0);
			for (var i = 0; i < size; ++i) {
				var value = module.HEAPU8[pointer + i];
				samples[i] = (value > 127 ? value - 256 : value) / 128;
			}
			soundBuffers[key] = buffer;
		}
		stopSound(id);
		var source = audio.createBufferSource();
		var gain = audio.createGain();
		var panner = audio.createStereoPanner();
		source.buffer = soundBuffers[key];
		// Presentation-only variation; never consume the engine's gameplay RNG.
		if (!human) source.playbackRate.value = [1, 0.975, 1.025][take];
		gain.gain.value = Math.max(left, right) / 255;
		panner.pan.value = (right - left) / Math.max(1, left + right);
		source.connect(gain);
		gain.connect(panner);
		panner.connect(master);
		soundSources[id] = source;
		source.onended = function () {
			if (soundSources[id] === source) delete soundSources[id];
			source.disconnect(); gain.disconnect(); panner.disconnect();
		};
		source.start();
	}
	function buttons() {
		var result = 0;
		var alt = keys.AltLeft || keys.AltRight;
		if (keys.ArrowUp || keys.KeyW) result |= pad.up;
		if (keys.ArrowDown || keys.KeyS) result |= pad.down;
		if (keys.ArrowLeft) result |= alt ? pad.strafeLeft : pad.left;
		if (keys.ArrowRight) result |= alt ? pad.strafeRight : pad.right;
		if (keys.KeyA) result |= pad.strafeLeft;
		if (keys.KeyD) result |= pad.strafeRight;
		if (keys.KeyF || keys.ControlLeft || keys.ControlRight) result |= pad.fire;
		if (keys.Space) result |= pad.use;
		if (keys.ShiftLeft || keys.ShiftRight) result |= pad.run;
		if (keys.KeyP) result |= pad.pause;
		return (result | touchButtons) >>> 0;
	}
	function release() {
		keys = {};
		touchButtons = 0;
		window.dispatchEvent(new Event("doom-input-release"));
		tapped = 0;
		pendingWeapon = -1;
		if (networkGame && window.doomRoom) window.doomRoom.sendInput();
		focused = false;
		canvas.classList.remove("keyboard-active");
		if (controlHint) renderDirty = true;
		if (document.activeElement === canvas) canvas.blur();
		if (active) status.textContent = "Click the game to control it.";
	}
	function focus(resetHint) {
		if (!active) return;
		if (resetHint === true) { controlHint = false; waitForControls(); }
		enableAudio();
		canvas.focus();
		focused = true;
		canvas.classList.add("keyboard-active");
		if (controlHint) renderDirty = true;
		status.textContent = "Keyboard active — Esc opens the menu; click outside to release.";
	}
	canvas.addEventListener("pointerdown", focus);
	function showControlHint() {
		if (document.body.classList.contains("touch-mode") || controlsLearned || controlHint || !active || menuOpen || !chatEntry.hidden || document.hidden || !document.hasFocus()) return;
		var s = gameState();
		if (s[14] || s[36] || s[12] === 1 || !s[13]) return;
		controlHint = true; renderDirty = true;
	}
	function waitForControls() {
		clearTimeout(hintTimer);
		if (controlsLearned || !active || menuOpen) return;
		hintStarted = performance.now(); hintClicks = hintTravel = 0;
		hintTimer = setTimeout(showControlHint, hintDelay);
	}
	canvas.addEventListener("pointerdown", function () {
		if (!active || controlsLearned || menuOpen) return;
		if (++hintClicks >= 3 && performance.now() - hintStarted >= hintDelay) showControlHint();
	});
	canvas.addEventListener("pointermove", function (event) {
		if (!active || controlsLearned || controlHint || menuOpen || event.pointerType !== "mouse") return;
		hintTravel += (Math.abs(event.movementX) + Math.abs(event.movementY)) * 384 / Math.max(1, canvas.clientWidth);
		if (hintTravel >= 120 && performance.now() - hintStarted >= hintDelay) showControlHint();
	});
	window.addEventListener("doom-started", resetChat);
	window.addEventListener("doom-stopped", resetChat);
	window.addEventListener("doom-started", function () { menuOpen = false; controlHint = false; waitForControls(); });
	window.addEventListener("doom-stopped", function () { clearTimeout(hintTimer); controlHint = false; });
	window.addEventListener("focus", waitForControls);
	canvas.addEventListener("blur", release);
	window.addEventListener("blur", release);
	document.addEventListener("pointerdown", function (event) {
		if (event.target !== canvas && !event.target.closest("#touch-controls")) release();
	}, true);
	document.addEventListener("visibilitychange", function () {
		release(); lastTime = 0; accumulator = 0;
		renderedAt = 0;
	});
	canvas.addEventListener("keydown", function (event) {
		if (!active || !focused || handled.indexOf(event.code) === -1) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat) return;
		if (event.code === "Enter" || event.code === "NumpadEnter") {
			var state = gameState();
			if (state[36] || state[12] === 1) {
				// A one-shot confirm cannot remain held as Use after the next map loads.
				tapped |= pad.use;
				if (networkGame && window.doomRoom) window.doomRoom.sendInput();
			} else if (networkGame && window.doomRoom.getState().phase === "running") {
				release(); clearTimeout(hintTimer); controlHint = false;
				chatEntry.hidden = false; chatEntry.value = ""; chatEntry.focus(); drawChat();
			}
			return;
		}
		if (!controlsLearned && /^(Arrow(Up|Down|Left|Right)|Key[WASDF]|Control(Left|Right)|Space)$/.test(event.code) && !gameState()[14]) {
			controlsLearned = true; controlHint = false; clearTimeout(hintTimer); renderDirty = true;
		}
		if (/^Digit[1-8]$/.test(event.code)) {
			if (networkGame) {
				pendingWeapon = Number(event.code.slice(5)) - 1;
				if (window.doomRoom) window.doomRoom.sendInput();
			}
			else module._doom_weapon(Number(event.code.slice(5)) - 1);
			return;
		}
		if (event.code === "Tab") { module._doom_map(); renderDirty = true; return; }
		if (networkGame && event.code === "KeyP") return;
		keys[event.code] = true;
		tapped |= buttons();
		if (networkGame && window.doomRoom) window.doomRoom.sendInput();
	});
	canvas.addEventListener("keyup", function (event) {
		if (!focused || handled.indexOf(event.code) === -1) return;
		event.preventDefault();
		event.stopPropagation();
		delete keys[event.code];
		if (networkGame && window.doomRoom) window.doomRoom.sendInput();
	});
	document.getElementById("mute").onclick = function () {
		muted = !muted;
		enableAudio();
		if (master) master.gain.value = muted ? 0 : 0.5;
		if (window.doomMusic) window.doomMusic.setMuted(muted);
		this.textContent = muted ? "Enable sound" : "Mute sound";
		this.setAttribute("aria-pressed", String(muted));
	};
	function gameState() {
		var pointer = module._doom_state();
		if (!stateView || stateView.buffer !== module.HEAPU8.buffer) stateView = new Int32Array(module.HEAPU8.buffer, pointer, 43);
		return stateView;
	}
	function saveCheckpoint() {
		if (networkGame) return;
		savedCheckpoint = Array.from(new Int32Array(module.HEAPU8.buffer, module._doom_checkpoint(), 16));
		try { localStorage.setItem("gridfall-checkpoint", JSON.stringify(savedCheckpoint)); saveError = ""; }
		catch (error) { saveError = "Browser storage is unavailable; progress will last only for this visit."; }
		window.dispatchEvent(new Event("doom-checkpoint"));
		saveRoute();
	}
	function saveRoute() {
		if (networkGame) return;
		savedCompletedLevels = completedLevels;
		try { localStorage.setItem("gridfall-route", JSON.stringify({ checkpoint: savedCheckpoint, completed: completedLevels })); }
		catch (error) {}
	}
	function smoothPlayers(s) {
		var now = performance.now(), elapsed = now - renderedAt;
		var reset = !renderedAt || renderedMap !== s[0] || elapsed > 250 || menuOpen || s[36];
		var pose = new Int32Array(module.HEAPU8.buffer, module._doom_render_players(), 27);
		if (predictedPose) { pose.set(predictedPose, s[29] * 5); pose[20 + s[29]] = predictedEye; }
		if (predictedWeapon) pose.set(predictedWeapon, 24);
		for (var i = 0; i < 4; ++i) {
			var at = i * 5, previous = renderedPlayers[i];
			var blend = 1 - Math.exp(-Math.max(0, elapsed) / (i === s[29] ? 25 : 90));
			// Respawns, teleports and large corrections take effect immediately.
			if (reset || !previous || !pose[at + 4] || !previous[4] ||
				Math.abs(pose[at] - previous[0]) + Math.abs(pose[at + 1] - previous[1]) > 128 * 65536 ||
				Math.abs(pose[at + 2] - previous[2]) > 48 * 65536) {
				previous = Array.from(pose.subarray(at, at + 5)); previous[5] = pose[20 + i];
			}
			else {
				for (var j = 0; j < 3; ++j) previous[j] += (pose[at + j] - previous[j]) * blend;
				previous[3] = (previous[3] + ((pose[at + 3] - previous[3]) | 0) * blend) | 0;
				previous[4] = pose[at + 4];
				previous[5] += (pose[20 + i] - previous[5]) * blend;
			}
			if (i === s[29]) {
				// Weapon changes reset the position; firing frames still change immediately.
				if (previous[8] !== pose[26]) {
					previous[6] = pose[24]; previous[7] = pose[25]; previous[8] = pose[26];
				} else {
					previous[6] += (pose[24] - previous[6]) * blend;
					previous[7] += (pose[25] - previous[7]) * blend;
				}
				pose[24] = previous[6]; pose[25] = previous[7];
			}
			renderedPlayers[i] = previous;
			for (var field = 0; field < 5; ++field) pose[at + field] = previous[field];
			pose[20 + i] = previous[5];
		}
		renderedAt = now; renderedMap = s[0];
	}
	function draw() {
		lastDisplay = performance.now(); ++displayFrames;
		if (lastDisplay - displayAt >= 1000) { displayFPS = Math.round(displayFrames * 1000 / (lastDisplay - displayAt)); displayAt = lastDisplay; displayFrames = 0; }
		var s = gameState(), room = networkGame && window.doomRoom ? window.doomRoom.getState() : null;
		if (room && room.phase === "loading") {
			context.fillStyle = "#101714"; context.fillRect(0, 0, 384, 216);
			context.textAlign = "center"; context.fillStyle = "#ddbb83"; context.font = "14px monospace";
			context.fillText("JOINING MATCH", 192, 95); context.font = "9px monospace";
			context.fillText("Synchronizing " + room.tick + " / " + room.tip, 192, 115);
			context.textAlign = "left"; renderDirty = false; return;
		}
		if (s[0] !== shownMap) {
			shownMap = s[0];
			setting.textContent = window.doomLevels[shownMap - 1].slice(0, 2).join(" / ") + ". " + window.doomLevels[shownMap - 1][2];
			if (!networkGame) saveCheckpoint();
		}
		// Prediction only draws while the authoritative map and play phase still match.
		if (window.doomMusic && window.doomMusic.setScene) window.doomMusic.setScene(s[0], s[36]);
		if (s[36]) {
			var completed = completedLevels | (1 << (s[0] - 1));
			if (completed !== completedLevels) { completedLevels = completed; saveRoute(); }
			drawDoomIntermission(context, s, completedLevels);
			if (!menuOpen && (chatMessages.length || !chatEntry.hidden)) context.drawImage(chatLayer, 0, 0);
			renderDirty = false;
			return;
		}
		if (networkGame) smoothPlayers(s);
		var pointer = module._doom_render(networkGame ? 1 : 0);
		// Refresh the view only when WASM memory grows; no per-frame pixel copy.
		if (!frame || frame.data.buffer !== module.HEAPU8.buffer)
			frame = new ImageData(new Uint8ClampedArray(module.HEAPU8.buffer, pointer, canvas.width * canvas.height * 4), canvas.width, canvas.height);
		drawDoomFrame(context, frame);
		if (s.buffer !== module.HEAPU8.buffer) s = gameState();
		drawDoomHUD(context, s);
		// An older cached HUD may lack the optional overlays; keep the game running.
		if (!menuOpen && s[12] !== 1 && s[13] && typeof window.drawDoomObjective === "function")
			window.drawDoomObjective(context, s);
		if (controlHint && !menuOpen && chatEntry.hidden && !s[14] && s[12] !== 1 && s[13] && typeof window.drawDoomControls === "function")
			window.drawDoomControls(context, focused);
		if (!menuOpen && (s[14] || s[12] === 1 || !s[13])) {
			context.fillStyle = "rgba(0,0,0,.75)"; context.fillRect((canvas.width - 250) / 2, 70, 250, 32);
			context.fillStyle = "#fff"; context.font = "12px monospace"; context.textAlign = "center";
			context.fillText(s[14] ? "PAUSED — P to resume" : !s[13] ? "You survived!" : networkGame ? "YOU DIED — Enter / Space to respawn" : "YOU DIED — Enter / Space to restart", canvas.width / 2, 90);
			context.textAlign = "left";
		}
		if (!menuOpen && (chatMessages.length || !chatEntry.hidden)) context.drawImage(chatLayer, 0, 0);
		renderDirty = false;
	}
	window.addEventListener("doom-hud-ready", function () { renderDirty = true; });
	function animate(now) {
		try {
			if (active && !document.hidden) {
				if (!lastTime) lastTime = now;
				accumulator += Math.min(now - lastTime, 250);
				lastTime = now;
				// Original demo timing: four 60 Hz ticks per simulation step.
				while (!networkGame && accumulator >= 1000 / 15) {
					var before = gameState(), wasPaused = before[14], wasRunning = before[13];
					module._doom_step((buttons() | tapped) >>> 0);
					if (wasRunning && (!wasPaused || !gameState()[14])) renderDirty = true;
					tapped = 0;
					accumulator -= 1000 / 15;
				}
				if (networkGame) { accumulator = 0; renderDirty = true; }
				if (renderDirty) {
					// HUD updates must use the same predicted view as network frames.
					if (networkGame && window.doomRoom) window.doomRoom.present();
					else draw();
				}
			}
		} catch (error) {
			active = false; release(); status.textContent = "Game stopped: " + error.message;
			console.error(error);
		}
		requestAnimationFrame(animate);
	}
	start.onclick = function () {
		enableAudio();
		release();
		try {
			networkGame = false;
			completedLevels = 0;
			module._doom_multiplayer(1, 0, 0);
			module._doom_start(Number(level.value), Number(skill.value));
			active = true; lastTime = 0; accumulator = 0;
			saveCheckpoint();
			window.dispatchEvent(new Event("doom-started"));
			start.textContent = "Restart game";
			draw(); focus();
		} catch (error) { active = false; status.textContent = "Could not start: " + error.message; console.error(error); }
	};
	window.doomGame = {
		getDisplayFPS: function () { return document.hidden || !menuOpen && performance.now() - lastDisplay > 1500 ? 0 : displayFPS; },
		canvas: canvas,
		focus: focus,
		release: release,
		setTouchInput: function (mask) {
			if (!active || menuOpen || !chatEntry.hidden) return;
			mask = (mask & (pad.up | pad.down | pad.left | pad.right | pad.fire | pad.use | pad.run | pad.strafeLeft | pad.strafeRight)) >>> 0;
			if (mask === touchButtons) return;
			if (mask) {
				focus(); controlsLearned = true; controlHint = false; clearTimeout(hintTimer); renderDirty = true;
			}
			tapped |= mask & ~touchButtons;
			touchButtons = mask;
			if (networkGame && window.doomRoom) window.doomRoom.sendInput();
		},
		touchAction: function (action) {
			if (!active || menuOpen || !chatEntry.hidden) return;
			focus();
			if (action === "weapon") {
				var s = gameState(), weapon = pendingWeapon >= 0 ? pendingWeapon : s[3];
				for (var i = 1; i <= 8; ++i) {
					var next = (weapon + i) % 8;
					if (!(s[16] & (1 << next))) continue;
					if (networkGame) { pendingWeapon = next; window.doomRoom.sendInput(); }
					else module._doom_weapon(next);
					break;
				}
			} else if (action === "map") {
				if (networkGame) { module._doom_map(); renderDirty = true; }
				else tapped |= pad.pause | pad.use;
			} else if (action === "chat" && networkGame && window.doomRoom.getState().phase === "running") {
				release(); clearTimeout(hintTimer); controlHint = false;
				chatEntry.hidden = false; chatEntry.value = ""; chatEntry.focus(); drawChat();
			}
		},
		captureStream: function (fps) {
			if (!active) throw new Error("Start Doom before capturing its stream.");
			enableAudio();
			var stream = canvas.captureStream(fps || 30);
			if (audioOutput) stream.addTrack(audioOutput.stream.getAudioTracks()[0].clone());
			return stream;
		},
		getState: function () { return module ? Array.from(gameState()) : null; },
		enableAudio: enableAudio,
		menuSound: menuSound,
		introSound: introSound,
		isIntroSoundPlaying: function () { return !!introSource; },
		stopIntroSound: stopIntroSound,
		showChat: function (slot, text) {
			chatMessages.push({ slot: slot, text: text, until: Date.now() + (slot < 0 ? 5000 : 8000) });
			if (chatMessages.length > 3) chatMessages.shift();
			chatLog.textContent = (slot < 0 ? "" : "P" + (slot + 1) + ": ") + text; drawChat();
		},
		ready: false,
		isActive: function () { return active; },
		getCheckpoint: function () { return savedCheckpoint ? savedCheckpoint.slice() : null; },
		getSaveError: function () { return saveError; },
		continueCampaign: function () {
			if (!module || !savedCheckpoint || (window.doomRoom && window.doomRoom.getState().phase !== "offline")) return;
			var pointer = module._malloc(64);
			try {
				new Int32Array(module.HEAPU8.buffer, pointer, 16).set(savedCheckpoint);
				if (!module._doom_load_checkpoint(pointer)) { status.textContent = "This checkpoint cannot be loaded. Start a new campaign."; return; }
			} catch (error) {
				active = false; release(); status.textContent = "Could not continue: " + error.message; return;
			} finally { module._free(pointer); }
			enableAudio(); release(); networkGame = false;
			completedLevels = savedCompletedLevels;
			active = true; lastTime = 0; accumulator = 0;
			level.value = String(savedCheckpoint[1]); skill.value = String(savedCheckpoint[2]);
			window.dispatchEvent(new Event("doom-started"));
			draw(); focus();
		},
		setMenu: function (open) {
			if (open) closeChat(false);
			menuOpen = open;
			clearTimeout(hintTimer); controlHint = false;
			if (!open) waitForControls();
			release();
			if (active && !networkGame && !!gameState()[14] !== !!open) {
				module._doom_pause(open ? 1 : 0);
				renderDirty = true;
			}
			if (open && active) draw();
		},
		version: "",
		startNetwork: function (config, slot, replay) {
			if (!replay) { renderedAt = 0; renderedPlayers = []; }
			if (!replay) release(); networkGame = true;
			completedLevels = 0;
			module._doom_seed(parseInt((config.id || "1").slice(0, 8), 16) >>> 0);
			var initialMask = 0; config.owners.forEach(function (id, i) { if (id) initialMask |= 1 << i; });
			module._doom_multiplayer(4, slot, config.mode === "deathmatch" ? 1 : 0, initialMask);
			if (!initialMask) module._doom_roster(0);
			module._doom_start(config.map, config.skill);
			active = true; lastTime = 0; accumulator = 0;
			if (!replay) { window.dispatchEvent(new Event("doom-started")); draw(); }
		},
		stepNetwork: function (inputs, mask, catchup) {
			replaying = !!catchup;
			module._doom_roster(mask);
			if (!commandBuffer) commandBuffer = module._malloc(36 * 4);
			var commands = new Int32Array(module.HEAPU8.buffer, commandBuffer, 36);
			inputs.forEach(function (list, i) {
				commands[i * 9] = list.length;
				list.forEach(function (a, n) { commands[i * 9 + 1 + n * 2] = a[0]; commands[i * 9 + 2 + n * 2] = a[1]; });
			});
			module._doom_net_commands(commandBuffer);
			if (catchup) { var s = gameState(); if (s[36]) completedLevels |= 1 << (s[0] - 1); }
			replaying = false; renderDirty = true;
		},
		setNetworkView: function (slot) { module._doom_view(slot); },
		predictNetwork: function (frames, mask, fraction) {
			if (!active || document.hidden || menuOpen || !frames.length || gameState()[36] || gameState()[12] !== 0) return false;
			var ranges = Array.from(new Uint32Array(module.HEAPU8.buffer, module._doom_snapshot_ranges(), 6));
			var originalMap = gameState()[0], rendered = false;
			var mapLines = Array.from(new Uint32Array(module.HEAPU8.buffer, module._doom_map_lines(), 4));
			if (!rollbackMapped || rollbackMapped.length !== mapLines[2]) rollbackMapped = new Uint8Array(mapLines[2]);
			for (var i = 0; i < 3; ++i) {
				var length = ranges[i * 2 + 1] - ranges[i * 2];
				if (!rollbackParts[i] || rollbackParts[i].length !== length) rollbackParts[i] = new Uint8Array(length);
				rollbackParts[i].set(module.HEAPU8.subarray(ranges[i * 2], ranges[i * 2 + 1]));
			}
			replaying = true;
			try {
				for (var n = 0; n < frames.length; ++n) {
					if (n === frames.length - 1) {
						var at = gameState()[29] * 5;
						var pose = new Int32Array(module.HEAPU8.buffer, module._doom_render_players(), 27);
						predictedPose = Array.from(pose.subarray(at, at + 5)); predictedEye = pose[20 + gameState()[29]];
						predictedWeapon = Array.from(pose.subarray(24, 27));
					}
					var a = frames[n]; module._doom_predict(a[0], a[1]);
					if (gameState()[36] || gameState()[0] !== originalMap) break;
				}
				var nextPose = new Int32Array(module.HEAPU8.buffer, module._doom_render_players(), 27);
				if (predictedWeapon && predictedWeapon[2] === nextPose[26]) {
					for (var w = 0; w < 2; ++w) predictedWeapon[w] += (nextPose[24 + w] - predictedWeapon[w]) * fraction;
				} else predictedWeapon = null;
				if (predictedPose && predictedPose[4] > 0 && nextPose[at + 4] > 0 &&
					Math.abs(nextPose[at] - predictedPose[0]) + Math.abs(nextPose[at + 1] - predictedPose[1]) < 128 * 65536 &&
					Math.abs(nextPose[at + 2] - predictedPose[2]) < 48 * 65536) {
					for (var axis = 0; axis < 3; ++axis) predictedPose[axis] += (nextPose[at + axis] - predictedPose[axis]) * fraction;
					predictedPose[3] = (predictedPose[3] + ((nextPose[at + 3] - predictedPose[3]) | 0) * fraction) | 0;
					predictedEye += (nextPose[20 + gameState()[29]] - predictedEye) * fraction;
				} else { predictedPose = null; predictedWeapon = null; }
				if (!gameState()[36] && gameState()[0] === originalMap) { draw(); rendered = true; }
			} finally {
				predictedPose = null; predictedWeapon = null;
				// Remember walls actually shown to this player, without retaining predicted game state.
				if (rendered) for (var line = 0; line < mapLines[2]; ++line)
					rollbackMapped[line] = (module.HEAPU32[(mapLines[0] + line * mapLines[1]) >>> 2] & mapLines[3]) ? 1 : 0;
				for (var j = 0; j < 3; ++j) module.HEAPU8.set(rollbackParts[j], ranges[j * 2]);
				if (rendered) for (var seen = 0; seen < mapLines[2]; ++seen)
					if (rollbackMapped[seen]) module.HEAPU32[(mapLines[0] + seen * mapLines[1]) >>> 2] |= mapLines[3];
				replaying = false;
			}
			return rendered;
		},
		requestNetworkFrame: function () { renderDirty = true; },
		presentNetwork: function () { if (active && renderDirty && !document.hidden) draw(); },
		stopNetwork: function () {
			replaying = false; active = false; networkGame = false; release();
			renderedAt = 0; Object.keys(soundSources).forEach(stopSound);
			window.dispatchEvent(new Event("doom-stopped"));
		},
		readInput: function () {
			var input = { buttons: buttons(), tap: tapped >>> 0, weapon: pendingWeapon };
			tapped = 0; pendingWeapon = -1;
			return input;
		},
		checksum: function () { return module._doom_checksum() >>> 0; }

	};
	if (typeof createDoom !== "function") {
		status.textContent = "Build the port first: python browser/build.py (see browser/README.md).";
		return;
	}
	function loadFile(name) {
		return fetch("build/" + name + "?v=20261016-6").then(function (response) {
			if (!response.ok) throw new Error(name + " could not be loaded (" + response.status + ").");
			return response.arrayBuffer();
		});
	}
	Promise.all([loadFile("doom.wasm"), loadFile("doom-assets.bin")]).then(function (files) {
		return createDoom({ wasmBinary: files[0], onSound: playSound, onStopSound: stopSound }).then(function (engine) {
			module = engine;
			var bytes = new Uint8Array(files[1]);
			var pointer = module._malloc(bytes.length);
			module.HEAPU8.set(bytes, pointer);
			if (!module._doom_init(pointer, bytes.length)) throw new Error("Invalid game asset bundle.");
			var directory = new DataView(files[1]);
			for (var entry = 0; entry < directory.getUint32(8, true); ++entry) {
				var record = 12 + entry * 12, id = directory.getUint32(record, true) - 1000;
				if (id !== 1 && id !== 17 && id !== 21 && id !== 22) continue;
				var offset = directory.getUint32(record + 4, true), size = directory.getUint32(offset + 4, true);
				menuSamples[id] = { rate: directory.getUint32(offset, true), pcm: bytes.slice(offset + 8, offset + 8 + size) };
			}
			start.disabled = false;
			status.textContent = "Press any key or click the game for the menu.";
			requestAnimationFrame(animate);
			if (!window.crypto || !crypto.subtle) {
				window.doomGame.ready = true; window.dispatchEvent(new Event("doom-ready")); return;
			}
			return Promise.all(files.map(function (file) { return crypto.subtle.digest("SHA-256", file); })).then(function (hashes) {
				window.doomGame.version = "3/" + hashes.map(function (hash) {
					return Array.from(new Uint8Array(hash)).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
				}).join("/");
				window.doomGame.ready = true;
				window.dispatchEvent(new Event("doom-ready"));
			});
		});
	}).catch(function (error) {
		status.textContent = "Could not load Doom: " + error.message;
		console.error(error);
	});
}());
