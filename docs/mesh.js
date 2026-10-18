/* Signed game messages over VDO.Ninja's data-only room connections. */
(function () {
	"use strict";
	function encode(bytes) {
		var text = ""; new Uint8Array(bytes).forEach(function (b) { text += String.fromCharCode(b); });
		return btoa(text);
	}
	function decode(text) {
		var raw = atob(text), bytes = new Uint8Array(raw.length);
		for (var i = 0; i < raw.length; ++i) bytes[i] = raw.charCodeAt(i);
		return bytes;
	}
	// Each packet is self-contained: losing an earlier packet never loses a dictionary.
	function pack(data) {
		var packed, i, j;
		if (data.type === "input") {
			var events = data.events, runs = [], run;
			if (!Array.isArray(events) || !events.length || events.length > 64) return data;
			var last = events[events.length - 1];
			if (last.seq !== data.seq || last.buttons !== data.buttons || last.tap !== data.tap || last.weapon !== data.weapon) return data;
			for (i = 0; i < events.length; ++i) {
				var event = events[i];
				if (event.seq !== data.seq - events.length + 1 + i) return data;
				if (run && run[1] === event.buttons && run[2] === event.tap && run[3] === event.weapon) ++run[0];
				else { run = [1, event.buttons, event.tap, event.weapon]; runs.push(run); }
			}
			packed = [data.seq, runs];
		} else if (data.type === "append") {
			var rosters = [], rosterKeys = [], rows = [];
			for (i = 0; i < data.entries.length; ++i) {
				var entry = data.entries[i], key = entry.owners.join(","), roster = rosterKeys.indexOf(key);
				if (entry.seq !== data.prev + i) return data;
				if (roster < 0) { roster = rosters.length; rosterKeys.push(key); rosters.push(entry.owners); }
				var row = [roster, entry.hash, entry.term];
				for (j = 0; j < 4; ++j) {
					var slot = [entry.acks[j]];
					for (var n = 0; n < entry.inputs[j].length; ++n) slot.push(entry.inputs[j][n][0], entry.inputs[j][n][1]);
					row.push(slot);
				}
				if (entry.restart) row.push(entry.restart);
				rows.push(row);
			}
			packed = [data.prev, data.prevTerm, data.prevHash, data.commit, rosters, rows];
		} else if (data.type === "ack") packed = [data.next, data.hash, data.lastTerm, data.reject ? 1 : 0];
		else return data;
		return { type: data.type, id: data.id, term: data.term, packed: packed };
	}
	function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
	function unpack(data) {
		if (data.packed === undefined) return data;
		var p = data.packed, result = { type: data.type, id: data.id, term: data.term }, i, j;
		if (!Array.isArray(p)) throw Error("Invalid packed message");
		if (data.type === "input") {
			if (p.length !== 2 || !integer(p[0], 0, 0xfffffffd) || !Array.isArray(p[1]) || !p[1].length || p[1].length > 64) throw Error("Invalid inputs");
			var events = [], count = 0;
			for (i = 0; i < p[1].length; ++i) {
				var run = p[1][i];
				if (!Array.isArray(run) || run.length !== 4 || !integer(run[0], 1, 64) || !integer(run[1], 0, 0xffffffff) || !integer(run[2], 0, 0xffffffff) || !integer(run[3], -1, 7) || count + run[0] > 64) throw Error("Invalid input run");
				count += run[0];
			}
			if (count > p[0] + 1) throw Error("Invalid input sequence");
			for (i = 0; i < p[1].length; ++i) for (j = 0; j < p[1][i][0]; ++j)
				events.push({ seq: p[0] - count + 1 + events.length, buttons: p[1][i][1], tap: p[1][i][2], weapon: p[1][i][3] });
			var last = events[events.length - 1];
			result.seq = last.seq; result.buttons = last.buttons; result.tap = last.tap; result.weapon = last.weapon; result.events = events;
		} else if (data.type === "append") {
			if (p.length !== 6 || !integer(p[0], 0, 216000) || !integer(p[1], 0, 0x7fffffff) || !integer(p[2], 0, 0xffffffff) || !integer(p[3], 0, 216000) || !Array.isArray(p[4]) || p[4].length > 48 || !Array.isArray(p[5]) || p[5].length > 48 || p[0] + p[5].length > 216000) throw Error("Invalid history");
			var rosters = p[4], rows = p[5], entries = [];
			for (i = 0; i < rosters.length; ++i) if (!Array.isArray(rosters[i]) || rosters[i].length !== 4 || !rosters[i].every(function (id) { return typeof id === "string" && (!id || /^[a-f0-9]{64}$/.test(id)); })) throw Error("Invalid roster");
			for (i = 0; i < rows.length; ++i) {
				var row = rows[i];
				if (!Array.isArray(row) || row.length < 7 || row.length > 8 || !integer(row[0], 0, rosters.length - 1) || !integer(row[1], 0, 0xffffffff) || !integer(row[2], 1, 0x7fffffff)) throw Error("Invalid history row");
				var owners = rosters[row[0]].slice(), inputs = [], acks = [], mask = 0;
				for (j = 0; j < 4; ++j) {
					var slot = row[j + 3], commands = [];
					if (!Array.isArray(slot) || !slot.length || slot.length > 9 || slot.length % 2 !== 1 || !integer(slot[0], -1, 0xfffffffc)) throw Error("Invalid player commands");
					for (var n = 1; n < slot.length; n += 2) {
						if (!integer(slot[n], 0, 0xffffffff) || !integer(slot[n + 1], -1, 7)) throw Error("Invalid player command");
						commands.push([slot[n], slot[n + 1]]);
					}
					inputs.push(commands); acks.push(slot[0]); if (owners[j]) mask |= 1 << j;
				}
				var entry = { seq: p[0] + i, hash: row[1], term: row[2], owners: owners, mask: mask, inputs: inputs, acks: acks };
				if (row.length === 8) entry.restart = row[7];
				entries.push(entry);
			}
			result.prev = p[0]; result.prevTerm = p[1]; result.prevHash = p[2]; result.commit = p[3]; result.entries = entries;
		} else if (data.type === "ack") {
			if (p.length !== 4 || !integer(p[0], 0, 216000) || !integer(p[1], 0, 0xffffffff) || !integer(p[2], 0, 0x7fffffff) || !integer(p[3], 0, 1)) throw Error("Invalid acknowledgment");
			result.next = p[0]; result.hash = p[1]; result.lastTerm = p[2]; if (p[3]) result.reject = true;
		} else throw Error("Unknown packed message");
		return result;
	}
	window.createDoomMesh = function (options) {
		var frame, origin, closed = false, key, publicKey, identity, serial = 0;
		var routeSeen = {}, verified = {}, verifiedOrder = [];
		var routes = {}, keys = {}, seen = {}, recent = {}, repaired = {}, forwarded = {}, queued = 0;
		var signing = Promise.resolve(), delivering = Promise.resolve(), encoder = new TextEncoder();
		function post(envelope, target, relay) {
			if (frame && !closed) frame.contentWindow.postMessage({ sendData: { gridfall: envelope, relay: !!relay }, UUID: target || undefined }, origin);
		}
		function verify(envelope) {
			if (!envelope || typeof envelope.body !== "string" || envelope.body.length > 96000 || typeof envelope.key !== "string" || envelope.key.length !== 88 || typeof envelope.signature !== "string" || envelope.signature.length > 100) return Promise.reject(Error("Invalid message"));
			var cached = verified[envelope.signature];
			if (cached && cached.body === envelope.body && cached.key === envelope.key) return Promise.resolve(cached.message);
			var data;
			try { data = JSON.parse(envelope.body); } catch (e) { return Promise.reject(e); }
			if (data.v !== 3 || typeof data.from !== "string" || !/^[a-f0-9]{64}$/.test(data.from) || !Number.isSafeInteger(data.seq) || data.seq < 0 || typeof data.to !== "string" || data.to && !/^[a-f0-9]{64}$/.test(data.to) || !data.data || typeof data.data.type !== "string") return Promise.reject(Error("Invalid sender"));
			var entry = keys[data.from];
			if (entry && entry.raw !== envelope.key) return Promise.reject(Error("Changed identity"));
			var imported = entry ? Promise.resolve(entry.key) : crypto.subtle.digest("SHA-256", decode(envelope.key)).then(function (hash) {
				var id = Array.from(new Uint8Array(hash)).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
				if (id !== data.from) throw Error("Unknown identity");
				return crypto.subtle.importKey("raw", decode(envelope.key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
			}).then(function (importedKey) { if (Object.keys(keys).length >= 32) delete keys[Object.keys(keys)[0]];
				keys[data.from] = { raw: envelope.key, key: importedKey }; return importedKey; });
			return imported.then(function (importedKey) {
				return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, importedKey, decode(envelope.signature), encoder.encode(envelope.body));
			}).then(function (valid) { if (!valid) throw Error("Invalid signature");
				data.data = unpack(data.data);
				verified[envelope.signature] = { body: envelope.body, key: envelope.key, message: data }; verifiedOrder.push(envelope.signature);
				if (verifiedOrder.length > 512) delete verified[verifiedOrder.shift()];
				return data; });
		}
		function send(data, target) {
			if (closed) return Promise.resolve(null);
			var body = JSON.stringify({ v: 3, from: identity, seq: serial++, to: target || "", data: pack(data) });
			signing = signing.then(function () {
				return crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(body));
			}).then(function (signature) {
				var envelope = { body: body, key: publicKey, signature: encode(signature) };
				post(envelope, target && routes[target]);
				// A targeted retry can travel through another peer if its direct link is down.
				if (target) setTimeout(function () { if (Date.now() - (routeSeen[target] || 0) > 400) post(envelope, null, true); }, 220);
				return envelope;
			});
			return signing;
		}
		function receive(event) {
			if (closed || !frame || event.source !== frame.contentWindow || event.origin !== origin || !event.data || !event.data.dataReceived) return;
			var packet = event.data.dataReceived, envelope = packet.gridfall, uuid = event.data.UUID;
			if (!envelope || typeof uuid !== "string" || uuid.length > 200 || queued >= 128) return;
			++queued;
			// Verify concurrently; keep delivery ordered and bounded by the existing queue limit.
			var verification = Promise.resolve().then(function () { return verify(envelope); }).catch(function () { return null; });
			delivering = delivering.then(function () { return verification; }).then(function (message) {
				if (!message || closed || message.from === identity) return;
				
				if (message.to && message.to !== identity) {
					var relayKey = message.from + "/" + message.seq;
					if (packet.relay && routes[message.to] && !forwarded[relayKey]) {
						forwarded[relayKey] = true; if (Object.keys(forwarded).length > 256) delete forwarded[Object.keys(forwarded)[0]];
						post(envelope, routes[message.to], true);
					}
					return;
				}
				var record = seen[message.from] || (seen[message.from] = { max: -1, ids: {} });
				if (record.ids[message.seq] || message.seq < record.max - 512) return;
				if (!packet.relay && message.seq > record.max) { routes[message.from] = uuid; routeSeen[message.from] = Date.now(); }
				record.ids[message.seq] = true; record.max = Math.max(record.max, message.seq);
				Object.keys(record.ids).forEach(function (n) { if (+n < record.max - 512) delete record.ids[n]; });
				if (!message.to) {
					var cache = recent[message.from] || (recent[message.from] = []);
					cache.push(envelope); if (cache.length > 24) cache.shift();
				}
				if (message.data.type === "mesh-repair") {
					var source = message.data.source, now = Date.now();
					if (typeof source !== "string" || !/^[a-f0-9]{64}$/.test(source) || now - (repaired[message.from] || 0) < 250) return;
					repaired[message.from] = now;
					(recent[source] || []).slice(-12).forEach(function (saved) { post(saved, uuid, true); });
					return;
				}
				return options.receive(message.data, message.from, envelope);
			}).catch(function () { /* Ignore malformed or unauthenticated traffic. */ }).then(function () { --queued; });
		}
		return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]).then(function (pair) {
			key = pair.privateKey; return crypto.subtle.exportKey("raw", pair.publicKey);
		}).then(function (raw) { publicKey = encode(raw); return crypto.subtle.digest("SHA-256", raw); }).then(function (hash) {
			identity = Array.from(new Uint8Array(hash)).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
			return crypto.subtle.digest("SHA-256", encoder.encode(options.room));
		}).then(function (hash) {
			var room = "gridfall3" + Array.from(new Uint8Array(hash).slice(0, 16)).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
			var url = new URL(options.url); origin = url.origin;
			url.search = new URLSearchParams({ room: room, push: "gf" + identity.slice(0, 24), datamode: "", autostart: "", label: "GRIDFALL " + options.role }).toString(); url.hash = "";
			if (options.password) url.searchParams.set("password", options.password);
			else url.searchParams.set("nopassword", "");
			frame = document.createElement("iframe"); frame.hidden = true; frame.title = "GRIDFALL mesh data connections"; frame.referrerPolicy = "no-referrer";
			frame.src = url.href; document.body.appendChild(frame);
			window.addEventListener("message", receive);
			return { id: identity, send: send, verify: verify,
				repair: function (source) { return send({ type: "mesh-repair", source: source }); },
				close: function () { closed = true; window.removeEventListener("message", receive); if (frame) frame.remove(); },
				getState: function () { return { id: identity, peers: Object.keys(routes).length, queued: queued }; }
			};
		});
	};
}());
