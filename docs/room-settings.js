/* Shared connection defaults for the player and director. */
(function () {
	"use strict";
	var key = "gridfall-room-settings", fromURL = false;
	var fields = {
		room: document.getElementById("room"),
		password: document.getElementById("room-password") || document.getElementById("password"),
		ninja: document.getElementById("ninja-url") || document.getElementById("ninja")
	};
	var defaults = { room: "", password: "", ninja: "https://vdo.ninja/" };
	function restore() {
		var saved;
		try { saved = JSON.parse(localStorage.getItem(key)); } catch (error) {}
		Object.keys(fields).forEach(function (name) {
			fields[name].value = saved && typeof saved[name] === "string" ? saved[name] : defaults[name];
		});
		fromURL = false;
	}
	function applyURL(params) {
		if (!Object.keys(fields).some(function (name) { return params.has(name); })) return;
		Object.keys(fields).forEach(function (name) {
			fields[name].value = params.has(name) ? params.get(name) : defaults[name];
		});
		fromURL = true;
	}
	function save() {
		if (fromURL) return;
		var settings = { room: fields.room.value.trim(), password: fields.password.value, ninja: fields.ninja.value };
		if (!settings.room) return;
		try { localStorage.setItem(key, JSON.stringify(settings)); } catch (error) {}
	}
	Object.keys(fields).forEach(function (name) {
		fields[name].addEventListener("change", function () { fromURL = false; });
	});
	function isReload() {
		var entries = performance.getEntriesByType ? performance.getEntriesByType("navigation") : [];
		return entries.length ? entries[0].type === "reload" : !!(performance.navigation && performance.navigation.type === 1);
	}
	window.doomRoomSettings = { restore: restore, applyURL: applyURL, save: save, isReload: isReload,
		leaveInvite: function () { if (fromURL) restore(); }
	};
	restore();
	applyURL(new URLSearchParams(location.hash.slice(1)));
}());
