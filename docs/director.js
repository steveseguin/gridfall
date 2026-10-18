/* Local spectator simulation and program output. Only game inputs cross the network. */
(function () {
	"use strict";
	var versionLabel = document.getElementById("game-version");
	if (versionLabel) versionLabel.textContent = createDoomSession.release ? "v" + createDoomSession.release : "older build";
	var params = new URLSearchParams(location.hash.slice(1)), outputOnly = params.get("output") === "1";
	var canvas = document.getElementById("program"), context = canvas.getContext("2d", { alpha: false });
	var status = document.getElementById("status"), engine, version = "", ready = false;
	var mesh, session, connected = false, generation = 0, layoutOwner = "", layoutOwnerSeen = 0;
	var layoutKey, layoutSerial = 0, receivedSerial = 0, hostOfferDismissed = false;
	var mask = 0;
	var commandBuffer = 0;
	var match = null, next = 0, tip = 0, renderedTick = -1, renderedMask = 0, renderPending = false;
	var lastProgress = 0, completed = 0, message = "Loading engine…";
	var layout = { size: "all", order: [0, 1, 2, 3], audio: 0, labels: true, selected: 15, fit: "contain", arrangement: "auto", follow: true, volume: 50 };
	var colors = ["#9dc985", "#91bbf1", "#e89a88", "#edc268"];
	var tiles = [], tileContexts = [], previews = [], positions = [], playerChecks = [], pixels;
	var audio, master, audioBuffers = {}, sounds = {}, takes = {}, silent = true, listenedSlot = -2;
	var outputKey = params.get("key");
	var legacyOutput = outputOnly && !/^v2_[a-f0-9]{32}$/.test(outputKey || "");
	if (!outputKey || !/^v2_[a-f0-9]{32}$/.test(outputKey)) {
		var random = new Uint32Array(4); crypto.getRandomValues(random);
		outputKey = "v2_" + Array.from(random).map(function (v) { return ("00000000" + v.toString(16)).slice(-8); }).join("");
	}
	if (outputOnly) document.body.classList.add("output");
	function validLayout(value) {
		return value && [1, 2, 4, "all", "selected"].indexOf(value.size) !== -1 && Array.isArray(value.order) && value.order.length === 4 &&
			value.order.every(function (v, i, a) { return Number.isInteger(v) && v >= 0 && v < 4 && a.indexOf(v) === i; }) &&
			Number.isInteger(value.audio) && value.audio >= -1 && value.audio < 4 && typeof value.labels === "boolean" &&
			(value.selected === undefined || Number.isInteger(value.selected) && value.selected >= 0 && value.selected <= 15) &&
			(value.fit === undefined || value.fit === "contain" || value.fit === "cover") &&
			(value.arrangement === undefined || ["auto", "row", "column", "grid", "focus"].indexOf(value.arrangement) >= 0) &&
			(value.follow === undefined || typeof value.follow === "boolean") &&
			(value.volume === undefined || Number.isInteger(value.volume) && value.volume >= 0 && value.volume <= 100);
	}
	try { var saved = JSON.parse(params.get("layout")); if (validLayout(saved)) layout = saved; } catch (error) {}
	function layoutBytes(data, from) { return new TextEncoder().encode(JSON.stringify([document.getElementById("room").value.trim(), from, data.serial, data.layout])); }
	function send(data) {
		if (!session || !mesh || outputOnly || !layoutKey) return;
		var current = session, from = mesh.id;
		data.serial = ++layoutSerial; data.layout = JSON.parse(JSON.stringify(data.layout));
		// Prove possession of the output URL without revealing its secret to players.
		crypto.subtle.sign("HMAC", layoutKey, layoutBytes(data, from)).then(function (proof) {
			if (session !== current) return;
			data.proof = Array.from(new Uint8Array(proof)).map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join("");
			return current.send(data);
		}).catch(function () { notice("Layout could not be sent. Try changing it again."); });
	}
	function notice(text) { if (!text) return; if (outputOnly && session && session.getState().canHost) text = "Waiting for a host to start a match."; message = text; if (status.textContent !== text) status.textContent = text; if (session && session.getState().phase === "fault") { stopSounds(); blank(text); } else if (!match) blank(text); }
	function blank(text) {
		context.fillStyle = "#080e0c"; context.fillRect(0, 0, 768, 432);
		context.fillStyle = "#d1b889"; context.textAlign = "center"; context.font = "16px monospace";
		var lines = [], line = "";
		text.split(" ").forEach(function (word) { if (line.length + word.length > 64) { lines.push(line); line = ""; } line += (line ? " " : "") + word; });
		if (line) lines.push(line);
		lines.forEach(function (value, i) { context.fillText(value, 384, 216 + (i - (lines.length - 1) / 2) * 24); });
		context.textAlign = "left";
	}
	function stopSound(id) {
		if (sounds[id]) { try { sounds[id].stop(); } catch (error) {} delete sounds[id]; }
	}
	function stopSounds() { Object.keys(sounds).forEach(stopSound); }
	function updateAudio() {
		var slot = audioSlot(), enabled = slot >= 0 && (outputOnly || document.getElementById("preview-audio").checked);
		if (master) master.gain.value = enabled ? layout.volume / 100 : 0;
		if (!enabled || !layout.volume || listenedSlot !== slot) stopSounds();
		listenedSlot = slot;
	}
	function unlockAudio() {
		if (!audio) {
			var AudioClass = window.AudioContext || window.webkitAudioContext;
			if (!AudioClass) return;
			audio = new AudioClass(); master = audio.createGain(); master.connect(audio.destination); updateAudio();
		}
		if (audio.state === "suspended") audio.resume().catch(function () {});
	}
	function playSound(id, pointer, length, rate, left, right) {
		if (silent || !audio || audio.state !== "running" || !master.gain.value) return;
		var human = [23, 29, 44, 59].indexOf(id) !== -1, take = takes[id] || 0;
		takes[id] = (take + 1) % 3;
		if (human) { length = Math.floor(length / 3); pointer += take * length; }
		var key = id + "/" + (human ? take : 0);
		if (!audioBuffers[key]) {
			var buffer = audio.createBuffer(1, length, rate), samples = buffer.getChannelData(0);
			for (var n = 0; n < length; ++n) { var value = engine.HEAPU8[pointer + n]; samples[n] = (value > 127 ? value - 256 : value) / 128; }
			audioBuffers[key] = buffer;
		}
		stopSound(id);
		var source = audio.createBufferSource(), gain = audio.createGain(), pan = audio.createStereoPanner();
		source.buffer = audioBuffers[key]; if (!human) source.playbackRate.value = [1, .975, 1.025][take];
		gain.gain.value = Math.max(left, right) / 255; pan.pan.value = (right - left) / Math.max(1, left + right);
		source.connect(gain); gain.connect(pan); pan.connect(master); sounds[id] = source;
		source.onended = function () { if (sounds[id] === source) delete sounds[id]; source.disconnect(); gain.disconnect(); pan.disconnect(); };
		source.start();
	}
	function state() { return Array.from(new Int32Array(engine.HEAPU8.buffer, engine._doom_state(), 43)); }
	function viewSlots() {
		var slots = layout.order.filter(function (n) { return match && (mask & (1 << n)); });
		if (layout.size === "selected") return slots.filter(function (slot) { return !!(layout.selected & (1 << slot)); });
		return layout.size === "all" ? slots : slots.slice(0, layout.size);
	}
	function audioSlot() {
		var slot = layout.follow ? viewSlots()[0] : layout.audio;
		return typeof slot === "number" && slot >= 0 && match && (mask & (1 << slot)) ? slot : -1;
	}
	function requestRender() {
		if (renderPending) return;
		renderPending = true;
		requestAnimationFrame(function () { renderPending = false; render(); });
	}
	function compose() {
		if (session && session.getState().phase === "fault") { blank(message); return; }
		if (!match || !next || !mask) { blank(message); return; }
		var slots = viewSlots(), count = slots.length;
		if (!count) { blank(layout.selected ? "Waiting for the selected players." : "Select players to show."); return; }
		context.fillStyle = "#000"; context.fillRect(0, 0, 768, 432); context.imageSmoothingEnabled = false;
		slots.forEach(function (slot, i) {
			var x = 0, y = 0, width = 768, height = 432;
			if (count > 1) {
				if (layout.arrangement === "row" || layout.arrangement === "auto" && count === 2) { width /= count; x = i * width; }
				else if (layout.arrangement === "column") { height /= count; y = i * height; }
				else if (layout.arrangement === "focus") {
					if (!i) width = 512;
					else { x = 512; width = 256; height /= count - 1; y = (i - 1) * height; }
				} else {
					var row = Math.floor(i / 2), columns = Math.min(2, count - row * 2);
					width /= columns; height /= Math.ceil(count / 2); x = i % 2 * width; y = row * height;
				}
			}
			var scale = layout.fit === "cover" ? Math.max(width / 384, height / 216) : Math.min(width / 384, height / 216);
			if (layout.fit === "cover") {
				var sw = width / scale, sh = height / scale;
				context.drawImage(tiles[slot], (384 - sw) / 2, (216 - sh) / 2, sw, sh, x, y, width, height);
			} else context.drawImage(tiles[slot], x + (width - 384 * scale) / 2, y + (height - 216 * scale) / 2, 384 * scale, 216 * scale);
			if (layout.labels) {
				context.fillStyle = "rgba(0,0,0,.78)"; context.fillRect(x + 4, y + 4, 38, 19);
				context.fillStyle = colors[slot]; context.font = "bold 13px monospace"; context.fillText("P" + (slot + 1), x + 12, y + 18);
			}
		});
		if (Date.now() - lastProgress > 3000 || tip - next > 4) {
			context.fillStyle = "rgba(0,0,0,.8)"; context.fillRect(0, 398, 768, 34);
			context.fillStyle = "#edc268"; context.font = "14px monospace";
			context.fillText(tip - next > 4 ? "Catching up: " + next + " / " + tip : "Waiting for host…", 12, 420);
		}
	}
	function render() {
		if (document.hidden) return;
		if (!match || !next || !mask) { compose(); return; }
		var slots = outputOnly ? viewSlots() : [0, 1, 2, 3].filter(function (i) { return mask & (1 << i); });
		if (next !== renderedTick) renderedMask = 0;
		slots.forEach(function (slot) {
			if (renderedMask & (1 << slot)) return;
			renderedMask |= 1 << slot;
			engine._doom_view(slot); var s = state(), c = tileContexts[slot];
			if (s[36]) window.drawDoomIntermission(c, s, completed);
			else {
				var pointer = engine._doom_render();
				if (!pixels || pixels.data.buffer !== engine.HEAPU8.buffer) pixels = new ImageData(new Uint8ClampedArray(engine.HEAPU8.buffer, pointer, 384 * 216 * 4), 384, 216);
				window.drawDoomFrame(c, pixels); window.drawDoomHUD(c, s);
			}
			if (!outputOnly) { var preview = previews[slot].getContext("2d"); preview.drawImage(tiles[slot], 0, 0); }
		});
		engine._doom_view(audioSlot() >= 0 ? audioSlot() : (viewSlots()[0] || 0));
		compose();
		renderedTick = next;
	}
	function applyLayout(value, publish) {
		if (!validLayout(value)) return;
		layout = { size: value.size, order: value.order.slice(), audio: value.audio, labels: value.labels,
			selected: value.selected === undefined ? 15 : value.selected, fit: value.fit || "contain", arrangement: value.arrangement || "auto",
			follow: value.follow === undefined ? value.audio === value.order[0] : value.follow, volume: value.volume === undefined ? 50 : value.volume };
		var mode = layout.size === "all" ? layout.fit === "cover" ? "crop" : "fit" : "selected";
		Array.from(document.querySelectorAll("[data-mix]")).forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.mix === mode)); });
		document.getElementById("player-selection").hidden = mode !== "selected";
		playerChecks.forEach(function (check, slot) {
			check.checked = layout.size === "selected" || layout.size === "all" ? !!(layout.selected & (1 << slot)) : layout.order.slice(0, layout.size).indexOf(slot) >= 0;
			check.parentElement.classList.toggle("absent", !match || !(mask & (1 << slot)));
			check.parentElement.querySelector("small").textContent = match && (mask & (1 << slot)) ? "" : "waiting";
		});
		document.getElementById("arrangement").value = layout.arrangement;
		document.getElementById("frame-fit").value = layout.fit;
		document.getElementById("crop-hint").hidden = layout.fit !== "cover";
		document.getElementById("audio-player").value = layout.follow ? "featured" : String(layout.audio);
		document.getElementById("output-volume").value = layout.volume;
		document.getElementById("volume-value").textContent = layout.volume + "%";
		positions.forEach(function (select, i) {
			Array.from(select.options).forEach(function (option) { var slot = Number(option.value); option.disabled = !(mask & (1 << slot)) || layout.size === "selected" && !(layout.selected & (1 << slot)); });
			select.value = match ? viewSlots()[i] : layout.order[i]; select.parentElement.hidden = match && i >= viewSlots().length;
		});
		document.getElementById("labels").checked = layout.labels;
		if (publish) send({ type: "watch-layout", layout: layout });
		updateAudio(); updateLink(); requestRender();
	}
	function changeLayout() {
		layout.labels = document.getElementById("labels").checked;
		var choice = document.getElementById("audio-player").value;
		layout.follow = choice === "featured";
		layout.audio = layout.follow ? (viewSlots()[0] === undefined ? layout.order[0] : viewSlots()[0]) : Number(choice);
		applyLayout(layout, true);
	}
	for (var i = 0; i < 4; ++i) (function (slot) {
		var tile = document.createElement("canvas"); tile.width = 384; tile.height = 216; tiles.push(tile); tileContexts.push(tile.getContext("2d", { alpha: false }));
		var button = document.createElement("button"), preview = document.createElement("canvas"), label = document.createElement("span");
		preview.width = 384; preview.height = 216; previews.push(preview); label.textContent = "P" + (slot + 1) + " / Feature";
		button.style.setProperty("--player", colors[slot]); button.appendChild(preview); button.appendChild(label); button.disabled = true;
		button.onclick = function () { var index = layout.order.indexOf(slot); layout.order[index] = layout.order[0]; layout.order[0] = slot; layout.size = "selected"; layout.selected = 1 << slot; changeLayout(); };
		document.getElementById("previews").appendChild(button);
		var playerLabel = document.createElement("label"), check = document.createElement("input"), availability = document.createElement("small");
		check.type = "checkbox"; check.value = slot; check.setAttribute("aria-label", "Show P" + (slot + 1));
		playerLabel.appendChild(check); playerLabel.appendChild(document.createTextNode("P" + (slot + 1))); playerLabel.appendChild(availability);
		document.getElementById("player-selection").appendChild(playerLabel); playerChecks.push(check);
		check.onchange = function () { layout.size = "selected"; layout.selected = 0; playerChecks.forEach(function (input, i) { if (input.checked) layout.selected |= 1 << i; }); changeLayout(); };
		var position = document.createElement("label"), select = document.createElement("select");
		position.appendChild(document.createTextNode("View " + (slot + 1)));
		for (var n = 0; n < 4; ++n) { var option = document.createElement("option"); option.value = n; option.textContent = "P" + (n + 1); select.appendChild(option); }
		select.value = slot; positions.push(select); position.appendChild(select); document.getElementById("positions").appendChild(position);
		select.onchange = function () { var chosen = Number(select.value), other = layout.order.indexOf(chosen), index = match ? layout.order.indexOf(viewSlots()[slot]) : slot; layout.order[other] = layout.order[index]; layout.order[index] = chosen; changeLayout(); };
		var audioOption = document.createElement("option"); audioOption.value = slot; audioOption.textContent = "P" + (slot + 1); document.getElementById("audio-player").appendChild(audioOption);
	}(i));
	document.getElementById("audio-player").value = layout.follow === false ? String(layout.audio) : "featured";
	Array.from(document.querySelectorAll("[data-mix]")).forEach(function (button) {
		button.onclick = function () { layout.size = button.dataset.mix === "selected" ? "selected" : "all"; if (layout.size === "all") { layout.fit = button.dataset.mix === "crop" ? "cover" : "contain"; layout.arrangement = "auto"; } changeLayout(); };
	});
	document.getElementById("arrangement").onchange = function () { layout.arrangement = this.value; changeLayout(); };
	document.getElementById("frame-fit").onchange = function () { layout.fit = this.value; changeLayout(); };
	document.getElementById("output-volume").oninput = function () { layout.volume = Number(this.value); changeLayout(); };
	document.getElementById("labels").onchange = changeLayout;
	document.getElementById("audio-player").onchange = changeLayout;
	document.getElementById("preview-audio").onchange = function () { unlockAudio(); updateAudio(); };
	canvas.onclick = function () { if (outputOnly) unlockAudio(); };
	document.getElementById("fullscreen").onclick = function () {
		var result = document.fullscreenElement ? document.exitFullscreen() : canvas.requestFullscreen();
		if (result && result.catch) result.catch(function () { notice("Fullscreen is unavailable."); });
	};
	function updateLink() {
		var url = new URL("director.html", location.href);
		var settings = new URLSearchParams({ room: document.getElementById("room").value.trim() });
		if (document.getElementById("password").value) settings.set("password", document.getElementById("password").value);
		if (document.getElementById("ninja").value !== "https://vdo.ninja/") settings.set("ninja", document.getElementById("ninja").value);
		var invite = new URL("./", location.href); invite.hash = settings.toString(); document.getElementById("player-link").value = invite.href;
		settings.set("output", "1"); settings.set("key", outputKey); settings.set("layout", JSON.stringify(layout)); url.hash = settings.toString();
		document.getElementById("output-link").value = url.href;
		if (!outputOnly && connected && document.getElementById("room").value.trim()) {
			var bookmark = new URL(location.href); settings.delete("output");
			bookmark.hash = settings.toString(); history.replaceState(null, "", bookmark.href);
		}
	}
	document.getElementById("copy-output").onclick = function () {
		updateLink(); var field = document.getElementById("output-link"); field.focus(); field.select();
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(field.value).catch(function () { notice("Press Ctrl+C to copy the selected output URL."); });
	};
	document.getElementById("copy-player").onclick = function () {
		updateLink(); var field = document.getElementById("player-link"); field.focus(); field.select();
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(field.value).catch(function () { notice("Press Ctrl+C to copy the selected player invite."); });
	};
	function hostControls() {
		var state = session ? session.getState() : null, host = state && state.host;
		document.getElementById("host-room").disabled = !ready || outputOnly || connected && !(state && state.canHost);
		document.getElementById("host-offer").hidden = outputOnly || hostOfferDismissed || !(state && state.canHost);
		status.hidden = !document.getElementById("host-offer").hidden;
		document.getElementById("host-room").hidden = !!host;
		document.getElementById("host-settings").hidden = connected && !host;
		document.getElementById("restart-match").hidden = !host;
		document.getElementById("restart-match").disabled = !host || state.phase === "fault";
		document.getElementById("player-invite").hidden = !host;
	}
	function reset() {
		next = tip = completed = 0; renderedTick = -1; renderedMask = 0; mask = 0; match = null; stopSounds();
		previews.forEach(function (preview) { preview.parentElement.disabled = true; preview.getContext("2d").clearRect(0, 0, 384, 216); });
		updatePlayers();
	}
	function disconnect() {
		++generation;
		var oldMesh = mesh, closing = session ? session.close() : Promise.resolve();
		session = null; mesh = null;
		closing.then(function () { if (oldMesh) setTimeout(function () { oldMesh.close(); }, 300); });
		hostOfferDismissed = false; receivedSerial = 0;
		connected = false; layoutOwner = ""; layoutOwnerSeen = 0; reset();
		document.body.classList.remove("connected"); document.getElementById("connection-title").textContent = "Room";
		["room", "password", "ninja"].forEach(function (id) { document.getElementById(id).readOnly = false; });
		document.getElementById("connect").disabled = !ready;
		document.getElementById("disconnect").disabled = document.getElementById("resync").disabled = true;
		notice("Disconnected."); blank(message); hostControls();
	}
	function attach(connection, host) {
		session = createDoomSession({ id: connection.id, watch: true, host: !!host, version: version,
			send: connection.send, verify: connection.verify, repair: connection.repair,
			start: start,
			step: function (row, catchup) {
				silent = !!catchup;
				if (mask !== row.mask) { mask = row.mask; updatePlayers(); }
				engine._doom_view(audioSlot() >= 0 ? audioSlot() : (viewSlots()[0] || 0));
				engine._doom_roster(row.mask);
				if (!commandBuffer) commandBuffer = engine._malloc(36 * 4);
				var commands = new Int32Array(engine.HEAPU8.buffer, commandBuffer, 36);
				row.inputs.forEach(function (list, i) {
					commands[i * 9] = list.length;
					list.forEach(function (a, n) { commands[i * 9 + 1 + n * 2] = a[0]; commands[i * 9 + 2 + n * 2] = a[1]; });
				});
				engine._doom_net_commands(commandBuffer);
				next = row.seq + 1; lastProgress = Date.now();
				var s = state(); if (s[36]) completed |= 1 << (s[0] - 1);
				return engine._doom_checksum() >>> 0;
			},
			present: function () {
				var s = session.getState(); tip = s.commit;
				if (s.phase === "fault") { compose(); return; }
				if (!mask) notice(s.host ? "Hosting. Waiting for players to join." : "Waiting for players to join.");
				else if (next) notice((s.host ? "Hosting / " : "Live / ") + [0, 1, 2, 3].filter(function (i) { return mask & (1 << i); }).length + " players / " + match.mode);
				requestRender();
			},
			notice: notice,
			change: function (state) { if (state.phase === "lobby" && !state.match) { reset(); blank(message); } hostControls(); },
			message: function (p, from, role) {
				if (role !== "watch" || p.type !== "watch-layout" || !outputOnly || !layoutKey || !validLayout(p.layout) || !Number.isSafeInteger(p.serial) || p.serial < 1 || typeof p.proof !== "string" || !/^[a-f0-9]{64}$/.test(p.proof)) return;
				var current = session, proof = new Uint8Array(p.proof.match(/../g).map(function (b) { return parseInt(b, 16); }));
				return crypto.subtle.verify("HMAC", layoutKey, proof, layoutBytes(p, from)).then(function (valid) {
					if (!valid || current !== session || layoutOwner === from && p.serial <= receivedSerial || layoutOwner && layoutOwner !== from && Date.now() - layoutOwnerSeen <= 3000) return;
					layoutOwner = from; layoutOwnerSeen = Date.now(); receivedSerial = p.serial;
					// Keep the controller alive without redrawing an unchanged layout.
					if (p.layout.size !== layout.size || p.layout.audio !== layout.audio || p.layout.labels !== layout.labels || p.layout.order.join(",") !== layout.order.join(",") || p.layout.selected !== layout.selected || p.layout.fit !== layout.fit || p.layout.arrangement !== layout.arrangement || p.layout.follow !== layout.follow || p.layout.volume !== layout.volume) applyLayout(p.layout, false);
				}).catch(function () {});
			}
		});
		connected = true; document.body.classList.add("connected");
		document.getElementById("connection-title").textContent = document.getElementById("room").value.trim() || "Watching room";
		["room", "password", "ninja"].forEach(function (id) { document.getElementById(id).readOnly = true; });
		document.getElementById("connect").disabled = true; document.getElementById("disconnect").disabled = false;
		notice(host ? "Hosting. Waiting for players to join." : "Waiting for a host to start a match..."); blank(message); hostControls();
	}
	function connect(host) {
		host = host === true && !outputOnly;
		if (!ready) return;
		if (connected) {
			if (host && session && session.getState().canHost) session.start(Number(document.getElementById("host-map").value), Number(document.getElementById("host-skill").value), document.getElementById("host-mode").value);
			return;
		}
		var room = document.getElementById("room").value.trim(), url;
		if (!room && host) { var bytes = new Uint8Array(12); crypto.getRandomValues(bytes); room = "doom" + Array.from(bytes).map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join(""); document.getElementById("room").value = room; }
		if (!room) { notice("Enter the room name to watch."); return; }
		try { url = new URL(document.getElementById("ninja").value); if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))) throw Error("Use HTTPS or a localhost VDO.Ninja URL."); }
		catch (error) { notice(error.message); return; }
		window.doomRoomSettings.save();
		var attempt = ++generation; document.getElementById("connect").disabled = document.getElementById("host-room").disabled = true;
		var connectionSession;
		createDoomMesh({ room: room, password: document.getElementById("password").value, url: url.href, role: "watch", receive: function (p, from, envelope) { if (connectionSession) return connectionSession.receive(p, from, envelope); } }).then(function (connection) {
			if (attempt !== generation) { connection.close(); return; }
			mesh = connection; attach(connection, host); connectionSession = session; if (host) session.start(Number(document.getElementById("host-map").value), Number(document.getElementById("host-skill").value), document.getElementById("host-mode").value);
		}).catch(function (error) { if (attempt !== generation) return; disconnect(); notice(error.message); blank(message); });
		updateLink(); if (outputOnly) unlockAudio();
	}
	function updatePlayers() {
		Array.from(document.getElementById("audio-player").options).forEach(function (option) {
			var slot = Number(option.value);
			if (slot >= 0) option.textContent = "P" + (slot + 1) + (match && (mask & (1 << slot)) ? "" : " (waiting)");
		});
		previews.forEach(function (preview, i) { preview.parentElement.hidden = !(mask & (1 << i)); preview.parentElement.disabled = !(mask & (1 << i)); });
		applyLayout(layout, false);
	}
	function start(config) {
		reset(); match = config; silent = true;
		engine._doom_seed(parseInt(config.id.slice(0, 8), 16) >>> 0);
		mask = 0; config.owners.forEach(function (id, i) { if (id) mask |= 1 << i; });
		engine._doom_multiplayer(4, 0, config.mode === "deathmatch" ? 1 : 0, mask); if (!mask) engine._doom_roster(0); engine._doom_start(config.map, config.skill);
		updatePlayers(); document.getElementById("resync").disabled = false; lastProgress = Date.now();
		notice(mask ? "Synchronizing match..." : session && session.getState().host ? "Hosting. Waiting for players to join." : "Waiting for players to join."); blank(message); applyLayout(layout, !outputOnly);
	}
	setInterval(function () {
		if (!connected || !session) return;
		if (!outputOnly) send({ type: "watch-layout", layout: layout });
		if (match && mask && session.getState().phase !== "fault" && Date.now() - lastProgress > 1500) { notice("Waiting for confirmed gameplay..."); compose(); }
	}, 1000);
	document.getElementById("connect").onclick = function () { connect(false); };
	document.getElementById("host-room").onclick = function () { connect(true); };
	document.getElementById("accept-host").onclick = function () { connect(true); };
	document.getElementById("wait-host").onclick = function () { hostOfferDismissed = true; hostControls(); notice("Waiting for a host. You can choose Host as spectator at any time."); };
	document.getElementById("restart-match").onclick = function () { if (session && session.getState().host) session.start(Number(document.getElementById("host-map").value), Number(document.getElementById("host-skill").value), document.getElementById("host-mode").value); };
	for (var map = 1; map <= 24; ++map) { var option = document.createElement("option"); option.value = map; option.textContent = "Map " + map; document.getElementById("host-map").appendChild(option); }
	document.getElementById("disconnect").onclick = disconnect;
	document.getElementById("resync").onclick = function () {
		if (!session) return;
		if (mesh && !session.getState().host && (session.getState().phase === "fault" || Date.now() - lastProgress > 3000)) { disconnect(); connect(); }
		else session.resync();
	};
	document.addEventListener("visibilitychange", function () { if (document.hidden) { if (!outputOnly && !document.getElementById("preview-audio").checked) stopSounds(); } else requestRender(); });
	window.addEventListener("doom-hud-ready", render);
	window.addEventListener("pagehide", disconnect);
	window.addEventListener("hashchange", function () { location.reload(); });
	window.doomDirector = { receive: function (p, from, envelope) { if (session) return session.receive(p, from, envelope); }, disconnect: disconnect,
		getStats: function () { return session ? session.getStats() : { links: [] }; },
		getState: function () { var s = session ? session.getState() : {}; return { ready: ready, release: createDoomSession.release, version: version, connected: connected, match: match, tick: next, tip: tip, mask: mask, layout: layout, status: message, leader: s.leader, term: s.term, commit: s.commit, hash: match ? engine._doom_checksum() >>> 0 : 0 }; }
	};
	applyLayout(layout, false); blank(message);
	Promise.all(["doom.wasm", "doom-assets.bin"].map(function (name) {
		return fetch("build/" + name + "?v=20261016-6").then(function (r) { if (!r.ok) throw new Error(name + " could not be loaded."); return r.arrayBuffer(); });
	})).then(function (files) {
		return createDoom({ wasmBinary: files[0], onSound: playSound, onStopSound: stopSound }).then(function (module) {
			engine = module;
			if (!engine._doom_view) throw new Error("Rebuild the WASM engine for director support.");
			var pointer = engine._malloc(files[1].byteLength); engine.HEAPU8.set(new Uint8Array(files[1]), pointer);
			if (!engine._doom_init(pointer, files[1].byteLength)) throw new Error("Invalid game assets.");
			if (!window.crypto || !crypto.subtle) throw new Error("Use HTTPS or localhost for the director.");
			return Promise.all(files.map(function (file) { return crypto.subtle.digest("SHA-256", file); }));
		});
	}).then(function (hashes) {
		version = "3/" + hashes.map(function (hash) { return Array.from(new Uint8Array(hash)).map(function (n) { return ("0" + n.toString(16)).slice(-2); }).join(""); }).join("/");
		return crypto.subtle.importKey("raw", new TextEncoder().encode(outputKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
	}).then(function (key) {
		layoutKey = key;
		if (legacyOutput) throw new Error("This output URL needs updating. Copy a new OBS output URL from the director.");
		ready = true; document.getElementById("connect").disabled = false; hostControls(); notice("Enter a room to watch."); blank(message);
		if (params.get("room")) connect();
	}).catch(function (error) { notice(error.message); blank(message); });
}());
