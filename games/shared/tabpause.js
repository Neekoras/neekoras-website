/*
 * Freezes a game while the player is away: its tab is in the background, or another window or app
 * has focus. It picks up again on its own when they come back (no pause menu). Web Audio is
 * suspended too, since sound keeps playing after a game loop stops.
 *
 * Load this before the game's engine so it sees every AudioContext the game creates. Then either:
 *   TabPause.attach(unityInstance.Module)          // Unity: stops Unity's main loop
 *   TabPause.watch({ pause: fn, resume: fn })       // any engine: your own freeze and resume
 *   await TabPause.whenRunning()                    // resolves now, or once the player is back
 */
(function () {
  if (window.TabPause) return;

  var ctxs = [];
  ["AudioContext", "webkitAudioContext"].forEach(function (n) {
    var Native = window[n];
    if (!Native) return;
    function Wrapped() {
      var c = new (Function.prototype.bind.apply(Native, [null].concat(Array.prototype.slice.call(arguments))))();
      ctxs.push(c);
      return c;
    }
    Wrapped.prototype = Native.prototype;
    window[n] = Wrapped;
  });

  var mod = null, paused = false, watchers = [], waiting = [];

  function call(fn) { try { fn(); } catch (e) { console.warn("TabPause:", e); } }

  function freeze() {
    if (paused) return;
    paused = true;
    if (mod) call(function () { mod.pauseMainLoop(); });
    watchers.forEach(function (w) { call(w.pause); });
    ctxs.forEach(function (c) { call(function () { if (c.state === "running") c.suspend(); }); });
  }
  function thaw() {
    if (!paused) return;
    paused = false;
    ctxs.forEach(function (c) { call(function () { if (c.state === "suspended") c.resume(); }); });
    watchers.forEach(function (w) { call(w.resume); });
    if (mod) call(function () { mod.resumeMainLoop(); });
    waiting.splice(0).forEach(function (r) { r(); });
  }

  // A game inside a same-origin frame (Deltarune) counts as focused while focus is anywhere on the
  // page around it, so tapping its on-screen controls does not freeze it.
  var top = window;
  try { if (window.top.document) top = window.top; } catch (e) {}
  function away() {
    if (document.hidden) return true;
    try { return !top.document.hasFocus(); } catch (e) { return !document.hasFocus(); }
  }
  // Focus moving between a page and its frame fires blur before focus, so check once both landed.
  function check() { setTimeout(function () { if (away()) freeze(); else thaw(); }, 0); }

  document.addEventListener("visibilitychange", check);
  [window, top].forEach(function (w) {
    w.addEventListener("blur", check);
    w.addEventListener("focus", check);
  });
  window.addEventListener("pagehide", freeze);
  window.addEventListener("pageshow", check);
  if (document.hidden) freeze();

  window.TabPause = {
    attach: function (m) {
      if (!m || typeof m.pauseMainLoop !== "function") return;
      mod = m;
      if (paused) call(function () { mod.pauseMainLoop(); });
    },
    watch: function (w) {
      watchers.push(w);
      if (paused) call(w.pause);
    },
    whenRunning: function () {
      return paused ? new Promise(function (r) { waiting.push(r); }) : Promise.resolve();
    },
    isPaused: function () { return paused; },
    audioStates: function () { return ctxs.map(function (c) { return c.state; }); },
  };
})();
