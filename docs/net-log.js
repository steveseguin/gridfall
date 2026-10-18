/* Compact, bounded input journal shared by players and spectators. */
(function () {
	"use strict";
	window.createDoomLog = function () {
		var chunks = [], restarts = [], rosters = [], rosterKeys = {}, count = 0, limit = 216000;
		return {
			count: function () { return count; },
			clear: function () { chunks = []; restarts = []; rosters = []; rosterKeys = {}; count = 0; },
			truncate: function (n) { count = Math.max(0, Math.min(n, count)); chunks.length = Math.ceil(count / 128); restarts.length = Math.min(restarts.length, count); },
			append: function (entry) {
				if (entry.seq !== count || count >= limit) throw Error("Replay limit reached. Start a new match.");
				var key = entry.owners.join(","), roster = rosterKeys[key];
				if (roster === undefined) { roster = rosters.length; rosterKeys[key] = roster; rosters.push(entry.owners.slice()); }
				var part = Math.floor(count / 128), offset = count % 128 * 44;
				if (!chunks[part]) chunks[part] = new Uint32Array(128 * 44);
				var data = chunks[part];
				for (var i = 0; i < 4; ++i) {
					var at = offset + i * 10, commands = entry.inputs[i];
					data[at] = commands.length; data[at + 1] = entry.acks[i] + 1;
					for (var n = 0; n < commands.length; ++n) { data[at + 2 + n * 2] = commands[n][0]; data[at + 3 + n * 2] = commands[n][1] + 1; }
				}
				data[offset + 40] = entry.hash; data[offset + 41] = entry.mask; data[offset + 42] = entry.term; data[offset + 43] = roster;
				if (entry.restart) restarts[count] = entry.restart;
				++count;
			},
			get: function (n) {
				if (!Number.isInteger(n) || n < 0 || n >= count) return null;
				var data = chunks[Math.floor(n / 128)], offset = n % 128 * 44, inputs = [], acks = [];
				for (var i = 0; i < 4; ++i) {
					var at = offset + i * 10, commands = [];
					for (var j = 0; j < data[at]; ++j) commands.push([data[at + 2 + j * 2], data[at + 3 + j * 2] - 1]);
					inputs.push(commands); acks.push(data[at + 1] - 1);
				}
				return { seq: n, restart: restarts[n], inputs: inputs, acks: acks, hash: data[offset + 40], mask: data[offset + 41], term: data[offset + 42], owners: rosters[data[offset + 43]].slice() };
			},
			read: function (from, end) { var rows = []; for (var i = from; i < Math.min(count, end); ++i) rows.push(this.get(i)); return rows; }
		};
	};
}());
