/* Story and menu for the standalone browser game. */
(function () {
	"use strict";
	var game = window.doomGame, canvas = game.canvas, ctx = canvas.getContext("2d");
	var release = createDoomSession.release ? "v" + createDoomSession.release : "older build";
	var versionLabel = document.getElementById("game-version");
	if (versionLabel) versionLabel.textContent = release;
	var menu = document.getElementById("front-menu"), main = document.getElementById("menu-main"), config = document.getElementById("menu-config");
	var difficulty = document.getElementById("menu-difficulty");
	var options = document.getElementById("menu-options"), entry = document.getElementById("menu-entry");
	var optionPage = "room", optionTitle = "", optionStatus = "", optionKey = "", optionScroll = 0;
	var pickerField = "", pickerReturn = "", editField = "", editReturn = "", connectionReturn = "room";
	var connectingGame = "", quittingGame = false, menuFocus = null, roomPhase = "offline", hostOfferDismissed = false;
	var menuArt = document.getElementById("menu-art"), menuContext = menuArt.getContext("2d");
	var audioSettings = document.getElementById("audio-settings");
	var logo = document.createElement("canvas"); logo.width = 384; logo.height = 36;
	var logoContext = logo.getContext("2d");
	logoContext.font = "bold 27px Arial, sans-serif"; logoContext.textAlign = "center";
	logoContext.fillStyle = "#361b15"; logoContext.fillText("GRIDFALL", 193, 29);
	logoContext.fillStyle = "#cd7857"; logoContext.fillText("GRIDFALL", 192, 27);
	var mode = "solo", story = true, started = performance.now(), lastCard = -2, storyFrame = "";
	var storyTimer, storyLead = 0, menuFade = 0, menuAnimation;
	var scene = document.createElement("canvas"), transition = document.createElement("canvas");
	scene.width = transition.width = 384; scene.height = transition.height = 216;
	var sceneContext = scene.getContext("2d"), transitionContext = transition.getContext("2d");
	var caption = document.createElement("canvas"); caption.width = 384; caption.height = 32;
	var captionContext = caption.getContext("2d"), introSoundStarted = false;
	captionContext.font = "13px monospace"; captionContext.textAlign = "center"; captionContext.fillStyle = "#fff4df";
	captionContext.fillText("First to go were the lights...", 192, 22);
	var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	var introDuration = 3500, introBlackout = 2765;
	var introCues = reducedMotion ? [[0, .85], [1540, 0], [1638, .85], [2121, 0], [2233, .85], [2500, 0], [2590, .85], [introBlackout, 0]] :
		[[0, .85], [1295, 0], [1360, .85], [1420, 0], [1500, .85], [1720, .25], [1770, .85], [1876, 0], [1932, .85], [1990, 0], [2051, .85],
			[2160, .15], [2220, .85], [2352, 0], [2422, .85], [2478, 0], [2534, .85], [2583, 0], [2674, .85], [introBlackout, 0]];
	function captionPower(age) {
		for (var i = 1; i < introCues.length; ++i) {
			if (age < introCues[i][0]) return introCues[i - 1][1];
		}
		return 0;
	}
	var sky = new Image(); sky.src = "assets/gridfall/skies.png";
	sky.onload = function () { lastCard = -2; storyFrame = ""; drawStory(); drawMenu(); };
	var storyArt = new Image(); storyArt.src = "assets/gridfall/story.webp?v=20261011-2";
	storyArt.onload = function () { lastCard = -2; storyFrame = ""; drawStory(); };
	var chapters = [
		["They told us the transit hubs were safe.", "By dawn, the machines had locked the gates."],
		["I was fixing the grid below the depot.", "The shielded room hid me from their scans."],
		["Three days later, they found my door.", "I escaped through the vents and took a pistol."],
		["One human voice still answers beyond the depot.", "If I reach the power station, I can find them."]
	];
	function lines(value, width) {
		var result = [], line = "";
		value.split(" ").forEach(function (word) {
			if (line.length + word.length + 1 > width) { result.push(line); line = ""; }
			line += (line ? " " : "") + word;
		});
		if (line) result.push(line);
		return result;
	}
	function title(context) {
		// Detailed lettering rasterized at the game's resolution, not enlarged HUD glyphs.
		context.drawImage(logo, 0, 10);
	}
	function frame(context) {
		context.strokeStyle = "#414a3c"; context.strokeRect(5.5, 5.5, 373, 205);
		title(context);
	}
	function fitMenu() {
		var parent = canvas.parentElement, scale = Math.min(parent.clientWidth / 384, parent.clientHeight / 216);
		if (document.body.classList.contains("touch-mode")) {
			var bounds = canvas.getBoundingClientRect(), origin = parent.getBoundingClientRect();
			menu.style.width = bounds.width + "px"; menu.style.height = bounds.height + "px";
			menu.style.left = bounds.left - origin.left + "px"; menu.style.top = bounds.top - origin.top + "px";
			menu.style.right = menu.style.bottom = "auto";
			entry.style.fontSize = Math.max(16, 12 * bounds.width / 384) + "px";
			return;
		}
		menu.style.width = 384 * scale + "px"; menu.style.height = 216 * scale + "px";
		menu.style.left = (parent.clientWidth - 384 * scale) / 2 + "px";
		menu.style.top = (parent.clientHeight - 216 * scale) / 2 + "px";
		menu.style.right = menu.style.bottom = "auto";
		entry.style.fontSize = 12 * scale + "px";
	}
	function drawMenu() {
		cancelAnimationFrame(menuAnimation);
		if (menu.hidden || main.hidden && difficulty.hidden && options.hidden && entry.hidden) return;
		var choosingSkill = !difficulty.hidden;
		var choosingOption = !options.hidden || !entry.hidden;
		var c = menuContext;
		c.fillStyle = "#111716"; c.fillRect(0, 0, 384, 216);
		if (game.isActive() && !connectingGame) c.drawImage(canvas, 0, 0);
		else if (sky.complete && sky.naturalWidth) c.drawImage(sky, 0, 0, sky.width, sky.height / 3, 0, 0, 384, 216);
		c.fillStyle = "rgba(9,15,15,.88)"; c.fillRect(0, 0, 384, 216);
		frame(c);
		c.font = "8px monospace"; c.textAlign = "right"; c.fillStyle = "#9c9b83";
		c.fillText(release, 370, 18);
		c.font = "8px monospace"; c.textAlign = "center"; c.fillStyle = "#9c9b83";
		c.fillText(choosingOption ? optionTitle.toUpperCase() : choosingSkill ? "NEW CAMPAIGN / CHOOSE DIFFICULTY" : "SURVIVE THE MACHINE TAKEOVER", 192, 50); c.textAlign = "left";
		var choices = entry.hidden ? Array.from((choosingOption ? options : choosingSkill ? difficulty : main).querySelectorAll("button")).filter(function (button) { return !button.hidden; }) : [];
		var mainStart = Math.round(130 - (choices.length - 1) * 15 / 2);
		if (choosingOption) {
			var selectedIndex = choices.indexOf(document.activeElement);
			if (selectedIndex >= 0) optionScroll = Math.max(0, Math.min(optionScroll, selectedIndex));
			if (selectedIndex >= optionScroll + 7) optionScroll = selectedIndex - 6;
		}
		choices.forEach(function (button, index) {
			var y = choosingOption ? 72 + (index - optionScroll) * 16 : choosingSkill ? 78 + index * 18 : mainStart + index * 15, selected = button === document.activeElement;
			button.style.left = (choosingOption ? 28 : 88) / 384 * 100 + "%"; button.style.top = (y - 10) / 216 * 100 + "%";
			button.style.width = (choosingOption ? 336 : 230) / 384 * 100 + "%"; button.style.height = 15 / 216 * 100 + "%";
			if (choosingOption && (index < optionScroll || index >= optionScroll + 7)) { button.style.top = "-100%"; return; }
			c.font = "bold 12px Arial, sans-serif";
			var label = button.textContent.toUpperCase(), x = choosingOption ? 37 : 97;
			while (c.measureText(label).width > (choosingOption ? 328 : 280)) label = label.slice(0, -2).trim() + "…";
			c.fillStyle = "#080c0b"; c.fillText(label, x + 1, y + 1);
			c.fillStyle = button.disabled && !(choosingOption && (optionPage === "players" || optionPage === "stats" || button.getAttribute("data-option") === "join-progress")) ? "#646b5b" : selected ? "#ffe0a0" : "#c9b786";
			c.fillText(label, x, y);
			if (selected) {
				c.fillStyle = "#d88551"; c.fillRect(x - 13, y - 7, 2, 7); c.fillRect(x - 11, y - 6, 2, 5);
				c.fillStyle = "#ffd695"; c.fillRect(x - 9, y - 5, 2, 3);
			}
		});
		c.font = "8px monospace"; c.fillStyle = "#a1a38b"; c.textAlign = "center";
		var checkpoint = game.getCheckpoint();
		if (choosingOption) {
			if (optionStatus) lines(optionStatus, 70).slice(0, 3).forEach(function (line, i) { c.fillText(line, 192, 178 + i * 9); });
			c.fillText(entry.hidden ? connectingGame && !roomState().canHost ? "ENTER/SPACE: CANCEL   ESC: CANCEL" : (choices.length > 7 ? "WHEEL/ARROWS" : "ARROWS") + ": CHOOSE   ENTER/SPACE: SELECT   ESC: BACK" : entry.readOnly ? "CTRL+C: COPY   ESC: BACK" : "ENTER: SAVE   ESC: CANCEL", 192, 208);
			if (choices.length > 7) { c.textAlign = "right"; c.fillText((optionScroll + 1) + "-" + Math.min(optionScroll + 7, choices.length) + " / " + choices.length, 370, 50); c.textAlign = "center"; }
		} else if (game.getSaveError()) {
			c.fillStyle = "#e1b184";
			lines(game.getSaveError().toUpperCase(), 68).slice(0, 2).forEach(function (line, i) { c.fillText(line, 192, 189 + i * 11); });
		} else c.fillText(choosingSkill ? checkpoint ? "REPLACES YOUR SAVED CHECKPOINT" : "ARROWS: CHOOSE   ENTER/SPACE: START" : checkpoint ? "CHECKPOINT / " + window.doomLevels[checkpoint[1] - 1][0] : "ARROWS: CHOOSE   ENTER/SPACE: SELECT", 192, 203);
		c.textAlign = "left";
		if (menuFade) {
			var remaining = 1 - (performance.now() - menuFade) / 350;
			if (remaining > 0) {
				c.globalAlpha = remaining; c.drawImage(transition, 0, 0); c.globalAlpha = 1;
				menuAnimation = requestAnimationFrame(drawMenu);
			} else menuFade = 0;
		}
	}
	function drawStory() {
		clearTimeout(storyTimer);
		if (game.isActive() || !story || !menu.hidden) {
			game.stopIntroSound(); introSoundStarted = false;
			if (window.doomMusic) window.doomMusic.setIntroPlaying(false);
			return;
		}
		var elapsed = performance.now() - started - storyLead;
		// Start the prepared score as soon as the crackle finishes, including its short tail.
		var waitingForBulb = elapsed < introBlackout + 80 || game.isIntroSoundPlaying();
		if (window.doomMusic) window.doomMusic.setIntroPlaying(waitingForBulb);
		if (document.hidden) { game.stopIntroSound(); introSoundStarted = false; return; }
		if (elapsed >= 0 && elapsed < introBlackout + 80 && !introSoundStarted) introSoundStarted = game.introSound(elapsed, introCues);
		if (elapsed >= introDuration + chapters.length * 8000) { openMain(); return; }
		var card = elapsed < introDuration ? -1 : Math.floor((elapsed - introDuration) / 8000);
		var age = Math.max(0, elapsed - (card < 0 ? 0 : introDuration + card * 8000));
		var duration = card < 0 ? introDuration : 8000, fadeIn = card < 0 ? 980 : 800;
		var light = reducedMotion ? 1 : Math.max(0, Math.min(1, (age - 150) / fadeIn, (duration - age) / 700));
		// Update the caption at 30 fps, including its slower reduced-motion flicker.
		var delay = 33;
		if (reducedMotion && (card >= 0 || age >= introBlackout)) delay = duration - age;
		else if (elapsed >= 0 && age >= fadeIn + 150 && age < duration - 700 && (card >= 0 || age >= introBlackout)) delay = duration - 700 - age;
		if (waitingForBulb) delay = Math.min(delay, 33);
		if (delay > 0) storyTimer = setTimeout(drawStory, Math.max(33, delay));
		if (card !== lastCard) {
			lastCard = card;
			var c = sceneContext;
			c.fillStyle = "#000"; c.fillRect(0, 0, 384, 216);
			if (card >= 0) {
				if (storyArt.complete && storyArt.naturalWidth) {
					c.imageSmoothingEnabled = false;
					var cardWidth = storyArt.naturalWidth / 2, cardHeight = storyArt.naturalHeight / 2;
					c.drawImage(storyArt, card % 2 * cardWidth, Math.floor(card / 2) * cardHeight, cardWidth, cardHeight, 0, 0, 384, 216);
				} else if (sky.complete && sky.naturalWidth) {
					c.imageSmoothingEnabled = false;
					c.drawImage(sky, 0, 0, sky.width, sky.height / 3, -12 - card * 8, 0, 432, 216);
				}
				var shade = c.createLinearGradient(0, 144, 0, 198);
				shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(.55, "rgba(0,0,0,.92)"); shade.addColorStop(1, "#000");
				c.fillStyle = shade; c.fillRect(0, 144, 384, 72);
				c.font = "12px Arial, sans-serif"; c.textAlign = "center"; c.fillStyle = "#fff4df";
				chapters[card].forEach(function (line, i) { c.fillText(line, 192, 177 + i * 16); });
			}
			c.font = "9px Arial, sans-serif"; c.textAlign = "right"; c.fillStyle = "#a2a6a7";
			c.fillText("Click / any key: menu", 372, 211);
			canvas.setAttribute("aria-label", (card < 0 ? "First to go were the lights..." : chapters[card].join(" ")) + " Press any key or click for the menu.");
		}
		var power = card < 0 ? captionPower(age) : 0;
		var key = card + "/" + power.toFixed(3) + "/" + light.toFixed(3) + "/" + (elapsed < 0 ? elapsed : "");
		if (key === storyFrame) return;
		storyFrame = key;
		ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 384, 216);
		ctx.globalAlpha = light; ctx.drawImage(scene, 0, 0);
		if (power > 0) { ctx.globalAlpha = light * power; ctx.drawImage(caption, 0, 88); }
		ctx.globalAlpha = 1;
		if (elapsed < 0) {
			ctx.globalAlpha = -elapsed / storyLead; ctx.drawImage(transition, 0, 0); ctx.globalAlpha = 1;
		}
	}
	function roomState() { return window.doomRoom.getState(); }
	function openOptions(page, focusKey) {
		optionPage = page; optionKey = ""; optionScroll = 0; menuFade = 0;
		menu.className = "main-page"; menuArt.hidden = false;
		main.hidden = difficulty.hidden = config.hidden = entry.hidden = true; options.hidden = false;
		fitMenu(); refreshOptions(focusKey);
	}
	function editOption(id) {
		var source = document.getElementById(id);
		if (source.disabled) return;
		editField = id; editReturn = optionPage;
		optionTitle = id === "room-password" ? "Room password" : id === "ninja-url" ? "VDO.Ninja URL" : id === "invite" ? "Invite link" : "Room name";
		optionStatus = ""; options.hidden = true; entry.hidden = false;
		entry.type = source.type === "password" ? "password" : "text";
		entry.readOnly = source.readOnly; entry.maxLength = source.maxLength > 0 ? source.maxLength : 2048;
		entry.value = source.value; entry.setAttribute("aria-label", optionTitle);
		entry.focus(); entry.select(); drawMenu();
	}
	entry.addEventListener("keydown", function (event) {
		if (event.isComposing || event.keyCode === 229) return;
		if (event.code !== "Enter" && event.code !== "NumpadEnter") return;
		event.preventDefault(); event.stopPropagation();
		if (!entry.readOnly) {
			var field = document.getElementById(editField);
			field.value = entry.value; field.dispatchEvent(new Event("change"));
		}
		game.menuSound("select"); openOptions(editReturn, "field-" + editField);
	});
	function pickOption(id) {
		pickerField = id; pickerReturn = optionPage;
		var source = document.getElementById(id);
		openOptions("picker", "pick-" + (id === "music-volume" ? Math.round(Number(source.value) / 10) * 10 : source.value));
	}
	function optionsBack() {
		if (!entry.hidden) openOptions(editReturn, "field-" + editField);
		else if (optionPage === "room" && connectingGame) cancelConnection();
		else if (optionPage === "picker") openOptions(pickerReturn, "field-" + pickerField);
		else if (optionPage === "connection") openOptions(connectionReturn, "connection");
		else if (optionPage === "room-settings" || optionPage === "match-settings" || optionPage === "players" || optionPage === "stats") openOptions("room", optionPage);
		else if (optionPage === "room" && roomState().phase === "offline") openOptions("multiplayer", mode === "join" ? "join" : "host");
		else {
			var parent = document.getElementById(optionPage === "audio" ? "menu-audio" : "menu-multiplayer");
			openMain(); if (parent && !parent.hidden) parent.focus({ preventScroll: true });
		}
	}
	function cancelConnection() {
		var choice = connectingGame;
		window.doomRoom.leave().then(function () { connectingGame = ""; openConfig(choice); });
	}
	function quitGame() {
		if (quittingGame) return;
		quittingGame = true; connectingGame = "";
		function finish() {
			quittingGame = false; mode = "solo";
			window.doomRoomSettings.restore();
			if (new URLSearchParams(location.hash.slice(1)).has("room")) history.replaceState(null, "", location.pathname + location.search);
			openMain();
		}
		if (roomState().phase !== "offline") window.doomRoom.leave().then(finish);
		else { game.stopNetwork(); finish(); }
	}
	function recoverRoom(newRoom) {
		if (quittingGame) return;
		quittingGame = true; connectingGame = "";
		window.doomRoom.leave().then(function () {
			quittingGame = false;
			if (newRoom) {
				document.getElementById("room").value = "";
				document.getElementById("room").dispatchEvent(new Event("change"));
				history.replaceState(null, "", location.pathname + location.search);
			}
			openConfig(newRoom ? "host" : "join");
			connectingGame = newRoom ? "host" : "join";
			document.getElementById(connectingGame).onclick(); refreshOptions();
		});
	}
	function openInvite() {
		var params = new URLSearchParams(location.hash.slice(1));
		if (!params.has("room")) return;
		function show() {
			quittingGame = false;
			window.doomRoomSettings.applyURL(params);
			openConfig("join");
		}
		quittingGame = true; connectingGame = "";
		if (roomState().phase !== "offline") window.doomRoom.leave().then(show);
		else { if (game.isActive()) game.stopNetwork(); show(); }
	}
	window.addEventListener("hashchange", openInvite);
	menu.addEventListener("focusin", function (event) { menuFocus = event.target; });
	window.addEventListener("blur", function () {
		setTimeout(function () {
			var active = document.activeElement;
			if (document.hidden || !active || active.tagName !== "IFRAME" || !active.hidden || active.title !== "GRIDFALL mesh data connections") return;
			if (!menu.hidden && menuFocus && menuFocus.offsetParent) menuFocus.focus({ preventScroll: true });
			else if (menu.hidden && game.isActive()) game.focus();
		}, 0);
	});
	function refreshOptions(focusKey) {
		if (menu.hidden || options.hidden) return;
		var rows = [], room = roomState(), online = room.phase !== "offline";
		function row(key, label, action, disabled) { rows.push({ key: key, label: label, action: action, disabled: !!disabled }); }
		function action(id) {
			var source = document.getElementById(id);
			row(id, source.textContent, function () {
				if (id === "join" || id === "host") connectingGame = id;
				source.onclick();
				if (roomState().phase === "offline") connectingGame = "";
				refreshOptions();
			}, source.disabled);
		}
		function field(id, label) {
			var source = document.getElementById(id), value = source.value;
			if (source.tagName === "SELECT") value = source.options[source.selectedIndex].textContent;
			else if (source.type === "password") value = value ? "********" : "None";
			else if (!value) value = mode === "join" ? "Enter name" : "Automatic";
			row("field-" + id, label + ": " + value, function () { if (source.tagName === "SELECT") pickOption(id); else editOption(id); }, source.disabled);
		}
		function connection() {
			row("connection", "Connection settings", function () { connectionReturn = optionPage; openOptions("connection"); });
		}
		optionStatus = "";
		if (optionPage === "recovery" && room.phase === "fault") {
			var mismatch = document.getElementById("room-status").textContent.indexOf("Different game build.") === 0;
			optionTitle = mismatch ? "Version mismatch" : "Match interrupted";
			if (mismatch) row("reload-game", "Reload for update", function () { location.reload(); });
			else if (!room.host) row("retry-room", "Rejoin room", function () { recoverRoom(false); }, quittingGame);
			row("new-room", "Host a new room", function () { recoverRoom(true); }, quittingGame);
			row("quit", "Quit to main menu", quitGame, quittingGame);
			optionStatus = document.getElementById("room-status").textContent;
		} else if (optionPage === "multiplayer") {
			optionTitle = "Multiplayer";
			row("host", "Host a game", function () { openConfig("host"); });
			row("join", "Join a game", function () { openConfig("join"); });
		} else if (optionPage === "audio") {
			optionTitle = "Music / audio";
			if (window.doomMusic) {
				action("music-toggle");
				row("field-music-volume", "Volume: " + document.getElementById("music-volume").value + "%", function () { pickOption("music-volume"); });
				field("music-track", "Track"); action("music-open");
				optionStatus = document.getElementById("music-status").textContent;
			} else optionStatus = "Music could not be loaded. Reload this page to retry.";
			action("mute");
		} else if (optionPage === "connection") {
			optionTitle = "Connection settings"; field("ninja-url", "Server");
		} else if (optionPage === "room-settings") {
			optionTitle = "More options";
			field("level", "Map"); field("skill", "Difficulty"); field("room-password", "Password"); connection();
			optionStatus = "No password unless you set one.";
		} else if (optionPage === "match-settings") {
			optionTitle = "Match settings";
			field("mode", "Mode"); field("level", "Map"); field("skill", "Difficulty");
			if (room.host) action("begin");
		} else if (optionPage === "stats") {
			optionTitle = "Connection stats";
			var stats = window.doomRoom.getStats();
			stats.links.forEach(function (link, i) {
				var value = link.rttMS === null ? "measuring..." : link.sampleAgeMS > 6000 ? "no recent reply" : link.rttMS + " ms / jitter " + link.jitterMS + " ms";
				row("link-" + i, link.player + (link.host ? " (host)" : "") + ": " + value, null, true);
			});
			row("ack", "Input acknowledged: " + (stats.inputAckMS === null ? "measuring..." : stats.inputAckMS + " ms"), null, true);
			row("save-stats", "Save connection report", window.doomRoom.saveStats);
			optionStatus = "Update: " + stats.updateAgeMS + " ms ago / pending: " + stats.pendingInputs + " / resyncs: " + stats.replays;
		} else if (optionPage === "players") {
			optionTitle = "Players";
			document.getElementById("roster").textContent.split(" · ").filter(Boolean).forEach(function (label, i) { row("player-" + i, label, null, true); });
			optionStatus = room.host ? "Keep this tab open." : "The host starts the match.";
		} else if (optionPage === "picker") {
			var source = document.getElementById(pickerField);
			optionTitle = { level: "Choose map", skill: "Choose difficulty", mode: "Game mode", "music-track": "Choose track", "music-volume": "Music volume" }[pickerField];
			function pick(value) {
				source.value = value;
				if (pickerField === "music-volume") source.oninput();
				else source.dispatchEvent(new Event("change", { bubbles: true }));
				openOptions(pickerReturn, "field-" + pickerField);
			}
			if (pickerField === "music-volume") {
				for (var v = 0; v <= 100; v += 10) (function (value) { row("pick-" + value, value + "%", function () { pick(String(value)); }); }(v));
			} else Array.from(source.options).forEach(function (option) { row("pick-" + option.value, option.textContent, function () { pick(option.value); }, option.disabled || source.disabled); });
		} else {
			optionTitle = document.getElementById("menu-title").textContent;
			if (!online) {
				if (mode === "join") {
					field("room", "Room"); field("room-password", "Password"); action("join"); connection();
				} else {
					field("room", "Room"); field("mode", "Mode"); action("host");
					row("room-settings", "More options", function () { openOptions("room-settings"); });
				}
			} else if (connectingGame) {
				optionTitle = connectingGame === "host" ? "Host a game" : "Join a game";
				field("room", "Room"); field("room-password", "Password");
				var progress = connectingGame === "host" ? "Starting game..." : room.leader ? "Waiting for host..." : "Connecting...";
				if (room.match) progress = room.slot < 0 && room.mask === 15 ? "Room full..." : "Synchronizing game...";
				if (room.phase === "fault") progress = "Unable to join";
				if (room.canHost) {
					optionTitle = hostOfferDismissed ? "Waiting for a host" : "Host this room?";
					row("host-this-room", "Yes, host this room", function () { connectingGame = "host"; window.doomRoom.hostRoom(); });
					if (!hostOfferDismissed) row("wait-for-host", "Keep waiting", function () { hostOfferDismissed = true; refreshOptions(); });
				} else row("join-progress", progress, null, true);
				row("cancel-join", "Cancel", cancelConnection);
			} else {
				optionTitle = "Multiplayer room";
				row("players", "Players", function () { openOptions("players"); });
				row("stats", "Connection stats", function () { openOptions("stats"); });
				row("match-settings", "Match settings", function () { openOptions("match-settings"); });
				if (!document.getElementById("invite-label").hidden) row("field-invite", "Invite link", function () { editOption("invite"); });
				if (room.host && !document.getElementById("invite-label").hidden) row("director", "Open director room", function () {
					var url = new URL("director.html", location.href);
					url.hash = new URL(document.getElementById("invite").value).hash;
					window.open(url.href, "_blank", "noopener");
				});
				row("quit", "Quit to main menu", quitGame);
			}
			optionStatus = document.getElementById("room-status").textContent;
		}
		if (!connectingGame && optionPage !== "recovery") row("options-back", "Back", optionsBack);
		options.setAttribute("aria-label", optionTitle);
		var key = optionPage + JSON.stringify(rows.map(function (r) { return [r.key, r.label, r.disabled]; }));
		if (key !== optionKey) {
			focusKey = focusKey || (options.contains(document.activeElement) ? document.activeElement.getAttribute("data-option") : "");
			optionKey = key; options.textContent = "";
			rows.forEach(function (r) {
				var button = document.createElement("button"); button.textContent = r.label; button.disabled = r.disabled;
				button.setAttribute("data-option", r.key); button.onclick = r.action; options.appendChild(button);
			});
			var focusButton = Array.from(options.querySelectorAll("button")).filter(function (button) { return !button.disabled && button.getAttribute("data-option") === focusKey; })[0] || options.querySelector("button:not(:disabled)");
			if (focusButton) focusButton.focus({ preventScroll: true });
		}
		drawMenu();
	}
	function update() {
		var room = roomState(), online = room.phase !== "offline", guest = online && !room.host;
		var showRecovery = room.phase === "fault" && roomPhase !== "fault"; roomPhase = room.phase;
		if (showRecovery) {
			connectingGame = ""; story = false; menu.hidden = false; game.setMenu(true); openOptions("recovery");
		}
		if (connectingGame && room.phase === "running") { connectingGame = ""; closeMenu(); }
		if (!online) { connectingGame = ""; hostOfferDismissed = false; }
		var checkpoint = game.getCheckpoint(), resume = document.getElementById("menu-continue");
		resume.hidden = !checkpoint || online;
		resume.disabled = !game.ready;
		Array.from(difficulty.querySelectorAll("button[data-skill]")).forEach(function (button) { button.disabled = !game.ready || online; });
		document.getElementById("difficulty-warning").textContent = checkpoint ? "Replaces your saved checkpoint." : "";
		resume.textContent = game.isActive() ? "Restart from checkpoint" : "Continue campaign";
		document.getElementById("menu-solo").hidden = online;
		document.getElementById("checkpoint-status").textContent = online ? "" : game.getSaveError() || (checkpoint ? "Checkpoint: " + window.doomLevels[checkpoint[1] - 1][0] + ". Restarts the level with saved equipment." : "Progress saves at each level entrance.");
		document.getElementById("menu-resume").hidden = !game.isActive() || room.phase === "fault";
		document.getElementById("menu-quit").hidden = !game.isActive() && !online;
		document.getElementById("menu-quit").disabled = quittingGame;
		document.getElementById("menu-story").hidden = game.isActive() || online;
		document.getElementById("start").hidden = mode !== "solo" || online;
		document.getElementById("room-panel").hidden = mode === "solo" && !online;
		document.getElementById("map-choice").hidden = mode === "solo" && !online;
		document.getElementById("level").disabled = guest || !online && mode === "join";
		document.getElementById("skill").disabled = guest || !online && mode === "join";
		document.getElementById("mode").disabled = guest || !online && mode === "join";
		if (guest && room.match) {
			document.getElementById("level").value = String(room.match.map);
			document.getElementById("skill").value = String(room.match.skill);
			document.getElementById("mode").value = room.match.mode;
		}
		document.getElementById("host").hidden = mode === "join" || online;
		document.getElementById("join").hidden = mode !== "join" || online;
		document.getElementById("begin").hidden = !online || guest;
		document.getElementById("leave").hidden = !online;
		document.getElementById("room").disabled = document.getElementById("room-password").disabled = online;
		var matchMode = document.getElementById("mode").value;
		document.getElementById("menu-title").textContent = online ? "Room / " + (room.host ? "host" : "guest") : mode === "solo" ? "New campaign" : mode === "join" ? "Join a game" : "Host a game";
		var brief = "";
		if (mode === "solo" && !online) brief = checkpoint ? "Replaces your saved checkpoint." : "";
		else if (!online && mode === "join") brief = "Enter the host's room and password.";
		else if (!guest || room.match) brief = matchMode === "coop" ? "Shared keys. Friendly fire off." : "Random starts. No robots.";
		document.getElementById("menu-brief").textContent = brief;
		document.getElementById("room-help").textContent = online ? (room.host ? "Keep this tab open. " : "") + "Leave the room to play solo." : "";
		document.getElementById("room-password").placeholder = "Optional";
		refreshOptions(); drawMenu();
	}
	function openMain() {
		if (story && !reducedMotion && !game.isActive()) { transitionContext.drawImage(canvas, 0, 0); menuFade = performance.now(); }
		story = false; game.setMenu(true); menu.hidden = false; drawStory();
		menu.className = "main-page"; menuArt.hidden = false; fitMenu();
		main.hidden = false; config.hidden = difficulty.hidden = options.hidden = entry.hidden = true; update();
		var first = "menu-solo";
		if (roomState().phase !== "offline") first = "menu-multiplayer";
		else if (game.getCheckpoint()) first = "menu-continue";
		if (game.isActive()) first = "menu-resume";
		document.getElementById(first).focus();
		drawMenu();
	}
	function openConfig(choice) {
		if (choice === "host" && mode === "join") window.doomRoomSettings.leaveInvite();
		if (roomState().phase === "offline") document.getElementById("room-status").textContent = "";
		mode = choice; story = false; game.setMenu(true); menu.hidden = false; drawStory();
		var solo = choice === "solo" && roomState().phase === "offline";
		menuFade = 0; menu.className = "main-page"; menuArt.hidden = false; fitMenu();
		main.hidden = config.hidden = options.hidden = entry.hidden = true; difficulty.hidden = !solo;
		if (choice === "coop" || choice === "deathmatch") document.getElementById("mode").value = choice;
		if (choice === "solo" && roomState().phase === "offline") document.getElementById("level").value = "1";
		update();
		if (solo) difficulty.querySelector('[data-skill="' + document.getElementById("skill").value + '"]').focus();
		else openOptions("room", roomState().phase !== "offline" ? "" : choice === "join" && document.getElementById("room").value.trim() ? "join" : "field-room");
	}
	function closeMenu() {
		if (roomState().phase === "fault") { menu.hidden = false; game.setMenu(true); openOptions("recovery"); return; }
		menu.hidden = true; game.setMenu(false); game.focus();
		canvas.setAttribute("aria-label", "GRIDFALL gameplay. Click to control; Escape or F10 opens the menu.");
	}
	document.getElementById("menu-solo").onclick = function () { openConfig("solo"); };
	document.getElementById("menu-multiplayer").onclick = function () {
		if (roomState().phase === "fault") { openOptions("recovery"); return; }
		if (roomState().phase !== "offline") openConfig(roomState().host ? document.getElementById("mode").value : "join");
		else openOptions("multiplayer");
	};
	document.getElementById("menu-open").onclick = function () {
		game.menuSound(menu.hidden ? "open" : "back");
		if (connectingGame) return;
		if (!menu.hidden && game.isActive()) closeMenu();
		else openMain();
	};
	document.getElementById("menu-back").onclick = openMain;
	var difficultyBack = document.getElementById("difficulty-back");
	difficultyBack.onclick = openMain;
	Array.from(document.getElementById("skill").options).forEach(function (option) {
		var button = document.createElement("button");
		button.textContent = option.textContent; button.setAttribute("data-skill", option.value);
		button.onclick = function () {
			if (!game.ready || roomState().phase !== "offline") return;
			document.getElementById("skill").value = option.value;
			document.getElementById("level").value = "1";
			document.getElementById("start").onclick();
		};
		difficulty.insertBefore(button, difficultyBack);
	});
	document.getElementById("audio-back").onclick = openMain;
	document.getElementById("menu-audio").onclick = function () {
		openOptions("audio");
	};
	document.getElementById("menu-resume").onclick = closeMenu;
	document.getElementById("menu-quit").onclick = quitGame;
	document.getElementById("menu-continue").onclick = game.continueCampaign;
	var stage = canvas.parentElement;
	var lastEscape = 0, fullscreenExitAt = -1000, wasGameFullscreen = false;
	function fullscreen() {
		var change = document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen();
		if (change && change.catch) change.catch(function () { document.getElementById("status").textContent = "Fullscreen is unavailable in this window."; });
	}
	["fullscreen", "menu-fullscreen"].forEach(function (id) {
		var button = document.getElementById(id);
		button.hidden = !document.fullscreenEnabled || !stage.requestFullscreen;
		button.onclick = fullscreen;
	});
	document.addEventListener("fullscreenchange", function () {
		var gameFullscreen = document.fullscreenElement === stage;
		if (gameFullscreen && !wasGameFullscreen) {
			lastEscape = 0;
			if (navigator.keyboard && navigator.keyboard.lock) {
				navigator.keyboard.lock(["Escape"]).then(function () {
					if (document.fullscreenElement !== stage) navigator.keyboard.unlock();
				}).catch(function () {
					if (document.fullscreenElement === stage) document.getElementById("status").textContent = "Esc may exit fullscreen here. F10 opens the menu.";
				});
			}
		} else if (!gameFullscreen && wasGameFullscreen) {
			if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
			lastEscape = 0; fullscreenExitAt = performance.now();
			if (menu.hidden) openMain();
		}
		wasGameFullscreen = gameFullscreen;
		document.getElementById("fullscreen").textContent = document.getElementById("menu-fullscreen").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
		if (menu.hidden && game.isActive()) game.focus();
		fitMenu(); drawMenu();
	});
	window.addEventListener("resize", function () { fitMenu(); });
	document.getElementById("menu-story").onclick = function () {
		transitionContext.drawImage(menuArt, 0, 0); menuFade = 0; cancelAnimationFrame(menuAnimation);
		menu.hidden = true; story = true; storyLead = reducedMotion ? 0 : 315;
		game.stopIntroSound(); introSoundStarted = false;
		started = performance.now(); lastCard = -2; storyFrame = ""; drawStory(); canvas.focus();
	};
	canvas.addEventListener("pointerdown", function (event) {
		if (!game.isActive()) { event.preventDefault(); game.menuSound("open"); openMain(); }
	});
	[main, difficulty, options].forEach(function (list) {
		list.addEventListener("focusin", drawMenu);
	});
	options.addEventListener("wheel", function (event) {
		if (menu.hidden || options.hidden || !event.deltaY) return;
		var buttons = Array.from(options.querySelectorAll("button"));
		if (buttons.length <= 7) return;
		event.preventDefault();
		var index = buttons.indexOf(document.activeElement), direction = event.deltaY > 0 ? 1 : -1;
		var next = Math.max(0, Math.min(buttons.length - 1, index + direction * 3));
		while (buttons[next].disabled && next > 0 && next < buttons.length - 1) next += direction;
		if (!buttons[next].disabled && buttons[next] !== document.activeElement) {
			buttons[next].focus({ preventScroll: true }); game.menuSound("move");
		}
	}, { passive: false });
	menu.addEventListener("click", function (event) {
		var target = event.target.closest("button,summary");
		if (target && !target.disabled && target.id !== "menu-story") game.menuSound(target.id === "menu-back" || target.id === "audio-back" || target.id === "difficulty-back" || target.getAttribute("data-option") === "options-back" ? "back" : "select");
	}, true);
	// Existing room and music controls remain the state owners, including async errors.
	var optionUpdates = new MutationObserver(function () { refreshOptions(); });
	optionUpdates.observe(config, { subtree: true, childList: true, characterData: true, attributes: true });
	optionUpdates.observe(audioSettings, { subtree: true, childList: true, characterData: true, attributes: true });
	optionUpdates.observe(document.getElementById("mute"), { childList: true, characterData: true, attributes: true });
	document.addEventListener("keydown", function (event) {
		if (event.isComposing || event.keyCode === 229 || event.target.id === "chat-entry") return;
		if (event.code !== "Escape") { lastEscape = 0; return; }
		event.preventDefault(); event.stopPropagation();
		if (event.repeat) return;
		var now = performance.now();
		// A second tap after Chrome's native fullscreen exit must not resume play.
		if (now - fullscreenExitAt < 450) return;
		if (document.fullscreenElement === stage && lastEscape && now - lastEscape < 450) {
			lastEscape = 0; fullscreen(); return;
		}
		lastEscape = now;
		game.menuSound(menu.hidden ? "open" : "back");
		if (!menu.hidden && (!options.hidden || !entry.hidden)) optionsBack();
		else if (menu.hidden || main.hidden) openMain();
		else if (game.isActive()) closeMenu();
	}, true);
	document.addEventListener("keydown", function (event) {
		if (event.ctrlKey || event.altKey || event.metaKey) return;
		if (event.code === "F10") { event.preventDefault(); if (!event.repeat) document.getElementById("menu-open").click(); return; }
		if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
		if (story && menu.hidden && !game.isActive()) { event.preventDefault(); game.menuSound("open"); openMain(); return; }
		if (!menu.hidden && (event.code === "Enter" || event.code === "NumpadEnter" || event.code === "Space")) {
			event.preventDefault(); event.stopPropagation();
			var selected = document.activeElement;
			if (!event.repeat && menu.contains(selected) && selected.tagName === "BUTTON" && !selected.disabled) selected.click();
			return;
		}
		if (!menu.hidden && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
			var buttons = Array.from(menu.querySelectorAll("button,summary")).filter(function (button) { return !button.disabled && button.offsetParent; });
			if (!buttons.length) return;
			event.preventDefault(); var index = buttons.indexOf(document.activeElement);
			var next = buttons[(index + (event.code === "ArrowDown" ? 1 : buttons.length - 1) + buttons.length) % buttons.length];
			if (next !== document.activeElement) { next.focus({ preventScroll: true }); game.menuSound("move"); }
		}
		if (!menu.hidden && !options.hidden && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
			var key = document.activeElement.getAttribute("data-option");
			if (key && key.indexOf("field-") === 0) {
				var source = document.getElementById(key.slice(6)), direction = event.code === "ArrowRight" ? 1 : -1;
				if (source && !source.disabled && (source.tagName === "SELECT" || source.id === "music-volume")) {
					event.preventDefault(); game.menuSound("move");
					if (source.id === "music-volume") { source.value = Math.max(0, Math.min(100, Number(source.value) + direction * 10)); source.oninput(); }
					else { source.selectedIndex = (source.selectedIndex + direction + source.options.length) % source.options.length; source.dispatchEvent(new Event("change", { bubbles: true })); }
					refreshOptions(key);
				}
			}
		}
	});
	window.addEventListener("doom-started", function () {
		game.stopIntroSound(); introSoundStarted = false; story = false; storyFrame = ""; clearTimeout(storyTimer); cancelAnimationFrame(menuAnimation); menuFade = 0;
		if (window.doomMusic) window.doomMusic.setIntroPlaying(false);
		if (connectingGame && roomState().phase !== "running") { game.setMenu(true); refreshOptions(); return; }
		menu.hidden = true; canvas.setAttribute("aria-label", "GRIDFALL gameplay. Click to control; Escape or F10 opens the menu.");
	});
	window.addEventListener("doom-stopped", function () { if (connectingGame || quittingGame) return; setTimeout(function () { if (!game.isActive() && roomState().phase !== "fault") openMain(); }, 0); });
	window.addEventListener("doom-room-change", update);
	setInterval(function () { if (!menu.hidden && optionPage === "stats") refreshOptions(); }, 1000);
	window.addEventListener("doom-ready", update);
	window.addEventListener("doom-checkpoint", update);
	document.getElementById("mode").addEventListener("change", update);
	document.addEventListener("visibilitychange", drawStory);
	update();
	if (new URLSearchParams(location.hash.slice(1)).has("room")) openInvite();
	else drawStory();
}());
