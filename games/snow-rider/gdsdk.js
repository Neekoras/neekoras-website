/*
 * Stand-in for GameDistribution's ad SDK, which Snow Rider 3D calls. There are no ads on this site:
 * nothing is loaded from other sites, ads finish at once, and rewarded-ad buttons give the reward.
 * Every call returns a promise, as the game expects, and events reach the game on the next tick.
 */
(function () {
  function send(name) {
    setTimeout(function () {
      try { if (window.GD_OPTIONS && GD_OPTIONS.onEvent) GD_OPTIONS.onEvent({ name: name, message: "", status: "success" }); } catch (e) {}
    }, 0);
  }
  function ok() { return Promise.resolve(true); }
  window.gdsdk = {
    AdType: { Rewarded: "rewarded", Interstitial: "interstitial", Preroll: "interstitial", Midroll: "interstitial", Display: "display" },
    getSession: ok,
    preloadAd: ok,
    cancelAd: ok,
    showBanner: ok,
    sendEvent: ok,
    openConsole: function () {},
    showAd: function (type) {
      if (type === "rewarded") send("SDK_REWARDED_WATCH_COMPLETE");
      send("SDK_GAME_START");
      return Promise.resolve(true);
    },
    leaderboard: { addScore: ok, show: ok },
  };
})();
