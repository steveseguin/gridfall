/* Host-authoritative input replication with bounded reconnect and replay. */
(function () {
	"use strict";
	// Bump for each published release, including JavaScript-only changes.
	var release = "2026.10.16.6";
	var clockURL = new URL("net-clock.js?v=20261014-1", document.currentScript.src).href;
	window.createDoomSession = function (options) {
		var self = options.id, journal = createDoomLog(), peers = {}, match = null, currentConfig = null;
		var leader = options.host ? self : "", term = 1, version = release + "/" + options.version + "/commands1";
		var commit = 0, applied = 0, slot = options.host && !options.watch ? 0 : -1, phase = "lobby", stopped = false;
		var owners = options.host && !options.watch ? [self, "", "", ""] : ["", "", "", ""];
		var lastLeader = performance.now(), lastProgress = performance.now(), lastHello = 0, lastBeat = 0;
		var inputSeq = 0, localInputs = [], replaying = false, replayTimer, lastRepair = 0;
		var pendingInput = { buttons: 0, tap: 0, weapon: -1 };
		var departing = false, closePromise, pendingRestart, canHost = false;
		var lastNotice = "", incompatible = "", timers = [], stepMS = 1000 / 15;
		var clockWorker, lastStep = performance.now();
		var lastPing = 0, pingSeq = 0, inputAckMS = null, replayCount = 0;
		function stats() {
			var now = performance.now(), links = [];
			Object.keys(peers).forEach(function (id) {
				var p = peers[id], player = latestOwners().indexOf(id);
				if (id === self || p.departing || now - p.seen > 10000 || leader !== self && id !== leader) return;
				links.push({ player: player < 0 ? "Spectator" : "P" + (player + 1), host: id === leader,
					rttMS: p.rtt === undefined ? null : Math.round(p.rtt), jitterMS: p.jitter === undefined ? null : Math.round(p.jitter),
					sampleAgeMS: p.pongAt ? Math.round(now - p.pongAt) : null });
			});
			return { links: links, inputAckMS: inputAckMS, updateAgeMS: Math.round(now - lastProgress),
				pendingInputs: localInputs.length, oldestInputMS: localInputs.length ? Math.round(now - localInputs[0].at) : 0,
				behindTicks: journal.count() - applied, replays: replayCount, synchronizing: replaying };
		}
		function stopClock() {
			timers.forEach(clearInterval); timers = [];
			if (clockWorker) { clockWorker.terminate(); clockWorker = null; }
		}
		function send(data, to) { data.id = match ? match.id : ""; data.term = term; return options.send(data, to); }
		function ids(list) { return list.filter(Boolean); }
		function validOwners(list, empty) { return Array.isArray(list) && list.length === 4 && list.every(function (id, i) { return typeof id === "string" && (!id || /^[a-f0-9]{64}$/.test(id) && list.indexOf(id) === i); }) && (empty || ids(list).length > 0); }
		function maskOf(list) { var mask = 0; list.forEach(function (id, i) { if (id) mask |= 1 << i; }); return mask; }
		function latestOwners() { var last = journal.get(journal.count() - 1); return last ? last.owners : owners; }
		function hashAt(n) { var row = journal.get(n - 1); return row ? row.hash : 0; }
		function termAt(n) { var row = journal.get(n - 1); return row ? row.term : 0; }
		function notice(text) { if (text !== lastNotice) { lastNotice = text; if (options.notice) options.notice(text); } }
		function changed() { if (options.change) options.change(state()); }
		function fail(text) {
			if (stopped || phase === "fault") return;
			phase = "fault"; departing = true; replaying = false; localInputs = [];
			stopClock(); clearTimeout(replayTimer);
			send({ type: "depart" }).catch(function () {});
			notice(text); changed();
		}
		function waitForHost() {
			canHost = false;
			incompatible = "";
			clearTimeout(replayTimer); replaying = false; journal.clear(); commit = applied = 0;
			match = currentConfig = null; leader = ""; slot = -1; owners = ["", "", "", ""]; phase = "lobby";
			var own = peers[self]; peers = {}; peers[self] = own;
			lastLeader = lastProgress = performance.now();
			notice("Waiting for a host. This view will connect when a match starts."); changed();
		}
		function state() { return { phase: phase, release: release, host: leader === self, canHost: canHost, leader: leader, slot: slot, tick: applied, tip: journal.count(), commit: commit, term: term, mask: maskOf(latestOwners()), owners: owners.slice(), peers: Math.max(0, ids(owners).length - (slot >= 0 ? 1 : 0)), match: currentConfig || match, predicting: localInputs.length }; }
		function validConfig(c) { return c && typeof c.id === "string" && /^[a-f0-9]{24}$/.test(c.id) && c.version === version && validOwners(c.owners, c.spectatorHost === true) && (c.spectatorHost === undefined || typeof c.spectatorHost === "boolean") && Number.isInteger(c.map) && c.map >= 1 && c.map <= 24 && Number.isInteger(c.skill) && c.skill >= 0 && c.skill <= 4 && (c.mode === "coop" || c.mode === "deathmatch"); }
		function validInput(p) { return p && Number.isInteger(p.buttons) && p.buttons >= 0 && p.buttons <= 0xffffffff && Number.isInteger(p.tap) && p.tap >= 0 && p.tap <= 0xffffffff && Number.isInteger(p.weapon) && p.weapon >= -1 && p.weapon <= 7 && Number.isInteger(p.seq) && p.seq >= 0 && p.seq < 0xfffffffe; }
		function validEntry(p) {
			return p && Number.isInteger(p.seq) && p.seq >= 0 && p.seq < 216000 && Number.isInteger(p.term) && p.term >= 1 && p.term <= term && Number.isInteger(p.hash) && p.hash >= 0 && p.hash <= 0xffffffff && validOwners(p.owners, match && match.spectatorHost === true) && (!p.restart || validConfig(p.restart) && p.restart.owners.join(",") === p.owners.join(",")) && p.mask === maskOf(p.owners) && Array.isArray(p.inputs) && p.inputs.length === 4 && Array.isArray(p.acks) && p.acks.length === 4 && p.inputs.every(function (commands, i) {
				return Number.isInteger(p.acks[i]) && p.acks[i] >= -1 && p.acks[i] < 0xfffffffd && Array.isArray(commands) && commands.length <= 4 && commands.every(function (a) {
					return Array.isArray(a) && a.length === 2 && validInput({ buttons: a[0], tap: 0, weapon: a[1], seq: 0 });
				});
			});
		}
		function install(config) {
			inputAckMS = null; replayCount = 0;
			canHost = false;
			incompatible = "";
			clearTimeout(replayTimer); replaying = false; journal.clear(); commit = applied = 0;
			lastProgress = performance.now();
			lastStep = lastProgress;
			match = currentConfig = config; owners = config.owners.slice(); slot = owners.indexOf(self); inputSeq = 0; localInputs = [];
			pendingInput = { buttons: 0, tap: 0, weapon: -1 };
			Object.keys(peers).forEach(function (id) { peers[id].ack = 0; peers[id].next = 0; peers[id].ackedAt = 0; peers[id].catchupEnd = 0; peers[id].consumed = -1; peers[id].commands = []; peers[id].credit = 0; });
			phase = options.watch ? "running" : slot >= 0 ? "running" : "loading";
			try { options.start(config, Math.max(0, slot)); }
			catch (error) { fail("The game could not start. Rejoin or host a new room."); return; }
			changed();
		}
		function confirm(n) {
			n = Math.min(n, applied);
			if (phase === "fault") return;
			var progressed = n > commit;
			while (commit < n) { var row = journal.get(commit++); owners = row.owners.slice(); if (options.commit) options.commit(row); if (row.restart) changed(); }
			var mine = owners.indexOf(self);
			if (mine >= 0 && mine !== slot) { slot = mine; if (options.view) options.view(slot); }
			if (!options.watch && mine >= 0 && phase === "loading") { phase = "running"; changed(); }
			if (!options.watch && slot >= 0 && mine < 0) { fail("Your connection fell behind. Rejoin to catch up."); return; }
			if (progressed && phase === "running" && !replaying && journal.count() - commit < 4) notice("");
		}
		function apply(row, silent) {
			var found = row.owners.indexOf(self);
			if (found >= 0 && found !== slot) { slot = found; if (options.view) options.view(slot); }
			if (row.restart) { currentConfig = row.restart; options.start(row.restart, Math.max(0, slot), !!silent); }
			if ((options.step(row, silent) >>> 0) !== row.hash) throw Error("Game state differed; replaying confirmed inputs.");
			++applied; lastProgress = performance.now();
			if (slot >= 0) localInputs = localInputs.filter(function (p) {
				if (p.seq === row.acks[slot] && !silent) inputAckMS = Math.round(lastProgress - p.at);
				return p.seq > row.acks[slot];
			});
		}
		function replay() {
			if (replaying || !match || phase === "fault") return;
			++replayCount;
			replaying = true; applied = 0; currentConfig = match;
			try { options.start(match, Math.max(0, slot), true); }
			catch (error) { fail("The game could not synchronize. Rejoin to try again."); return; }
			notice("Synchronizing match…");
			function work() {
				if (stopped) return;
				var until = performance.now() + 7;
				try { while (applied < (options.watch ? commit : journal.count()) && performance.now() < until) apply(journal.get(applied), true); }
				catch (error) { fail("Replay differs from the room. Rejoin to try again."); return; }
				if (applied < (options.watch ? commit : journal.count())) replayTimer = setTimeout(work, 0);
				else { replaying = false; if (phase !== "fault") notice(""); changed(); acknowledge(); if (options.present) options.present(); }
			}
			work();
		}
		function acknowledge(through) { var n = options.watch ? journal.count() : applied; if (typeof through === "number") n = Math.min(n, through); if (match && leader && leader !== self) send({ type: "ack", next: n, hash: hashAt(n), lastTerm: termAt(n) }, leader); }
		function welcome(id) { send({ type: "welcome", config: match, leader: leader, owners: owners, tip: journal.count(), commit: commit }, id); }
		function replicate(id) {
			var peer = peers[id]; if (!peer || !match) return;
			var from = Math.max(0, Math.min(peer.next || 0, journal.count()));
			send({ type: "append", prev: from, prevTerm: termAt(from), prevHash: hashAt(from), entries: journal.read(from, from + 48), commit: commit }, id);
			peer.sent = performance.now();
			peer.catchupEnd = journal.count() - from >= 48 ? from + 48 : 0;
		}
		function receive(p, from, envelope) {
			if (stopped || phase === "fault" || !p || !Number.isInteger(p.term) || p.term < 1 || p.term > 0x7fffffff) return;
			var now = performance.now(), peer = peers[from];
			if (p.type === "build-mismatch" && !match && !options.host && typeof p.version === "string" && p.version !== version) {
				var other = p.version.match(/^(\d{4}\.\d{2}\.\d{2}\.\d{1,4})\//);
				incompatible = "Different game build. You: v" + release + "; host: " + (other ? "v" + other[1] : "older build") + ". ";
				if (other && other[1] === release) incompatible += "Game files differ. ";
				incompatible += "Reload all player and director pages.";
				// A compatible host may still answer in a room containing older hosts.
				canHost = false; notice(incompatible); changed(); return;
			}
			if (p.type === "hello") {
				if (["player", "watch"].indexOf(p.role) < 0) return;
				if (p.version !== version) { if (leader === self) send({ type: "build-mismatch", version: version }, from); return; }
				if (!peer) { Object.keys(peers).forEach(function (id) { if (id !== self && now - peers[id].seen > 10000 && owners.indexOf(id) < 0 && latestOwners().indexOf(id) < 0) delete peers[id]; }); if (Object.keys(peers).length >= 16) return; peer = peers[from] = { role: p.role, seen: now, next: 0, ack: 0, consumed: -1, commands: [], credit: 0 }; }
				peer.seen = now;
				if (leader === self && (!match || !peer.ackedAt || p.id !== match.id)) { welcome(from); if (match && peer.next < journal.count() && now - (peer.sent || 0) > 180) replicate(from); }
				return;
			}
			if (!peer) return;
			peer.seen = now;
			if (p.type === "welcome") {
				var spectatorHost = peer.role === "watch" && validConfig(p.config) && p.config.spectatorHost === true;
				if (peer.role !== "player" && !spectatorHost || p.leader !== from || !validOwners(p.owners, spectatorHost) || p.term !== 1) return;
				if (spectatorHost ? p.owners.indexOf(from) >= 0 : p.owners[0] !== from) return;
				if (!match) {
					if (options.host && leader === self) return;
					canHost = false; leader = from; term = Math.max(term, p.term); owners = p.owners.slice(); lastLeader = now;
					if (p.config && validConfig(p.config) && (spectatorHost || p.config.owners[0] === from)) install(p.config);
					if (match) send({ type: "ack", next: applied, hash: hashAt(applied), lastTerm: termAt(applied) }, leader);
					changed(); return;
				}
				if (from === leader && p.term === term) {
					lastLeader = now;
					if (p.config && p.config.id !== match.id) return;
					if (match) { if ((options.watch ? journal.count() : applied) < p.tip) send({ type: "ack", next: applied, hash: hashAt(applied), lastTerm: termAt(applied) }, leader); }
				}
				return;
			}
			if (!match && p.id === "" && (p.type === "leave-request" || p.type === "depart")) { peer.departing = true; peer.seen = 0; if (from === leader) waitForHost(); return; }
			if (!match || p.id !== match.id) return;
			if (p.type === "ping") {
				if (Number.isInteger(p.seq) && p.seq > 0 && p.seq < 0x7fffffff && now - (peer.pingReplyAt || 0) >= 1000) {
					peer.pingReplyAt = now; send({ type: "pong", seq: p.seq }, from);
				}
				return;
			}
			if (p.type === "pong") {
				if (p.seq === peer.pingSeq && peer.pingAt && now - peer.pingAt < 10000) {
					var rtt = now - peer.pingAt;
					peer.jitter = peer.rtt === undefined ? 0 : (peer.jitter || 0) * 0.75 + Math.abs(rtt - peer.rtt) * 0.25;
					peer.rtt = rtt; peer.pongAt = now; peer.pingAt = 0;
				}
				return;
			}
			if (p.type === "input") {
				var inputSlot = latestOwners().indexOf(from);
				if (leader !== self || inputSlot < 0 || peer.role !== "player" || !validInput(p) || !Array.isArray(p.events) || !p.events.length || p.events.length > 64) return;
				var used = peer.consumed;
				if (p.seq <= used || p.seq > used + 64 || !p.events.every(function (event, i) {
					return validInput(event) && event.seq === p.seq - p.events.length + 1 + i;
				})) return;
				// Retransmitted commands are immutable; duplicates cannot replace queued input.
				p.events.forEach(function (event) {
					if (event.seq > used && !peer.commands[event.seq - used - 1])
						peer.commands[event.seq - used - 1] = { seq: event.seq, buttons: (event.buttons & 0xfe600000) >>> 0, tap: (event.tap & 0xfe600000) >>> 0, weapon: event.weapon };
				});
				peer.inputAt = now; return;
			}
			if (p.type === "chat") {
				var sender = owners.indexOf(from);
				if (sender < 0 || typeof p.text !== "string" || now - (peer.chatAt || 0) < 500) return;
				var text = p.text.slice(0, 160).replace(/[\x00-\x1f\x7f]/g, " ").trim(); if (!text) return;
				peer.chatAt = now; if (options.chat) options.chat(sender, text); return;
			}
			if (p.type === "leave-request" || p.type === "depart") {
				peer.departing = true;
				if (from === leader) { if (options.watch) waitForHost(); else fail("The host left the match. Rejoin or host a new room."); }
				return;
			}
			if (p.type === "append") {
				if (phase === "fault" || from !== leader || p.term !== term || !Array.isArray(p.entries) || p.entries.length > 48 || !Number.isInteger(p.prev) || p.prev < 0 || !Number.isInteger(p.commit) || p.commit < 0) return;
				lastLeader = now;
				if (p.prev > journal.count() || termAt(p.prev) !== p.prevTerm || hashAt(p.prev) !== p.prevHash) { send({ type: "ack", next: Math.min(applied, p.prev), hash: hashAt(Math.min(applied, p.prev)), lastTerm: termAt(Math.min(applied, p.prev)), reject: true }, leader); return; }
				// Reject the whole batch before changing any replay history.
				for (var i = 0; i < p.entries.length; ++i) if (!validEntry(p.entries[i]) || p.entries[i].seq !== p.prev + i) return;
				var reset = false, before = applied;
				for (i = 0; i < p.entries.length; ++i) {
					var entry = p.entries[i];
					var old = journal.get(entry.seq);
					if (old && (old.term !== entry.term || old.hash !== entry.hash || old.owners.join(",") !== entry.owners.join(","))) {
						if (entry.seq < commit) { fail("Conflicting match history. Rejoin the room."); return; }
						journal.truncate(entry.seq); reset = true;
					}
					if (!journal.get(entry.seq)) journal.append(entry);
				}
				if (reset) replay();
				if (!replaying) {
					try { while (applied < (options.watch ? Math.min(p.commit, p.prev + p.entries.length, journal.count()) : journal.count())) apply(journal.get(applied), phase === "loading" || options.watch && applied < p.commit - 4); }
					catch (error) { notice(error.message); replay(); }
				}
				confirm(Math.min(p.commit, p.prev + p.entries.length)); acknowledge(p.prev + p.entries.length); if (applied !== before && options.present) options.present(); return;
			}
			if (p.type === "ack" && leader === self && p.term === term) {
				if (!p.reject && p.next < peer.ack) return;
				if (!Number.isInteger(p.next) || p.next < 0 || p.next > journal.count() || hashAt(p.next) !== p.hash || termAt(p.next) !== p.lastTerm) { if (now - (peer.sent || 0) > 100) { peer.next = Math.max(0, Math.min(peer.next - 1, journal.count())); replicate(from); } return; }
				var progressed = p.next > peer.ack;
				peer.next = p.next; peer.ack = p.next; peer.ackedAt = now;
				if (progressed) peer.progressAt = now;
				// A normal acknowledgment trails broadcasts by the round-trip delay.
				// Repair gaps or continue a full catch-up batch, without chasing every ack.
				if (peer.next < journal.count() && (p.reject && now - (peer.sent || 0) > 100 || progressed && peer.catchupEnd && p.next >= peer.catchupEnd)) replicate(from);
				return;
			}
			if (options.message) return options.message(p, from, peer.role);
		}
		function input(sampling) {
			if (!match || options.watch || departing || slot < 0 || phase !== "running") return;
			var value;
			try { value = options.input(); }
			catch (error) { fail("The game stopped unexpectedly. Rejoin or host a new room."); return; }
			pendingInput.buttons = value.buttons;
			pendingInput.tap = (pendingInput.tap | value.tap) >>> 0;
			if (value.weapon >= 0) pendingInput.weapon = value.weapon;
			if (!sampling) {
				if (options.present) options.present();
				else if (options.predict) predict();
			}
		}
		function sampleInput() {
			if (!match || options.watch || departing || slot < 0 || phase !== "running") return;
			input(true); if (phase === "fault") return;
			// Do not discard unacknowledged commands or create sequence gaps during an outage.
			if (localInputs.length < 64) {
				var value = { seq: inputSeq++, at: performance.now(), buttons: pendingInput.buttons, tap: pendingInput.tap, weapon: pendingInput.weapon };
				localInputs.push(value); pendingInput.tap = 0; pendingInput.weapon = -1;
				if (leader === self) { peers[self].commands.push(value); }
			}
			var latest = localInputs[localInputs.length - 1];
			if (latest && leader !== self) send({ type: "input", buttons: latest.buttons, tap: latest.tap, weapon: latest.weapon, seq: latest.seq,
				events: localInputs.map(function (p) { return { seq: p.seq, buttons: p.buttons, tap: p.tap, weapon: p.weapon }; }) }, leader);
		}
		function predict() {
			// Seal a due command before drawing; the worker can arrive after this frame.
			if (performance.now() - lastStep >= stepMS) pulse();
			if (!match || phase !== "running" || replaying || options.watch || performance.now() - lastProgress > 1200 && leader !== self || journal.count() - commit >= 8) return;
			// Replay the bounded input queue; delayed acknowledgments must not freeze an earlier pose.
			var frames = localInputs.map(function (p) { return [(p.buttons | p.tap) >>> 0, p.weapon]; });
			if (frames.length < 64) frames.push([(pendingInput.buttons | pendingInput.tap) >>> 0, pendingInput.weapon]);
			var rendered;
			try { rendered = options.predict(frames, maskOf(latestOwners()), localInputs.length >= 64 ? 1 : Math.min(1, Math.max(0, (performance.now() - lastStep) / stepMS))); }
			catch (error) { fail("The game stopped unexpectedly. Rejoin or host a new room."); return false; }
			return rendered;
		}
		function propose() {
			if (!match || leader !== self || replaying || departing || phase === "fault") return;
			if (journal.count() >= 216000) { fail("Match history is full. Host a new room."); return; }
			var list = latestOwners().slice(), now = performance.now();
			var changedMember = false;
			for (var i = options.watch ? 0 : 1; i < 4; ++i) {
				var member = peers[list[i]];
				if (list[i] && (!member || member.departing || now - member.seen > 4500 || now - (member.progressAt || 0) > 4500)) {
					if (member) member.departing = true;
					list[i] = ""; changedMember = true;
				}
			}
			if (!changedMember && list.indexOf("") >= 0) Object.keys(peers).some(function (id) {
				// Catch up before admission; guest acknowledgments never gate the host.
				var peer = peers[id]; if (id === self || peer.role !== "player" || peer.departing || list.indexOf(id) >= 0 || now - peer.seen > 2000 || !peer.ackedAt || now - peer.ackedAt > 2000 || peer.ack < journal.count() - 48) return false;
				list[list.indexOf("")] = id; peer.progressAt = now; changedMember = true; return true;
			});
			if (options.watch && !maskOf(list) && !changedMember && !pendingRestart) return;
			var inputs = [], acks = [];
			list.forEach(function (id) {
				var peer = peers[id], commands = [];
				if (peer) {
					// One command of simulation time per world tick; bank only short gaps.
					peer.credit = Math.min(24, (peer.credit || 0) + 1);
					while (peer.credit && peer.commands[0] && commands.length < 4) {
						var command = peer.commands.shift(); --peer.credit;
						commands.push([(command.buttons | command.tap) >>> 0, command.weapon]); peer.consumed = command.seq;
					}
				}
				inputs.push(commands); acks.push(peer ? peer.consumed : -1);
			});
			var n = journal.count(), row = { seq: n, term: term, owners: list, mask: maskOf(list), inputs: inputs, acks: acks };
			try {
				if (pendingRestart && !changedMember && list.join(",") === owners.join(",")) { row.restart = pendingRestart; row.restart.owners = list.slice(); pendingRestart = null; currentConfig = row.restart; options.start(row.restart, Math.max(0, slot)); }
				row.hash = options.step(row, false) >>> 0;
			}
			catch (error) { fail("The game stopped unexpectedly. Host a new room."); return; }
			journal.append(row); ++applied; lastProgress = now;
			confirm(journal.count());
			localInputs = localInputs.filter(function (p) {
				if (p.seq === row.acks[slot]) inputAckMS = Math.round(now - p.at);
				return p.seq > row.acks[slot];
			});
			// Overlap a few ticks only for lagging peers, so loss repairs on the next update.
			var from = n;
			Object.keys(peers).forEach(function (id) {
				var peer = peers[id];
				if (id === self || peer.departing || !peer.ackedAt || now - peer.seen > 2000) return;
				if (n - peer.ack > 1) from = Math.min(from, Math.max(0, n - 1));
				if (n - peer.ack > 4) from = Math.min(from, Math.max(0, n - 2));
			});
			send({ type: "append", prev: from, prevTerm: termAt(from), prevHash: hashAt(from), entries: journal.read(from, n + 1), commit: commit });
			lastBeat = now;
			if (options.present) options.present();
		}
		function tick() {
			if (stopped) return;
			var now = performance.now();
			if (now - lastHello > 700) { lastHello = now; send({ type: "hello", role: options.watch ? "watch" : "player", version: version }); }
			if (!match) {
				if (leader && leader !== self && now - lastLeader > 10000) waitForHost();
				if (!options.host && now - lastProgress > 12000) {
					if (incompatible) { if (options.watch) notice(incompatible); else fail(incompatible); }
					else if (!leader && !canHost) { canHost = true; notice("No host has responded. Would you like to host this room? You can also keep waiting."); changed(); }
				}
				return;
			}
			// Empty spectator-hosted rooms send heartbeats without advancing the world.
			if (now - lastPing >= 2000) {
				lastPing = now; ++pingSeq;
				Object.keys(peers).forEach(function (id) {
					var p = peers[id];
					if (id === self || p.departing || now - p.seen > 10000 || leader !== self && id !== leader) return;
					p.pingSeq = pingSeq; p.pingAt = now; send({ type: "ping", seq: pingSeq }, id);
				});
			}
			if (match.spectatorHost && !maskOf(owners) && now - lastLeader < 1200) lastProgress = now;
			if (leader !== self && now - lastProgress > 10000) { if (options.watch) waitForHost(); else fail("The host stopped responding. Rejoin or host a new room."); return; }
			if (!options.watch && phase === "loading" && ids(owners).length === 4) notice("Room full. Waiting for a player slot...");
			if (leader === self) {
				if (now - lastRepair > 350) {
					lastRepair = now;
					// Repair the oldest missing input first, within the mesh request rate limit.
					var missing = "";
					owners.forEach(function (id) {
						var peer = peers[id];
						if (id && id !== self && peer && !peer.departing && now - peer.seen < 2000 && now - (peer.inputAt || 0) > 250 && (!missing || (peer.inputAt || 0) < (peers[missing].inputAt || 0))) missing = id;
					});
					if (missing) options.repair(missing);
				}
				if (now - lastBeat >= 220) {
					lastBeat = now; send({ type: "append", prev: journal.count(), prevTerm: termAt(journal.count()), prevHash: hashAt(journal.count()), entries: [], commit: commit });
				}
				Object.keys(peers).forEach(function (id) { var p = peers[id]; if (id !== self && !p.departing && now - p.seen < 8000 && p.next < journal.count() && now - (p.progressAt || 0) > 250 && now - (p.sent || 0) > 250) replicate(id); });
			} else if (now - lastProgress > 1500) notice("Connection interrupted. Trying to reconnect...");
			if (leader && leader !== self && now - lastLeader > 250 && now - lastRepair > 350) { lastRepair = now; options.repair(leader); acknowledge(); }
		}
		peers[self] = { role: options.watch ? "watch" : "player", seen: performance.now(), consumed: -1, commands: [], credit: 0, inputAt: 0 };
		function pulse() {
			if (stopped || phase === "fault") return;
			tick();
			var now = performance.now();
			// Recover a short scheduling delay without replaying seconds of stale input.
			if (now - lastStep > stepMS * 4) lastStep = now - stepMS;
			while (now - lastStep >= stepMS) { lastStep += stepMS; sampleInput(); propose(); }
		}
		function fallbackClock() {
			stopClock();
			if (!stopped && phase !== "fault") timers.push(setInterval(pulse, 16));
		}
		try {
			clockWorker = new Worker(clockURL);
			clockWorker.onmessage = function () { pulse(); if (clockWorker) clockWorker.postMessage(0); };
			clockWorker.onerror = fallbackClock;
		} catch (error) { fallbackClock(); }
		return { receive: receive, getState: state, getStats: stats, sendInput: input, predict: predict, journal: journal, resync: replay,
			start: function (map, skill, mode) {
				if (canHost && !leader && !match && !stopped) {
					options.host = true; leader = self; canHost = false; slot = options.watch ? -1 : 0;
					owners = options.watch ? ["", "", "", ""] : [self, "", "", ""];
				}
				if (leader !== self || departing || phase === "fault") return;
				var random = new Uint8Array(12); crypto.getRandomValues(random);
				var config = { id: Array.from(random).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""), version: version, map: map, skill: skill, mode: mode, count: 4, owners: owners.slice() };
				if (options.watch) config.spectatorHost = true;
				if (match) { pendingRestart = config; return; }
				install(config); Object.keys(peers).forEach(function (id) { if (id !== self) welcome(id); });
			},
			sendChat: function (text) { text = typeof text === "string" ? text.slice(0, 160).replace(/[\x00-\x1f\x7f]/g, " ").trim() : ""; var own = peers[self]; if (!text || phase !== "running" || slot < 0 || performance.now() - (own.chatAt || 0) < 500) return false; own.chatAt = performance.now(); send({ type: "chat", text: text }); if (options.chat) options.chat(slot, text); return true; },
			send: send,
			close: function () {
				if (closePromise) return closePromise;
				departing = true; stopped = true; stopClock(); clearTimeout(replayTimer);
				closePromise = new Promise(function (resolve) {
					// Cleanup must finish even if signing or the transport has stopped.
					var timeout = setTimeout(resolve, 250);
					send({ type: "depart" }).then(function () { clearTimeout(timeout); resolve(); }, function () { clearTimeout(timeout); resolve(); });
				});
				return closePromise;
			},
			peerRole: function (id) { return peers[id] && peers[id].role; }
		};
	};
	window.createDoomSession.release = release;
}());
