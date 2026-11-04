/*
 * For games that use Ctrl with WASD (slide, crouch). Chrome keeps shortcuts like Ctrl+W (close tab) for
 * itself and only hands them to the page in fullscreen with the Keyboard Lock API. So clicking the game
 * goes fullscreen and locks the keyboard: every key, Ctrl+W included, then reaches the game, and holding
 * Esc leaves fullscreen. If the tab is closed outside fullscreen once the game has been played, the
 * browser asks first.
 *
 *   <script src="/games/shared/keylock.js" data-target="#unity-canvas"></script>
 */
(function () {
  var script = document.currentScript;
  var selector = (script && script.dataset.target) || "canvas";
  var played = false;

  function enter() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(function () {
      if (navigator.keyboard && navigator.keyboard.lock) return navigator.keyboard.lock();
    }).catch(function () {});
  }

  document.addEventListener("pointerdown", function (e) {
    if (!e.target.closest || !e.target.closest(selector)) return;
    played = true;
    enter();
  }, true);

  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
  });

  window.addEventListener("beforeunload", function (e) {
    if (!played) return;
    e.preventDefault();
    e.returnValue = "";
  });
})();
