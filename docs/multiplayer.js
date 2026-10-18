/* Player controls and lobby for the shared mesh simulation. */
(function () {
	"use strict";
	var game = window.doomGame, mesh, session, previousPhase = "offline", connecting = false, closingRoom = false, pendingLeave = null, generation = 0, lastMask = 0;
	var status = document.getElementById("room-status"), roster = document.getElementById("roster");
	var rejoin = null;
	try {
		if (window.doomRoomSettings.isReload()) rejoin = JSON.parse(sessionStorage.getItem("gridfall-rejoin"));
		sessionStorage.removeItem("gridfall-rejoin");
	} catch (error) {}
	function randomID() { var bytes = new Uint8Array(12); crypto.getRandomValues(bytes); return Array.from(bytes).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
	function state() { return session ? session.getState() : { phase: connecting || closingRoom ? "loading" : "offline", host: false, slot: 0, tick: 0, tip: 0, commit: 0, peers: 0, mask: 0, match: null }; }
	function stats() {
		var s = state(), result = session ? session.getStats() : { links: [] };
		result.release = createDoomSession.release; result.phase = s.phase; result.host = s.host; result.player = s.slot + 1;
		result.mode = s.match ? s.match.mode : null; result.tick = s.tick; result.players = (s.owners || []).filter(Boolean).length;
		result.fps = game.getDisplayFPS(); result.hidden = document.hidden; result.verificationQueue = mesh ? mesh.getState().queued : 0;
		return result;
	}
	function saveStats() {
		var report = stats(); report.capturedAt = new Date().toISOString(); report.browser = navigator.userAgent;
		var url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })), link = document.createElement("a");
		link.href = url; link.download = "gridfall-connection.json"; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
	}
	function update() {
		var s = state(), online = s.phase !== "offline";
		if (s.phase === "lobby" && !s.host && s.leader) status.textContent = "Connected. Waiting for the host to start the match.";
		if (s.phase === "loading" && s.match && previousPhase === "lobby") status.textContent = "Synchronizing the match. You will enter automatically.";
		document.getElementById("host").disabled = document.getElementById("join").disabled = online || !game.ready;
		document.getElementById("leave").disabled = !online;
		document.getElementById("start").disabled = online || !game.ready;
		document.getElementById("begin").disabled = !s.host || s.phase === "loading" || s.phase === "fault";
		document.getElementById("begin").textContent = s.match ? "Restart match" : "Start match";
		var colors = ["green", "blue", "red", "amber"];
		roster.textContent = (s.owners || []).map(function (id, i) { return id ? "P" + (i + 1) + " / " + colors[i] + (i === s.slot ? ": you" : "") + (id === s.leader ? " (host)" : "") : ""; }).filter(Boolean).join(" · ");
		window.dispatchEvent(new Event("doom-room-change"));
	}
	function present() {
		if (!session) return;
		var s = state(), gameState = game.getState(), names = [];
		for (var i = 0; i < 4; ++i) if (s.mask & (1 << i)) names.push("P" + (i + 1) + ": " + gameState[31 + i]);
		var scores = document.getElementById("scores"), text = gameState[30] ? names.join("   ") : "Co-op · " + names.length + " players · Map " + gameState[0];
		if (scores.textContent !== text) scores.textContent = text;
		if (!session.predict()) game.presentNetwork();
	}
	function setup(id, send, verify, repair, host) {
		session = createDoomSession({ id: id, host: host, version: game.version, send: send, verify: verify, repair: repair,
			input: game.readInput, view: game.setNetworkView, predict: game.predictNetwork, chat: game.showChat,
			start: function (config, slot, replay) { if (!replay) lastMask = 0; game.startNetwork(config, slot, replay); if (!replay && state().phase === "running") game.focus(true); },
			step: function (row, silent) { game.stepNetwork(row.inputs, row.mask, silent); return game.checksum(); },
			commit: function (row) {
				var showChanges = state().phase === "running";
				for (var i = 0; i < 4; ++i) {
					if (!showChanges || row.owners[i] === id) continue;
					if ((lastMask ^ row.mask) & (1 << i)) game.showChat(-1, "P" + (i + 1) + (row.mask & (1 << i) ? " joined the game" : " left the game"));
				}
				if (lastMask !== row.mask) { lastMask = row.mask; update(); }
			},
			notice: function (text) { status.textContent = text || "Connected. Match in progress."; if (text) game.showChat(-1, text); },
			change: function (s) {
				if (!session) return;
				if (s.phase === "fault" && previousPhase !== "fault") game.stopNetwork();
				if (s.phase === "running" && previousPhase !== "running") status.textContent = "Connected. Match in progress.";
				update(); if (s.phase === "running" && previousPhase !== "running") game.focus(true); previousPhase = s.phase;
			}, present: game.requestNetworkFrame
		});
		connecting = false; update(); status.textContent = host ? "Start whenever you like. Players can join during the match." : "Connecting to the room…";
	}
	function leave(event) {
		try {
			if (event && event.type === "pagehide" && rejoin && !state().host) sessionStorage.setItem("gridfall-rejoin", JSON.stringify(rejoin));
			else sessionStorage.removeItem("gridfall-rejoin");
		} catch (error) {}
		rejoin = null;
		if (pendingLeave) return pendingLeave;
		++generation; connecting = false; closingRoom = true;
		var oldMesh = mesh; mesh = null;
		var closing = session ? session.close() : Promise.resolve();
		session = null; previousPhase = "offline";
		pendingLeave = closing.then(function () { game.stopNetwork(); closingRoom = false; pendingLeave = null; status.textContent = "Disconnected."; update(); if (oldMesh) setTimeout(function () { oldMesh.close(); }, 300); });
		lastMask = 0; document.getElementById("invite-label").hidden = true; document.getElementById("scores").textContent = "";
		status.textContent = "Leaving room..."; update(); return pendingLeave;
	}
	function connect(host) {
		if (!game.ready || connecting || closingRoom || session) return;
		if (!window.crypto || !crypto.subtle) { status.textContent = "Use HTTPS or localhost to host or join a room."; return; }
		if (!game.version) return;
		var room = document.getElementById("room").value.trim(), password = document.getElementById("room-password").value, url;
		if (!room && !host) { status.textContent = "Enter the room name or open an invite link."; return; }
		if (!room) room = "doom" + randomID();
		try { url = new URL(document.getElementById("ninja-url").value); if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))) throw Error("Use HTTPS or a localhost VDO.Ninja URL."); }
		catch (error) { status.textContent = error.message; return; }
		rejoin = host ? null : { path: location.pathname, room: room, ninja: document.getElementById("ninja-url").value };
		connecting = true; var attempt = ++generation;
		status.textContent = host ? "Creating room..." : "Connecting to the host...";
		update();
		document.getElementById("room").value = room; document.getElementById("room-password").value = password;
		window.doomRoomSettings.save();
		var params = new URLSearchParams({ room: room });
		if (password) params.set("password", password);
		var ninjaURL = url.origin + url.pathname;
		if (ninjaURL !== "https://vdo.ninja/") params.set("ninja", ninjaURL);
		var invite = new URL(location.href); invite.hash = params.toString();
		document.getElementById("invite").value = invite.href; document.getElementById("invite-label").hidden = false;
		var connectionSession;
		createDoomMesh({ room: room, password: password, url: url.href, role: "player", receive: function (p, from, envelope) { if (connectionSession) return connectionSession.receive(p, from, envelope); } }).then(function (connection) {
			if (attempt !== generation) { connection.close(); return; }
			mesh = connection; setup(mesh.id, mesh.send, mesh.verify, mesh.repair, host); connectionSession = session;
			if (host) document.getElementById("begin").onclick();
		}).catch(function (error) { if (attempt !== generation) return; connecting = false; status.textContent = "Connection failed: " + error.message; update(); });
	}
	window.doomRoom = { getState: state, getStats: stats, saveStats: saveStats, leave: leave, present: present,
		hostRoom: function () { if (session && state().canHost) { rejoin = null; document.getElementById("begin").onclick(); document.getElementById("invite-label").hidden = false; } },
		sendInput: function () { if (session) session.sendInput(); },
		sendChat: function (text) { return session ? session.sendChat(text) : false; },
		receive: function (payload, from, envelope) { if (session) return session.receive(payload, from, envelope); },
		attachTransport: function (host, transport) { return leave().then(function () { setup(transport.id, transport.send, transport.verify, transport.repair, host); }); }
	};
	document.getElementById("host").onclick = function () { connect(true); };
	document.getElementById("join").onclick = function () { connect(false); };
	document.getElementById("leave").onclick = leave;
	document.getElementById("begin").onclick = function () { if (session) session.start(Number(document.getElementById("level").value), Number(document.getElementById("skill").value), document.getElementById("mode").value); };
	document.getElementById("invite").onclick = function () { this.select(); };
	function rejoinAfterReload() {
		if (!game.ready || !rejoin) return;
		var saved = rejoin; rejoin = null;
		if (saved.path === location.pathname && saved.room === document.getElementById("room").value.trim() && saved.ninja === document.getElementById("ninja-url").value) connect(false);
	}
	window.addEventListener("doom-ready", rejoinAfterReload);
	rejoinAfterReload();
	window.addEventListener("pagehide", leave);
}());
