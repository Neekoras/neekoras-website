/*
 * Shared loading screen for the games on neekoras.com, in the same style as Hollow Knight's.
 *
 *   const L = GameLoader({ title: "ULTRAKILL", totalBytes: 98e6, note: "..." });
 *   L.download(bytesSoFar, totalBytes?)  // byte progress: bar, percent, MB, time left
 *   L.percent(fraction, label?)          // progress without byte counts
 *   L.cached()                           // files are coming from this browser, not the network
 *   L.starting(label?)                   // download done, the game is starting up
 *   L.done()                             // fade out and remove
 *   L.fail(message?)                     // show the error and a Reload button
 *
 * Load this as a plain <script> at the top of <body> so the screen shows before anything else.
 */
(function () {
  if (window.GameLoader) return;

  const css = `
    @font-face { font-family: "Instrument Serif"; font-weight: 400; font-display: swap;
      src: url("/games/shared/fonts/instrument-serif-400.woff2") format("woff2"); }
    @font-face { font-family: "Inter"; font-weight: 400; font-display: swap;
      src: url("/games/shared/fonts/inter-400.woff2") format("woff2"); }
    #gl-loader { position: fixed; inset: 0; z-index: 99000; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at 50% 40%, #2c2729 0%, #1a1718 60%, #121011 100%);
      color: #ece6da; font-family: Inter, system-ui, sans-serif; transition: opacity .6s ease; padding: 24px; box-sizing: border-box;
      text-align: left; line-height: normal; letter-spacing: normal; }
    #gl-loader.gl-gone { opacity: 0; pointer-events: none; }
    #gl-loader * { box-sizing: border-box; }
    #gl-loader .gl-inner { width: 100%; max-width: 440px; }
    #gl-loader .gl-kicker { font-size: 11px; letter-spacing: .28em; text-transform: uppercase; color: #8f877b; margin-bottom: 14px; }
    #gl-loader .gl-title { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: clamp(44px, 9vw, 64px);
      line-height: 1; margin: 0 0 34px; letter-spacing: -.01em; color: #ece6da; }
    #gl-loader .gl-bar { position: relative; height: 3px; background: rgba(236, 230, 218, .12); border-radius: 3px; overflow: hidden; }
    #gl-loader .gl-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #d0714f; border-radius: 3px; transition: width .35s linear; }
    #gl-loader .gl-bar.gl-busy .gl-fill { width: 35% !important; transition: none; animation: gl-slide 1.3s ease-in-out infinite; }
    @keyframes gl-slide { 0% { left: -35%; } 100% { left: 100%; } }
    @media (prefers-reduced-motion: reduce) { #gl-loader .gl-bar.gl-busy .gl-fill { animation: none; width: 100% !important; opacity: .5; } }
    #gl-loader .gl-row { display: flex; justify-content: space-between; gap: 16px; margin-top: 14px; font-size: 14px; font-variant-numeric: tabular-nums; }
    #gl-loader .gl-muted { color: #8f877b; font-size: 13px; margin-top: 6px; }
    #gl-loader .gl-note { margin: 34px 0 0; font-size: 13px; line-height: 1.6; color: #8f877b; }
    #gl-loader .gl-retry { margin-top: 18px; font: inherit; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #ece6da;
      background: none; border: 1px solid rgba(236, 230, 218, .35); border-radius: 999px; padding: 9px 18px; cursor: pointer; }
    #gl-loader .gl-retry:hover { border-color: #ece6da; }
  `;

  window.GameLoader = function (opts) {
    opts = opts || {};
    const style = document.createElement("style");
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    const root = document.createElement("div");
    root.id = "gl-loader";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.innerHTML =
      '<div class="gl-inner">' +
      '<div class="gl-kicker">Now loading</div>' +
      '<h1 class="gl-title"></h1>' +
      '<div class="gl-bar gl-busy" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="gl-fill"></div></div>' +
      '<div class="gl-row"><span class="gl-phase">Getting ready</span><span class="gl-pct"></span></div>' +
      '<div class="gl-row gl-muted"><span class="gl-mb"></span><span class="gl-eta"></span></div>' +
      '<p class="gl-note"></p>' +
      "</div>";
    const q = (c) => root.querySelector(c);
    const bar = q(".gl-bar"), fill = q(".gl-fill"), phaseEl = q(".gl-phase"), pctEl = q(".gl-pct"),
      mbEl = q(".gl-mb"), etaEl = q(".gl-eta"), noteEl = q(".gl-note");
    q(".gl-title").textContent = opts.title || document.title;
    bar.setAttribute("aria-label", "Loading " + (opts.title || "the game"));
    noteEl.textContent = opts.note || "";
    if (!opts.note) noteEl.hidden = true;
    (document.body || document.documentElement).appendChild(root);

    let total = opts.totalBytes || 0, bytes = 0, start = 0, raf = 0, phase = "", frac = 0, finished = false;
    const MB = 1048576;
    function busy(on) { bar.classList.toggle("gl-busy", on); }
    function eta() {
      const secs = (performance.now() - start) / 1000;
      if (secs < 3 || bytes <= 0 || !total) return "";
      const left = (total - bytes) / (bytes / secs);
      if (left < 60) return "Under a minute left";
      return "About " + Math.round(left / 60) + " min left";
    }
    function drawBar() {
      const pct = Math.floor(frac * 100);
      fill.style.width = frac * 100 + "%";
      bar.setAttribute("aria-valuenow", pct);
      pctEl.textContent = pct + "%";
    }
    function render() {
      raf = 0;
      frac = total ? Math.min(bytes / total, 1) : 0;
      if (frac > 0.999) frac = 1;
      drawBar();
      if (total) mbEl.textContent = Math.round(bytes / MB) + " of " + Math.round(total / MB) + " MB";
      etaEl.textContent = frac === 1 ? "" : eta();
    }
    function enter(name, label, isBusy) {
      if (phase !== name) { phase = name; busy(isBusy); }
      if (label) phaseEl.textContent = label;
    }

    return {
      download(soFar, newTotal) {
        if (finished) return;
        if (newTotal) total = newTotal;
        if (phase !== "download" && phase !== "cached") { start = performance.now(); }
        if (phase !== "cached") enter("download", "Downloading game files", false);
        else busy(false);
        bytes = soFar;
        if (!raf) raf = requestAnimationFrame(render);
      },
      percent(f, label) {
        if (finished) return;
        enter("percent", label || "Loading game files", false);
        frac = Math.max(0, Math.min(1, f));
        drawBar();
      },
      cached() {
        // Games may report 0 bytes before they know where files come from, so only real network
        // bytes rule this out.
        if (finished || (phase === "download" && bytes > 0)) return;
        phase = "cached";
        phaseEl.textContent = "Loading from your browser";
        if (opts.cachedNote !== "") {
          noteEl.hidden = false;
          noteEl.textContent = opts.cachedNote || "The game is already saved in this browser, so no download is needed.";
        }
      },
      starting(label) {
        if (finished) return;
        enter("starting", null, true);
        phaseEl.textContent = label || "Starting the game";
        pctEl.textContent = "";
        mbEl.textContent = "";
        etaEl.textContent = "This can take a few seconds";
      },
      done() {
        if (finished) return;
        finished = true;
        root.classList.add("gl-gone");
        setTimeout(() => { root.remove(); style.remove(); }, 700);
      },
      fail(message) {
        if (finished) return;
        finished = true;
        busy(false);
        fill.style.width = "0";
        phaseEl.textContent = "The game could not load";
        pctEl.textContent = "";
        mbEl.textContent = "";
        etaEl.textContent = "";
        noteEl.hidden = false;
        noteEl.textContent = message || "Check your connection, then reload the page to try again.";
        const b = document.createElement("button");
        b.className = "gl-retry";
        b.textContent = "Reload";
        b.onclick = () => location.reload();
        noteEl.after(b);
      },
    };
  };
})();
