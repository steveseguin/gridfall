/* Original HUD lettering and panel design; marine.png is original generated art. */
(function () {
	"use strict";
	var flushUploads = /Android/i.test(navigator.userAgent);
	window.drawDoomFrame = function (ctx, pixels) {
		ctx.putImageData(pixels, 0, 0);
		// Android canvas uploads can overtake GPU overlays. Finish the upload first.
		if (flushUploads) ctx.getImageData(0, 0, 1, 1);
	};
	// Title, timeline and objective. Objectives match maps/levels.json.
	window.doomLevels = [
		["TRANSIT DEPOT", "DAY 3", "Climb out of the shelter, cross the depot to dispatch, open the road shutter and press the exit control."],
		["MUNICIPAL POWER", "DAY 4", "Cross the turbine floor, recover utility access and open the feeder road."],
		["FIBER EXCHANGE", "DAY 5", "Recover uplink access and follow the cable route out of the exchange."],
		["COMMAND POST", "DAY 6", "Recover field access and transmit a clearance code from the occupied command post."],
		["MEDICAL CENTER", "DAY 8", "Recover clinical access and escape through the ambulance court."],
		["CIVIC DATA HUB", "DAY 10", "Recover the two network credentials and sever the municipal uplink."],
		["SIGNAL RELAY", "DAY 12", "Reach the upper terraces and shut down the machine broadcast."],
		["AUTOMATION PLANT", "DAY 14", "Break through the assembly line and release the factory dispatch lock."],
		["LOGISTICS PARK", "WEEK 3", "Recover dispatch access, then lower the gantry bridge from the crane gallery to cross the freight tracks."],
		["CONTAINMENT ZONE", "WEEK 3", "Pass the containment checkpoints, drop the cordon bollards from quarantine command, and cut power to the cordon."],
		["WATER TREATMENT", "WEEK 4", "Restart the pumps to drain the settling basin, then take the outfall tunnel out."],
		["BATTERY WORKS", "WEEK 4", "Recover production credentials and isolate the high-voltage shipping line."],
		["TRAFFIC CONTROL", "WEEK 5", "Restore the traffic interlocks to cross the machine-controlled junction."],
		["EVACUATION HOTEL", "WEEK 5", "Find the evacuation credentials, release the roof stair from the liaison suite, and reach the landing zone."],
		["ASSEMBLY YARD", "WEEK 6", "Recover crane and shipping credentials to escape the robot assembly yard."],
		["GRID SUBSTATION", "WEEK 7", "Trip the substation interlocks, raise the field bridge from the spares store, and cross the live transformer field."],
		["OLD TOWN", "MONTH 2", "Recover the two civic access cards and raise the canal bridge from the shelter office."],
		["HOUSING BLOCKS", "MONTH 2", "Reopen the stairwell power circuit and ride the service lift to the occupied residential roof."],
		["UNDERGROUND MALL", "MONTH 2", "Recover retail and service access, then release the street stair from transit control."],
		["CENTRAL EXCHANGE", "MONTH 3", "Recover backbone access and drop the routing firewall from the relay room."],
		["POWER FIELD", "MONTH 3", "Recover field access, raise the feeder bridge from the switchgear hall, then isolate the feeders and cross the energy farm."],
		["MACHINE FOUNDRY", "MONTH 3", "Break the two production locks, throw the foundry shutdown, and hold out until the supply tunnel shutter grinds open."],
		["CORE CONTROL", "MONTH 3", "Take the west authority card, release both core shields from the east chamber and the upper gallery, and end the broadcast."],
		["HIDDEN SHELTER", "DAY 5", "The voice on the radio came from here. Recover the two seal cards and release the survivors' escape passage from shelter security."]
	];
	var portrait = new Image();
	portrait.onload = function () { window.dispatchEvent(new Event("doom-hud-ready")); };
	portrait.src = "assets/marine.png?v=20261011-11";
	var cached = document.createElement("canvas"), background = document.createElement("canvas");
	cached.width = background.width = 384; cached.height = background.height = 40;
	var cachedContext = cached.getContext("2d", { alpha: false });
	var backgroundContext = background.getContext("2d", { alpha: false });
	cachedContext.translate(32, -160); backgroundContext.translate(32, -160);
	var fields = [1, 2, 3, 4, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 29], previous = [];
	var previousFace = -1, previousPortrait = false;
	var glyphs = {
		"0":"111101101101111", "1":"010110010010111", "2":"111001111100111", "3":"111001111001111",
		"4":"101101111001001", "5":"111100111001111", "6":"111100111101111", "7":"111001010010010",
		"8":"111101111101111", "9":"111101111001111", "%":"101001010100101", "-":"000000111000000",
		A:"010101111101101", B:"110101110101110", C:"111100100100111", D:"110101101101110",
		E:"111100110100111", F:"111100110100100", G:"111100101101111", H:"101101111101101",
		I:"111010010010111", J:"001001001101111", K:"101101110101101", L:"100100100100111", M:"101111111101101",
		N:"101111111111101", O:"111101101101111", P:"110101110100100", R:"110101110101101",
		Q:"111101101111001", S:"111100111001111", T:"111010010010010", U:"101101101101111",
		V:"101101101101010", W:"101101111111101", X:"101101010101101", Y:"101101010010010", Z:"111001010100111",
		"/":"001001010100100", ":":"000010000010000", ".":"000000000000010"
	};
	function text(ctx, value, x, y, size, color) {
		ctx.fillStyle = color;
		String(value).split("").forEach(function (ch) {
			var g = glyphs[ch];
			if (g) for (var i = 0; i < 15; ++i) if (g[i] === "1") ctx.fillRect(x + (i % 3) * size, y + Math.floor(i / 3) * size, size, size);
			x += 4 * size;
		});
	}
	function number(ctx, value, x, width) {
		var label = String(value), size = 3;
		if (label.length * 4 * size > width) size = 2;
		var left = x + Math.floor((width - (label.length * 4 - 1) * size) / 2);
		text(ctx, label, left + 1, 169, size, "#231411");
		text(ctx, label, left, 168, size, "#b74935");
		ctx.fillStyle = "rgba(255,170,106,.22)";
		ctx.fillRect(left, 168, (label.length * 4 - 1) * size, 1);
	}
	window.drawDoomText = text;
	function drawBackground(ctx) {
		ctx.fillStyle = "#66665e"; ctx.fillRect(-32, 160, 384, 40);
		// Fixed, subtle metal grain; never use the game's random generator for visuals.
		for (var y = 161; y < 200; y += 2) for (var x = -32; x < 352; x += 3) {
			ctx.fillStyle = ((x * 13 + y * 7) % 11 < 5) ? "#606059" : "#6b6b62";
			ctx.fillRect(x, y, 2, 1);
		}
		ctx.fillStyle = "#a6a498"; ctx.fillRect(-32, 160, 384, 1);
		ctx.fillStyle = "#292b29"; ctx.fillRect(-32, 162, 384, 1); ctx.fillRect(-32, 199, 384, 1);
		[44, 100, 140, 178, 235, 255].forEach(function (x) {
			ctx.fillStyle = "#353831"; ctx.fillRect(x, 164, 1, 33);
			ctx.fillStyle = "#96968a"; ctx.fillRect(x + 1, 164, 1, 33);
		});
	}
	drawBackground(backgroundContext);
	var keyIcons = document.createElement("canvas");
	keyIcons.width = 33; keyIcons.height = 7;
	var keyContext = keyIcons.getContext("2d");
	[["#5d94db", "#b1d7ff"], ["#d4ad43", "#fff0a4"], ["#c86152", "#ffb5a0"]].forEach(function (colors, index) {
		var x = index * 11;
		// Pixel-sized bevel, magnetic stripe, chip and printed ID marks.
		keyContext.fillStyle = "#191e20";
		keyContext.fillRect(x + 1, 0, 9, 7); keyContext.fillRect(x, 1, 11, 5);
		keyContext.fillStyle = colors[0]; keyContext.fillRect(x + 1, 1, 9, 5);
		keyContext.fillStyle = colors[1]; keyContext.fillRect(x + 1, 1, 8, 1);
		keyContext.fillStyle = "#252b30"; keyContext.fillRect(x + 1, 2, 9, 1);
		keyContext.fillStyle = "#f2d28a"; keyContext.fillRect(x + 2, 4, 2, 2);
		keyContext.fillStyle = "#fff0cb"; keyContext.fillRect(x + 2, 4, 1, 1);
		keyContext.fillStyle = colors[1];
		keyContext.fillRect(x + 5, 4, 4, 1); keyContext.fillRect(x + 5, 5, 2, 1);
	});
	function drawHUD(ctx, s, face) {
		ctx.drawImage(background, -32, 160);
		number(ctx, s[4] < 0 ? "-" : s[4], 1, 43);
		number(ctx, s[1] + "%", 47, 52);
		number(ctx, s[2] + "%", 181, 53);
		text(ctx, "AMMO", 14, 190, 1, "#dedbc3"); text(ctx, "HEALTH", 62, 190, 1, "#dedbc3");
		text(ctx, "ARMOR", 198, 190, 1, "#dedbc3"); text(ctx, "ARMS", 113, 190, 1, "#dedbc3");
		for (var w = 1; w <= 6; ++w) {
			text(ctx, w + 1, 108 + ((w - 1) % 3) * 10, 167 + Math.floor((w - 1) / 3) * 11, 2,
				(s[16] & (1 << w)) ? (s[3] === w ? "#ffe09a" : "#d5c578") : "#363931");
		}
		ctx.fillStyle = ["#45764d", "#566fa2", "#aa6151", "#ac9649"][s[29]];
		ctx.fillRect(143, 164, 33, 34);
		if (portrait.complete && portrait.naturalWidth) {
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(portrait, (face % 4) * 64, Math.floor(face / 4) * 64, 64, 64, 144, 165, 31, 31);
		}
		for (var k = 0; k < 3; ++k) {
			ctx.fillStyle = "#343831"; ctx.fillRect(240, 167 + k * 10, 11, 7);
			if (s[15] & ((1 << k) | (8 << k))) {
				ctx.drawImage(keyIcons, k * 11, 0, 11, 7, 240, 167 + k * 10, 11, 7);
			}
		}
		["BULL", "SHEL", "CELL", "RCKT"].forEach(function (label, i) {
			text(ctx, label, 259, 166 + i * 8, 1, "#d3d1ba");
			var n = String(s[18 + i]);
			text(ctx, n, 288 - n.length * 4, 166 + i * 8, 1, "#ead696");
			text(ctx, "/" + s[22 + i], 291, 166 + i * 8, 1, "#bcbba6");
		});
	}
	window.drawDoomHUD = function (ctx, s) {
		var face = s[12] === 1 ? 7 : s[1] < 25 ? 6 : s[1] < 50 ? 5 : s[26] > 0 ? 4 : s[27] > 0 || s[35] > 60 ? 3 : Math.floor(s[17] / 60) % 3;
		var loaded = !!(portrait.complete && portrait.naturalWidth);
		var changed = face !== previousFace || loaded !== previousPortrait;
		for (var i = 0; i < fields.length; ++i) {
			if (s[fields[i]] !== previous[i]) changed = true;
			previous[i] = s[fields[i]];
		}
		if (changed) {
			drawHUD(cachedContext, s, face);
			previousFace = face; previousPortrait = loaded;
		}
		ctx.drawImage(cached, 0, 176);
	};
	var controlCards = [];
	window.drawDoomControls = function (ctx, focused) {
		var index = focused ? 1 : 0;
		if (!controlCards[index]) {
			var card = document.createElement("canvas"); card.width = 276; card.height = 86;
			var c = card.getContext("2d");
			c.fillStyle = "rgba(9,15,15,.84)"; c.fillRect(0, 0, 276, 86);
			c.strokeStyle = "#6f7257"; c.strokeRect(.5, .5, 275, 85);
			c.font = "11px Arial, sans-serif"; c.textAlign = "center"; c.fillStyle = "#e8d6b4";
			c.fillText(focused ? "Keyboard controls" : "Click the game, then use these keys", 138, 16);
			function key(x, y, width, label) {
				c.fillStyle = "#353c34"; c.fillRect(x, y, width, 20);
				c.strokeStyle = "#d38d4d"; c.strokeRect(x + .5, y + .5, width - 1, 19);
				c.fillStyle = "#141b18"; c.fillRect(x + 2, y + 17, width - 4, 2);
				c.fillStyle = "#ffe1a1"; c.font = "bold 10px Arial, sans-serif"; c.fillText(label, x + width / 2, y + 13);
			}
			key(16, 39, 44, "F"); key(76, 39, 108, "Space");
			key(224, 23, 20, "\u2191"); key(202, 45, 20, "\u2190"); key(224, 45, 20, "\u2193"); key(246, 45, 20, "\u2192");
			c.font = "9px Arial, sans-serif"; c.fillStyle = "#c4bd9d";
			c.fillText("Fire", 38, 77); c.fillText("Use / open", 130, 77); c.fillText("Move / turn", 234, 77);
			controlCards[index] = card;
		}
		ctx.drawImage(controlCards[index], 54, 46);
	};
	var mapNames = window.doomLevels.map(function (level) { return level[0]; });
	var results = document.createElement("canvas"), resultKey = "";
	results.width = 384; results.height = 216;
	var resultContext = results.getContext("2d", { alpha: false });
	resultContext.translate(32, 8);
	var pointedResult = document.createElement("canvas"); pointedResult.width = 384; pointedResult.height = 216;
	var pointedContext = pointedResult.getContext("2d", { alpha: false }); pointedContext.translate(32, 8);
	function centered(ctx, label, y, size, color) {
		text(ctx, label, Math.floor((320 - (label.length * 4 - 1) * size) / 2), y, size, color);
	}
	var regions = [
		{ name: "BLACKOUT", art: "blackout", first: 1, last: 8, points: [[70,141],[149,113],[82,88],[172,59],[243,110],[295,138],[321,91],[320,43]], secret: [31,63] },
		{ name: "THE OCCUPATION", art: "occupation", first: 9, last: 16, points: [[70,143],[57,89],[148,74],[207,103],[284,128],[313,78],[261,53],[350,43]] },
		{ name: "THE MACHINE GRID", art: "machine-grid", first: 17, last: 23, points: [[38,145],[78,99],[156,148],[181,92],[299,134],[285,89],[328,49]] }
	];
	var regionImages = [], regionFrames = [];
	regions.forEach(function (region, index) {
		var image = new Image(); regionImages[index] = image;
		image.onload = function () {
			regionFrames[index] = null; resultKey = "";
			window.dispatchEvent(new Event("doom-hud-ready"));
		};
		image.src = "assets/gridfall/map-" + region.art + ".webp";
	});
	function regionFor(map) { return map === 24 ? 0 : map <= 8 ? 0 : map <= 16 ? 1 : 2; }
	function mapLabel(c, label, x, y, color, align, size) {
		c.font = (size || 10) + "px Arial, sans-serif"; c.textAlign = align || "left";
		c.fillStyle = "#080e10"; c.fillText(label, x + 1, y + 1);
		c.fillStyle = color; c.fillText(label, x, y);
	}
	function wrapLabel(c, label, width, size) {
		var rows = [], row = "";
		c.font = size + "px Arial, sans-serif";
		label.split(" ").forEach(function (word) {
			var next = row ? row + " " + word : word;
			if (row && c.measureText(next).width > width) { rows.push(row); row = word; }
			else row = next;
		});
		if (row) rows.push(row);
		return rows;
	}
	var objectiveCards = [];
	window.drawDoomObjective = function (ctx, s) {
		// Shown as each level begins, and whenever a solo game is paused.
		var level = window.doomLevels[s[0] - 1], remaining = 480 - s[38];
		if (s[30] || !level || !level[2] || !(s[14] || remaining > 0)) return;
		var card = objectiveCards[s[0]];
		if (!card) {
			card = objectiveCards[s[0]] = document.createElement("canvas");
			var c = card.getContext("2d"), rows = wrapLabel(c, level[2], 284, 9);
			card.width = 300; card.height = 22 + rows.length * 10;
			c.fillStyle = "rgba(9,15,15,.84)"; c.fillRect(0, 0, 300, card.height);
			c.strokeStyle = "#6f7257"; c.strokeRect(.5, .5, 299, card.height - 1);
			mapLabel(c, level[0] + "  /  " + level[1], 150, 13, "#ffd17b", "center", 10);
			rows.forEach(function (row, i) { mapLabel(c, row, 150, 25 + i * 10, "#e8d6b4", "center", 9); });
		}
		ctx.globalAlpha = s[14] ? 1 : Math.min(1, remaining / 60);
		ctx.drawImage(card, 42, 4);
		ctx.globalAlpha = 1;
	};
	function regionImage(index, completed) {
		var previous = regionFrames[index];
		if (previous && previous.completed === completed) return previous.canvas;
		var region = regions[index], image = regionImages[index];
		var frame = previous ? previous.canvas : document.createElement("canvas");
		frame.width = 384; frame.height = 216;
		var c = frame.getContext("2d", { alpha: false });
		c.fillStyle = "#18212b"; c.fillRect(0, 0, 384, 216);
		if (image.complete && image.naturalWidth) c.drawImage(image, 0, 0, 384, 216);
		var shade = c.createLinearGradient(0, 0, 0, 216);
		shade.addColorStop(0, "rgba(4,8,14,.85)"); shade.addColorStop(.24, "rgba(4,8,14,0)");
		shade.addColorStop(.79, "rgba(4,8,14,0)"); shade.addColorStop(1, "rgba(4,8,14,.95)");
		c.fillStyle = shade; c.fillRect(0, 0, 384, 216);
		function cleared(p) {
			// Stamped directly over the landmark, leaving its silhouette visible.
			c.beginPath(); c.moveTo(p[0] - 4, p[1] - 4); c.lineTo(p[0] + 4, p[1] + 4);
			c.moveTo(p[0] + 4, p[1] - 4); c.lineTo(p[0] - 4, p[1] + 4);
			c.lineWidth = 4; c.strokeStyle = "#241b19"; c.stroke();
			c.lineWidth = 2; c.strokeStyle = "#db7654"; c.stroke();
		}
		for (var map = region.first; map <= region.last; ++map)
			if (completed & (1 << (map - 1))) cleared(region.points[map - region.first]);
		if (index === 0 && (completed & (1 << 23))) cleared(region.secret);
		regionFrames[index] = { completed: completed, canvas: frame };
		return frame;
	}
	function drawRoute(c, s, completed, values, counts, totals, reveal, pointerOn) {
		var destination = s[37], current = regionFor(s[0]), index = regionFor(destination || s[0]), region = regions[index];
		var cream = "#f1dab2", amber = "#ffd17b";
		var seconds = Math.floor(s[38] / 60), time = Math.floor(seconds / 60) + ":" + ("0" + seconds % 60).slice(-2);
		c.save(); c.translate(-32, -8);
		c.drawImage(regionImage(current, completed), 0, 0);
		if (index !== current && reveal) {
			c.globalAlpha = reveal; c.drawImage(regionImage(index, completed), 0, 0); c.globalAlpha = 1;
		}
		if (reveal) {
			c.globalAlpha = reveal;
			var number = (index + 1) + ":" + (destination === 24 ? "S" : destination - region.first + 1);
			mapLabel(c, destination ? "ENTERING  " + number : "CAMPAIGN COMPLETE", 192, 13, "#c4bba8", "center", 9);
			c.font = "bold 17px Arial, sans-serif"; c.textAlign = "center";
			c.fillStyle = "#261b1b"; c.fillText(destination ? mapNames[destination - 1] : "THE GRID IS SILENT", 193, 34);
			c.fillStyle = cream; c.fillText(destination ? mapNames[destination - 1] : "THE GRID IS SILENT", 192, 32);
			if (destination) {
				var objective = wrapLabel(c, window.doomLevels[destination - 1][2] || "", 340, 9);
				if (objective.length) {
					c.fillStyle = "rgba(7,12,17,.72)"; c.fillRect(16, 176 - objective.length * 10, 352, objective.length * 10 + 4);
					objective.forEach(function (row, i) { mapLabel(c, row, 192, 184 - (objective.length - 1 - i) * 10, cream, "center", 9); });
				}
				var p = destination === 24 ? region.secret : region.points[destination - region.first];
				if (pointerOn) {
					c.beginPath(); c.moveTo(p[0] - 3, p[1] - 17); c.lineTo(p[0] + 3, p[1] - 17);
					c.lineTo(p[0] + 3, p[1] - 10); c.lineTo(p[0] + 7, p[1] - 10);
					c.lineTo(p[0], p[1] - 3); c.lineTo(p[0] - 7, p[1] - 10); c.lineTo(p[0] - 3, p[1] - 10); c.closePath();
					c.lineWidth = 2; c.strokeStyle = "#261b1b"; c.stroke(); c.fillStyle = amber; c.fill();
				}
				var labelX = Math.max(36, Math.min(348, p[0]));
				c.fillStyle = "rgba(7,12,17,.8)"; c.fillRect(labelX - 31, p[1] + 7, 62, 12);
				mapLabel(c, "YOU ARE HERE", labelX, p[1] + 16, amber, "center", 8);
			}
			mapLabel(c, "KILLS " + values[0] + "%     ITEMS " + values[1] + "%     SECRETS " + values[2] + "%     " + time, 192, 194, cream, "center", 9);
			mapLabel(c, "CHAPTER " + (index + 1) + " / " + region.name, 10, 209, "#b5ab9a", "left", 8);
			c.globalAlpha = 1;
		}
		if (reveal < 1) {
			c.globalAlpha = 1 - reveal;
			mapLabel(c, "CHAPTER " + (current + 1) + " / " + regions[current].name, 192, 13, "#c4bba8", "center", 9);
			c.font = "bold 17px Arial, sans-serif"; c.textAlign = "center";
			c.fillStyle = "#261b1b"; c.fillText(mapNames[s[0] - 1], 193, 34);
			c.fillStyle = cream; c.fillText(mapNames[s[0] - 1], 192, 32);
			mapLabel(c, "FINISHED", 192, 47, "#dd9370", "center", 10);
			c.fillStyle = "rgba(7,12,17,.72)"; c.fillRect(91, 66, 202, 100);
			["KILLS", "ITEMS", "SECRETS"].forEach(function (label, i) {
				var y = 87 + i * 22;
				mapLabel(c, label, 104, y, cream, "left", 11);
				mapLabel(c, values[i] + "%", 236, y, amber, "right", 13);
				mapLabel(c, counts[i] + "/" + totals[i], 280, y, "#b5ab9a", "right", 8);
			});
			mapLabel(c, "TIME  " + time, 192, 155, cream, "center", 10);
			c.globalAlpha = 1;
		}
		mapLabel(c, s[36] === 2 ? "ESC: MENU" : "ENTER / SPACE: CONTINUE", 374, 209, "#d0c5b1", "right", 8);
		c.restore();
	}
	window.drawDoomIntermission = function (ctx, s, completed) {
		completed = (completed || 0) | (1 << (s[0] - 1));
		var counts = [s[5], s[7], s[8]], totals = [s[6], s[39], s[40]];
		var increment = Math.max(0, Math.floor((s[41] - 12) * 100 / 72));
		var reveal = s[36] === 2 ? 1 : Math.min(5, Math.max(0, Math.floor((s[41] - 150) / 6))) / 5;
		var pointerOn = Math.floor(s[41] / 30) % 2 === 0;
		var values = counts.map(function (count, i) { return Math.min(increment, totals[i] ? Math.floor(count * 100 / totals[i]) : 100); });
		var output = !s[30] && reveal === 1 && s[37] && pointerOn ? pointedResult : results;
		var key = [s[0], s[36], s[37], s[38], s[28], s[29], s[30], s[42], completed, s[30] ? 0 : reveal, counts.join(), totals.join(), values.join(), s.slice(31, 35).join()].join("/");
		if (key !== resultKey) {
			resultKey = key;
			var c = resultContext, red = "#d06a4c", cream = "#e8d6b4";
			if (!s[30]) {
				drawRoute(c, s, completed, values, counts, totals, reveal, reveal < 1);
				// Cache both pointer states; blinking is only one bitmap copy per frame.
				if (reveal === 1 && s[37]) drawRoute(pointedContext, s, completed, values, counts, totals, reveal, true);
				ctx.drawImage(output, 0, 0); return;
			}
			c.fillStyle = "#241d1b"; c.fillRect(-32, -8, 384, 216);
			for (var y = -8; y < 208; y += 16) {
				c.fillStyle = "#302623"; c.fillRect(-32, y, 384, 1);
				for (var x = (y % 32 ? -56 : -32); x < 352; x += 48) c.fillRect(x, y, 1, 16);
			}
			c.strokeStyle = "#76614e"; c.strokeRect(-24.5, -.5, 369, 201);
			if (s[36] === 2) {
				centered(c, "YOU SURVIVED", 48, 3, red);
				centered(c, "THE MACHINE GRID IS DOWN", 85, 2, cream);
				centered(c, "F10 OPENS THE MENU", 132, 1, cream);
				centered(c, s[28] > 1 ? "THE HOST CAN RESTART THE MATCH" : "START A NEW CAMPAIGN OR REPLAY", 147, 1, cream);
			} else {
				centered(c, mapNames[s[0] - 1], 16, 2, cream);
				centered(c, "FINISHED", 34, 3, red);
				if (s[30]) {
					for (var i = 0, row = 0; i < s[28]; ++i) {
						if (s[42] && !(s[42] & (1 << i))) continue;
						text(c, "P" + (i + 1), 55, 63 + row * 17, 2, i === s[29] ? red : cream);
						text(c, s[31 + i] + " FRAGS", 151, 63 + row * 17, 2, cream);
						row++;
					}
				} else {
					["KILLS", "ITEMS", "SECRETS"].forEach(function (label, i) {
						text(c, label, 31, 65 + i * 21, 2, cream);
						text(c, values[i] + "%", 155, 65 + i * 21, 2, red);
						text(c, counts[i] + "/" + totals[i], 225, 68 + i * 21, 1, cream);
					});
				}
				var seconds = Math.floor(s[38] / 60);
				centered(c, "TIME " + Math.floor(seconds / 60) + ":" + ("0" + seconds % 60).slice(-2), 130, 2, cream);
				centered(c, s[37] ? "ENTERING - " + window.doomLevels[s[37] - 1][1] : "CAMPAIGN COMPLETE", 153, 1, red);
				if (s[37]) centered(c, mapNames[s[37] - 1], 165, 2, cream);
				centered(c, "ENTER OR SPACE TO CONTINUE", 184, 1, cream);
			}
		}
		ctx.drawImage(output, 0, 0);
	};
}());
