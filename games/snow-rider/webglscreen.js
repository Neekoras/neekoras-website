// The game's WebglScreen plugin calls these on the page (window.parent.frames.*). Desktop play needs
// no rotation, so orientation stays "auto" and fullscreen uses the browser's own API.
(function () {
  window.WebglOrientation = 2;
  window.GetOrientation = function () { return window.WebglOrientation; };
  window.SetOrientation = function (o) { window.WebglOrientation = o; };
  window.GetFullScreen = function () { return !!document.fullscreenElement; };
  window.SetFullScreen = function (on) {
    try { if (on) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  };
})();
