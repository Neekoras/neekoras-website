/*
 * Starts a GameMaker web export behind the shared loading screen. Downloads the big files (joining
 * .partN splits), keeps them in Cache Storage so later visits skip the download, then loads the
 * runner scripts and hands them those copies. The screen fades out when the game logs
 * "Entering main loop.". Put these at the top of <body> and remove the page's own runner.js tag:
 *
 *   <script src="/games/shared/loader.js?v=2"></script>
 *   <script src="/games/shared/tabpause.js?v=2"></script>
 *   <script>window.GM_GAME = { title: "Undertale", cache: "undertale-v1", scripts: ["runner.js"],
 *     files: [{ name: "game.unx", parts: 0, bytes: 86295180 }, ...] };</script>
 *   <script src="/games/shared/gamemaker.js?v=5"></script>
 *
 * Optional `saveFiles: [{ url, path }]` places files in the game's save folder (e.g.
 * "/_savedata/lang/lang_en.json") before the game starts, for ports that read data files from there
 * instead of from their bundle. They are kept out of the shared save database. Optional
 * `removeSaveFiles: [path]` deletes stored files another game left there before this one starts.
 */
(function () {
  var cfg = window.GM_GAME;
  var MB = 1048576;
  var totalBytes = cfg.files.reduce(function (n, f) { return n + f.bytes; }, 0);
  var loader = GameLoader({
    title: cfg.title,
    note: "The first load is about " + Math.round(totalBytes / MB) + " MB. After that it is kept in this browser and starts much faster.",
  });
  var loadedBytes = 0;

  async function fetchOnce(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    var reader = res.body.getReader(), chunks = [], got = 0;
    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.length;
        loadedBytes += step.value.length;
        loader.download(loadedBytes);
      }
    } catch (e) {
      loadedBytes -= got;
      throw e;
    }
    return new Blob(chunks);
  }

  async function fetchPart(url) {
    for (var attempt = 1; ; attempt++) {
      try { return await fetchOnce(url); } catch (e) {
        if (attempt === 3) throw e;
        await new Promise(function (r) { setTimeout(r, 1500 * attempt); });
      }
    }
  }

  async function fetchAll(urls) {
    var out = new Array(urls.length), next = 0;
    async function worker() {
      while (next < urls.length) { var i = next++; out[i] = await fetchPart(urls[i]); }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  async function download(file, cache) {
    var urls = [];
    if (!file.parts) urls.push(file.name);
    for (var i = 1; i <= file.parts; i++) urls.push(file.name + ".part" + i);
    // instantiateStreaming only accepts wasm served as application/wasm.
    var blob = new Blob(await fetchAll(urls), { type: /\.wasm$/.test(file.name) ? "application/wasm" : "application/octet-stream" });
    // Caching is a bonus: a full disk or a private window must not stop the game from loading.
    try { await cache.put(key(file), new Response(blob)); } catch (e) { console.warn("Not cached:", e); }
    return blob;
  }

  function key(file) { return new URL(file.name, document.baseURI).pathname; }

  // Puts files into the game's save folder in memory each time the runner finishes loading saves
  // from IndexedDB (GameMaker then calls _GXC_FSSyncCompleted / _FSSyncCompleted), so they are there
  // before the game reads them even when the browser cannot store anything (full storage quota,
  // private windows). Files that came back from storage are left alone.
  function provideSaveFiles(list, data) {
    function put() {
      list.forEach(function (f, i) {
        var cut = f.path.lastIndexOf("/");
        try { Module.FS_createPath("/", f.path.slice(1, cut), true, true); } catch (e) {}
        try { Module.FS_createDataFile(f.path.slice(0, cut), f.path.slice(cut + 1), new Uint8Array(data[i]), true, true, true); } catch (e) {}
      });
    }
    ["_GXC_FSSyncCompleted", "_FSSyncCompleted"].forEach(function (name) {
      var real = Module[name];
      Object.defineProperty(Module, name, {
        configurable: true,
        get: function () { return function () { put(); return real.apply(this, arguments); }; },
        set: function (fn) { real = fn; },
      });
    });
  }

  // Every GameMaker game on this site shares one save database, so files a page provides must never
  // be stored there: Undertale's lang files made Deltarune crash at start. Writes of these paths are
  // answered as if they succeeded without storing anything.
  function keepOutOfStorage(paths) {
    var skip = new Set(paths);
    var realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (typeof key === "string" && skip.has(key)) {
        var req = { result: key, error: null, onsuccess: null, onerror: null };
        setTimeout(function () { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
        return req;
      }
      return realPut.apply(this, arguments);
    };
  }

  function deleteSaveKeys(keys) {
    return new Promise(function (resolve) {
      var req = indexedDB.open("/_savedata");
      // No save database yet: nothing to delete, and creating one here would be wrong.
      req.onupgradeneeded = function () { req.transaction.abort(); };
      req.onerror = function () { resolve(); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction("FILE_DATA", "readwrite");
          keys.forEach(function (k) { tx.objectStore("FILE_DATA").delete(k); });
          tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); resolve(); };
        } catch (e) { db.close(); resolve(); }
      };
    });
  }

  function withParentDirs(paths) {
    var out = new Set();
    paths.forEach(function (p) {
      out.add(p);
      var parts = p.split("/");
      for (var j = 3; j < parts.length; j++) out.add(parts.slice(0, j).join("/"));
    });
    return Array.from(out);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.body.appendChild(s);
    });
  }

  // GameMaker prints this once the first room is running.
  var log = console.log;
  console.log = function () {
    if (String(arguments[0]).indexOf("Entering main loop.") !== -1) loader.done();
    return log.apply(console, arguments);
  };

  (async function () {
    var saveData = cfg.saveFiles ? Promise.all(cfg.saveFiles.map(function (f) {
      return fetch(f.url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + f.url);
        return r.arrayBuffer();
      });
    })).catch(function (e) { console.warn("Could not fetch save files:", e); return null; }) : null;
    var cache = await caches.open(cfg.cache);
    var hits = await Promise.all(cfg.files.map(function (f) { return cache.match(key(f)); }));
    var missing = cfg.files.filter(function (f, i) { return !hits[i]; });
    if (!missing.length) loader.cached();
    else loader.download(0, missing.reduce(function (n, f) { return n + f.bytes; }, 0));

    var urls = {};
    for (var i = 0; i < cfg.files.length; i++) {
      var f = cfg.files[i];
      var blob = hits[i] ? await hits[i].blob() : await download(f, cache);
      if (/\.wasm$/.test(f.name) && blob.type !== "application/wasm") blob = new Blob([blob], { type: "application/wasm" });
      urls[f.name] = URL.createObjectURL(blob);
    }
    loader.starting();

    // The runner asks for these by name; hand it the downloaded copies instead.
    function swap(u) {
      var path = String(u && u.url ? u.url : u).split("?")[0];
      for (var name in urls) if (path.slice(-name.length - 1) === "/" + name || path === name) return urls[name];
      return null;
    }
    var realFetch = window.fetch;
    window.fetch = function (input, init) { return realFetch.call(this, swap(input) || input, init); };
    var realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      var s = swap(url);
      if (s) args[1] = s;
      return realOpen.apply(this, args);
    };

    if (document.readyState === "loading") await new Promise(function (r) { document.addEventListener("DOMContentLoaded", r); });
    // Freeze while the player is away and carry on when they return. The page's own pause() would
    // show the runner's Resume menu instead, so it is switched off.
    if (window.TabPause) {
      window.pause = function () {};
      var frozen = false;
      TabPause.watch({
        pause: function () {
          var c = document.getElementById("canvas");
          if (typeof GM_pause === "function" && c && c.classList.contains("active")) { GM_pause(); frozen = true; }
        },
        resume: function () {
          if (frozen && typeof GM_unpause === "function") { frozen = false; GM_unpause(); }
        },
      });
    }
    var files = await saveData;
    if (cfg.saveFiles) {
      var provided = withParentDirs(cfg.saveFiles.map(function (f) { return f.path; }));
      keepOutOfStorage(provided);
      await deleteSaveKeys(provided);
    }
    if (cfg.removeSaveFiles) await deleteSaveKeys(withParentDirs(cfg.removeSaveFiles));
    if (files) provideSaveFiles(cfg.saveFiles, files);
    for (var j = 0; j < cfg.scripts.length; j++) await loadScript(cfg.scripts[j]);
  })().catch(function (e) {
    console.error(e);
    loader.fail();
  });
})();
