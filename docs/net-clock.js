/* Wake the multiplayer session independently of hidden-window timer throttling. */
"use strict";
var pending = false;
onmessage = function () { pending = false; };
setInterval(function () {
	if (pending) return;
	pending = true;
	postMessage(0);
}, 16);
