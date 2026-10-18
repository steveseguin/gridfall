/* Touch controls feed the same digital inputs as the keyboard. */
(function () {
	"use strict";
	var game = window.doomGame, stage = game.canvas.parentElement;
	var menu = document.getElementById("front-menu"), chat = document.getElementById("chat-entry");
	var entry = document.getElementById("menu-entry");
	var panel = document.getElementById("touch-controls"), play = document.getElementById("touch-play");
	var navigation = document.getElementById("touch-navigation"), chatButtons = document.getElementById("touch-chat");
	var toggle = document.getElementById("touch-toggle"), running = false, pointers = {}, enabled = false;
	var coarse = window.matchMedia("(pointer: coarse)"), lastPortrait;
	var masks = { fire: 0x08000000, use: 0x04000000 };
	function clear() {
		var held = pointers; pointers = {}; running = false;
		Object.keys(held).forEach(function (id) {
			var el = held[id].element;
			if (el.hasPointerCapture(Number(id))) el.releasePointerCapture(Number(id));
		});
		Array.from(panel.querySelectorAll(".pressed")).forEach(function (el) { el.classList.remove("pressed"); });
		Array.from(panel.querySelectorAll(".touch-stick span")).forEach(function (el) { el.style.transform = ""; });
		document.getElementById("touch-run").setAttribute("aria-pressed", "false");
	}
	function send() {
		var mask = running ? 0x02000000 : 0;
		Object.keys(pointers).forEach(function (id) { mask |= pointers[id].mask; });
		game.setTouchInput(mask);
	}
	function layout() {
		if (!enabled) return;
		// Some phone browsers shrink only the visual viewport for the soft keyboard.
		stage.style.height = window.visualViewport && (!chat.hidden || !entry.hidden) ? window.visualViewport.height + "px" : "";
		var style = getComputedStyle(stage), left = parseFloat(style.paddingLeft), top = parseFloat(style.paddingTop);
		var width = stage.clientWidth - left - parseFloat(style.paddingRight);
		var height = stage.clientHeight - top - parseFloat(style.paddingBottom);
		var portrait = height >= width, reserve = portrait ? Math.min(300, height * .48) : 0;
		if (lastPortrait !== undefined && lastPortrait !== portrait) game.release();
		lastPortrait = portrait;
		var w = Math.min(width, (height - reserve) * 16 / 9), h = w * 9 / 16;
		stage.classList.toggle("touch-portrait", portrait);
		game.canvas.style.width = w + "px"; game.canvas.style.height = h + "px";
		game.canvas.style.left = left + (width - w) / 2 + "px";
		game.canvas.style.top = top + (height - reserve - h) / 2 + "px";
		stage.style.setProperty("--hud-bottom", stage.clientHeight - top - (height - reserve - h) / 2 - h * 176 / 216 + "px");
	}
	function update() {
		var playing = game.isActive() && menu.hidden && chat.hidden;
		play.hidden = !playing; navigation.hidden = playing || !chat.hidden; chatButtons.hidden = chat.hidden;
		document.getElementById("touch-talk").hidden = !window.doomRoom || window.doomRoom.getState().phase !== "running";
		if (!playing) clear();
		layout();
	}
	function setEnabled(value) {
		game.release(); enabled = value;
		document.body.classList.toggle("touch-mode", enabled); panel.hidden = !enabled;
		document.body.classList.toggle("touch-loading", !game.ready);
		toggle.textContent = enabled ? "Hide touch controls" : "Touch controls";
		toggle.setAttribute("aria-pressed", String(enabled));
		if (!enabled) { stage.style.height = ""; game.canvas.style.width = game.canvas.style.height = game.canvas.style.left = game.canvas.style.top = ""; }
		layout(); update(); window.dispatchEvent(new Event("resize"));
	}
	function navigate(code) {
		// Reuse menu editing, validation, focus and sound behavior, including native text fields.
		(document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { code: code, key: code, bubbles: true, cancelable: true }));
	}
	function move(event, held) {
		var el = held.element;
		if (!el.classList.contains("touch-stick")) return;
		var rect = el.getBoundingClientRect(), radius = rect.width / 2;
		var x = (event.clientX - rect.left - radius) / radius, y = (event.clientY - rect.top - radius) / radius;
		var length = Math.sqrt(x * x + y * y), scale = length > 1 ? 1 / length : 1;
		x *= scale; y *= scale;
		el.querySelector("span").style.transform = "translate(" + x * radius * .55 + "px," + y * radius * .55 + "px)";
		var dead = .25;
		held.mask = el.id === "touch-move" ? (y < -dead ? 0x40000000 : y > dead ? 0x80000000 : 0) |
			(x < -dead ? 0x00200000 : x > dead ? 0x00400000 : 0) : x < -dead ? 0x10000000 : x > dead ? 0x20000000 : 0;
	}
	panel.addEventListener("pointerdown", function (event) {
		var el = event.target.closest("button");
		if (!enabled || !el || event.button !== 0) return;
		event.preventDefault();
		if (Object.keys(pointers).some(function (id) { return pointers[id].element === el; })) return;
		var action = el.getAttribute("data-touch"), key = el.getAttribute("data-key");
		if (key) { navigate(key); return; }
		if (action === "menu") { document.getElementById("menu-open").click(); return; }
		if (action === "hide") { setEnabled(false); return; }
		if (action === "run") {
			running = !running; el.classList.toggle("pressed", running); el.setAttribute("aria-pressed", String(running)); send(); return;
		}
		if (action) { game.touchAction(action); return; }
		var held = { element: el, mask: masks[el.getAttribute("data-hold")] || 0 };
		pointers[event.pointerId] = held; el.setPointerCapture(event.pointerId); el.classList.add("pressed");
		move(event, held); send();
	}, { passive: false });
	panel.addEventListener("pointermove", function (event) {
		var held = pointers[event.pointerId]; if (!held) return;
		event.preventDefault(); move(event, held); send();
	}, { passive: false });
	function end(event) {
		var held = pointers[event.pointerId]; if (!held) return;
		delete pointers[event.pointerId]; held.element.classList.remove("pressed");
		var thumb = held.element.querySelector("span"); if (thumb) thumb.style.transform = "";
		send();
	}
	["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) { panel.addEventListener(name, end); });
	// A screen reader or hardware keyboard can also activate the console buttons.
	panel.addEventListener("click", function (event) {
		if (event.detail || !event.target.closest("button")) return;
		var el = event.target.closest("button"), key = el.getAttribute("data-key"), action = el.getAttribute("data-touch");
		if (key) navigate(key);
		else if (action === "menu") document.getElementById("menu-open").click();
		else if (action === "hide") setEnabled(false);
		else if (action && action !== "run") game.touchAction(action);
	});
	toggle.onclick = function () { setEnabled(!enabled); };
	window.addEventListener("doom-input-release", clear);
	window.addEventListener("doom-ready", function () { document.body.classList.remove("touch-loading"); });
	["doom-started", "doom-stopped", "doom-room-change"].forEach(function (name) { window.addEventListener(name, update); });
	new MutationObserver(update).observe(menu, { attributes: true, attributeFilter: ["hidden"] });
	new MutationObserver(update).observe(chat, { attributes: true, attributeFilter: ["hidden"] });
	new MutationObserver(function () { if (enabled) window.dispatchEvent(new Event("resize")); }).observe(entry, { attributes: true, attributeFilter: ["hidden"] });
	window.addEventListener("resize", layout, true);
	if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { if (enabled) window.dispatchEvent(new Event("resize")); });
	window.addEventListener("orientationchange", function () { if (enabled) game.release(); });
	if (coarse.addListener) coarse.addListener(function () { setEnabled(coarse.matches); });
	setEnabled(coarse.matches);
}());
