/*
 * Cloud saves for Inscryption (Unity WebGL) on neekoras.com.
 *
 * Unity keeps the game's files (its save files, plus PlayerPrefs settings) in the
 * browser's "/idbfs" IndexedDB database (object store "FILE_DATA"), in a folder only Inscryption uses.
 * We hook IDBObjectStore.put to catch the moment Unity writes one, and upload a snapshot (a STORE
 * zip, same format as the other games) to /games/inscryption/api/, keeping the newest 10 per save
 * code. Unity's own analytics files and its per-launch "unity.*" values are left out of the
 * change check. Restore writes the files back into the same store and reloads so Unity reads
 * them on startup.
 */
(function () {
  const API = "https://neekoras.com/games/inscryption/api";
  const IDBFS_DB = "/idbfs";
  const POLL_MS = 30000; // fallback only; the put hook below is the real trigger
  const DEBOUNCE_MS = 1500;

  // ---- anonymous per-browser identity ----
  // One save code is shared by every game on neekoras.com (they share this origin's storage).
  const SHARED_KEY = "neekoras-save-code";
  const CODE_FILE_KEY = "neekoras-save-code-file"; // "pending" until the code file has been downloaded
  const LASTHASH_KEY = "inscryption-cloud-lasthash";
  const OWN_KEY = "inscryption-cloud-uid"; // the code this game used before codes were shared
  const GAME_KEYS = ["hollow-knight-cloud-uid", "celeste-cloud-uid", "pokerogue-cloud-uid", "clustertruck-cloud-uid", "omori-cloud-uid", "ultrakill-cloud-uid", "inscryption-cloud-uid", "stardew-cloud-uid"];
  const isCode = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  let OWN = null;
  function userId() {
    try {
      OWN = localStorage.getItem(OWN_KEY);
      let id = localStorage.getItem(SHARED_KEY);
      if (!isCode(id)) {
        id = GAME_KEYS.map((k) => localStorage.getItem(k)).find(isCode);
        if (!id) id = crypto.randomUUID();
        localStorage.setItem(SHARED_KEY, id);
      }
      return id;
    } catch {
      return null; // storage blocked: cloud saves off
    }
  }
  let UID = userId();
  if (!UID) return;
  let viewUID = UID; // whose snapshots the panel is showing (own by default)

  // If this game had its own code, copy its saves to the shared code. The server only does that
  // when the shared code has no saves for this game yet; otherwise it marks the newest one kept,
  // so this browser's local game can never push it out.
  const migrated = (async () => {
    try {
      if (!isCode(OWN) || OWN === UID) { localStorage.setItem(OWN_KEY, UID); return; }
      const resp = await fetch(`${API}/saves/adopt?u=${UID}&from=${OWN}`, { method: "POST" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const r = await resp.json();
      localStorage.setItem(OWN_KEY, UID);
      if (r.copied) console.info("[cloudsave] copied", r.copied, "saves to your shared save code");
      if (r.existing) {
        setTimeout(() => toast("Now using the save code from your other games. Click \u2601 to restore a save here.", { icon: "&#9729;", ms: 9000 }), 7500);
      }
    } catch (e) {
      console.warn("[cloudsave] could not move saves to the shared code:", e);
    }
  })();

  // ---- minimal STORE-only zip writer (CRC32 + local/central headers) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }
  function buildZip(files) {
    // files: [{name: string, data: Uint8Array}]
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localParts = [], centralParts = [];
    let offset = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name);
      const crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.length, true);
      lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, nameB.length, true);
      lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, f.data.length, true);
      ch.setUint32(24, f.data.length, true);
      ch.setUint16(28, nameB.length, true);
      ch.setUint32(42, offset, true);
      localParts.push(new Uint8Array(lh.buffer), nameB, f.data);
      centralParts.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + f.data.length;
    }
    const centralSize = centralParts.reduce((a, p) => a + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    const all = [...localParts, ...centralParts, new Uint8Array(eocd.buffer)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }
  function parseZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dec = new TextDecoder();
    const files = [];
    let pos = 0;
    while (pos + 4 <= buf.length && dv.getUint32(pos, true) === 0x04034b50) {
      const method = dv.getUint16(pos + 8, true);
      const csize = dv.getUint32(pos + 18, true);
      const nameLen = dv.getUint16(pos + 26, true);
      const extraLen = dv.getUint16(pos + 28, true);
      const name = dec.decode(buf.subarray(pos + 30, pos + 30 + nameLen));
      const dataStart = pos + 30 + nameLen + extraLen;
      if (method !== 0) throw new Error("unsupported zip entry (not STORE): " + name);
      files.push({ name, data: buf.subarray(dataStart, dataStart + csize) });
      pos = dataStart + csize;
    }
    if (!files.length) throw new Error("no entries found");
    return files;
  }

  // ---- reading/writing the game's save straight out of the /idbfs IndexedDB ----
  function openIdbfs() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDBFS_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        // The game itself creates this DB; if it doesn't exist yet there's
        // nothing to save. Abort the upgrade so we don't leave a stray v1 DB.
        req.transaction.abort();
      };
    });
  }
  const FILE_MODE = 33206; // S_IFREG | 0666, what Unity/Emscripten writes for regular files
  const DIR_MODE = 16877;  // S_IFDIR | 0755
  // Every Unity game on this site shares the "/idbfs" database, each in its own folder named
  // md5("https://neekoras.com/games/inscryption"). Only touch that folder, and skip Unity's analytics.
  const OWN_DIR = "/idbfs/1a19f12d4e1416a9a9a2fb5d556e9bb0";
  // The game's progress file sits one level up: it saves to persistentDataPath + "/../" (see index.html).
  const PROGRESS_FILES = ["/idbfs/SaveFile.gwsave", "/idbfs/SaveFile-Backup.gwsave"];
  function isSaveKey(key) {
    if (PROGRESS_FILES.includes(key)) return true;
    return typeof key === "string" && key.startsWith(OWN_DIR + "/") && !key.startsWith(OWN_DIR + "/Unity/");
  }

  // ---- reading Unity's PlayerPrefs file: "UnityPrf" header, then key / type / value entries ----
  function parsePrefs(b) {
    if (b.length < 16 || String.fromCharCode(...b.subarray(0, 8)) !== "UnityPrf") return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const dec = new TextDecoder();
    const out = [];
    let p = 16;
    const len = () => {
      const n = b[p++];
      if (n < 0x80) return n;
      if (n === 0x80) { const v = dv.getUint32(p, true); p += 4; return v; }
      throw new Error("unknown length byte");
    };
    try {
      while (p < b.length) {
        const kl = len();
        const key = dec.decode(b.subarray(p, p + kl));
        p += kl;
        const t = b[p];
        let val;
        if (t === 0xfe) { val = dv.getInt32(p + 1, true); p += 5; }
        else if (t === 0xfd) { val = Math.round(dv.getFloat32(p + 1, true) * 1000) / 1000; p += 5; }
        else { const sl = len(); val = dec.decode(b.subarray(p, p + sl)); p += sl; }
        if (p > b.length) return null;
        out.push([key, val]);
      }
    } catch {
      return null;
    }
    return out;
  }
  // Unity rewrites its "unity.*" values on every launch, so they don't count as a change (they are
  // still saved with everything else).
  const gameEntries = (prefs) => prefs.filter(([k]) => !k.startsWith("unity.")).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  // PlayerPrefs only holds settings. Progress lives in its own
  // files, so any file besides PlayerPrefs means there is progress worth keeping.
  function hasProgress(files) {
    return files.some((f) => f.name !== OWN_DIR.slice(7) + "/PlayerPrefs");
  }
  async function readSaveFiles() {
    let db;
    try {
      db = await openIdbfs();
    } catch {
      return [];
    }
    if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); return []; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readonly");
      const os = tx.objectStore("FILE_DATA");
      const req = os.getAllKeys();
      req.onsuccess = () => {
        // Only fetch this game's own files: the save database is shared by every game on the site, and
        // reading all of it on each save write made gameplay hitch.
        const keys = req.result.filter(isSaveKey);
        const out = [];
        let pending = keys.length;
        if (!pending) { db.close(); return resolve(out); }
        for (const key of keys) {
          const g = os.get(key);
          g.onsuccess = () => {
            const v = g.result;
            // only regular files have `.contents`; directory entries don't.
            if (v && v.contents && v.mode === FILE_MODE && isSaveKey(key)) {
              out.push({ name: key.replace(/^\/idbfs\//, ""), data: new Uint8Array(v.contents) });
            }
            if (--pending === 0) { db.close(); resolve(out); }
          };
          g.onerror = () => { if (--pending === 0) { db.close(); resolve(out); } };
        }
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }
  async function writeSaveFiles(files) {
    const db = await openIdbfs();
    if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); throw new Error("Load the game once first, then restore."); }
    await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const os = tx.objectStore("FILE_DATA");
      const dirs = new Set();
      for (const f of files) {
        const key = "/idbfs/" + f.name;
        // make sure every parent directory entry exists too (e.g. <dir>/Saves/Slot1)
        for (let i = key.indexOf("/", 7); i > 0; i = key.indexOf("/", i + 1)) dirs.add(key.slice(0, i));
        os.put({ timestamp: new Date(), mode: FILE_MODE, contents: f.data }, key);
      }
      for (const dir of dirs) {
        os.get(dir).onsuccess = (e) => {
          if (!e.target.result) os.put({ timestamp: new Date(), mode: DIR_MODE, contents: undefined }, dir);
        };
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  function rawBytes(files) {
    const total = files.reduce((a, f) => a + f.name.length + 1 + f.data.length + 1, 0);
    const buf = new Uint8Array(total);
    const enc = new TextEncoder();
    let pos = 0;
    for (const f of files.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const nb = enc.encode(f.name);
      buf.set(nb, pos); pos += nb.length; buf[pos++] = 0;
      buf.set(f.data, pos); pos += f.data.length; buf[pos++] = 10;
    }
    return buf;
  }
  async function hashFiles(files) {
    const canon = files.map((f) => {
      const prefs = parsePrefs(f.data);
      return prefs ? { name: f.name, data: new TextEncoder().encode(JSON.stringify(gameEntries(prefs))) } : f;
    });
    const buf = rawBytes(canon);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---- upload with change detection + debounce ----
  let uploadTimer = null;
  let uploading = false;
  let uploadQueued = false;
  let uploadDeadline = 0;
  let lastCheck = Date.now();
  let lastSyncSeen = 0;
  let lastUploadAt = 0;
  let lastResult = "";
  let statusEl = null;
  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  async function uploadSnapshot(manual) {
    if (uploading) { uploadQueued = true; return; }
    uploading = true;
    try {
      await migrated;
      const files = await readSaveFiles();
      if (!files.length) {
        if (manual) alert("No save to upload yet. Play until the game saves, then try again.");
        return;
      }
      const hash = await hashFiles(files);
      if (!manual && !hasProgress(files)) {
        lastCheck = Date.now();
        setStatus("cloud: waiting for your first save");
        return;
      }
      if (!manual && localStorage.getItem("inscryption-cloud-lasthash") === hash) {
        lastCheck = Date.now();
        lastResult = "unchanged";
        setStatus("cloud: up to date");
        updateSyncInfo();
        return;
      }
      const zip = buildZip(files);
      const resp = await fetch(`${API}/saves?u=${UID}${manual ? "&kind=manual" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: zip,
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      localStorage.setItem("inscryption-cloud-lasthash", hash);
      // Ask the browser not to clear this site's storage (the saves and the save code) when the
      // device runs low on space. Only asked once there is progress worth keeping.
      try { navigator.storage.persist().catch(() => {}); } catch {}
      lastCheck = Date.now();
      lastUploadAt = Date.now();
      lastSyncSeen = Date.now();
      lastResult = "uploaded";
      const at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      setStatus("cloud: saved " + at);
      toast((manual ? "Saved to cloud · " : "Game saved to cloud · ") + at);
      pulseButton();
      console.info("[cloudsave] uploaded snapshot,", zip.length, "bytes");
      if (panelOpen) refreshList();
    } catch (e) {
      setStatus("cloud: save failed");
      console.warn("[cloudsave] upload failed:", e);
    } finally {
      uploading = false;
      uploadDeadline = 0;
      if (uploadQueued) { uploadQueued = false; scheduleUpload(); }
    }
  }
  function scheduleUpload() {
    const now = Date.now();
    if (!uploadDeadline) uploadDeadline = now + 30000;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => uploadSnapshot(), Math.max(250, Math.min(DEBOUNCE_MS, uploadDeadline - now)));
  }

  function ago(t) {
    if (!t) return "never";
    const sec = Math.round((Date.now() - t) / 1000);
    return sec < 5 ? "just now" : sec < 60 ? sec + "s ago" : sec < 3600 ? Math.round(sec / 60) + " min ago" : Math.round(sec / 3600) + "h ago";
  }
  function updateSyncInfo() {
    const el = document.getElementById("cloudsave-sync");
    if (!el) return;
    let txt = "game save detected: " + ago(lastSyncSeen) + " · upload: " + ago(lastUploadAt);
    if (lastResult === "unchanged") txt += " (latest matched cloud copy)";
    el.textContent = txt;
  }

  // ---- catch the game's own save writes as they land in /idbfs ----
  let restoring = false;
  const origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const req = origPut.apply(this, arguments);
    try {
      if (!restoring && this.name === "FILE_DATA" && this.transaction.db.name === IDBFS_DB &&
          isSaveKey(key) && value && value.contents) {
        this.transaction.addEventListener("complete", () => {
          lastSyncSeen = Date.now();
          setStatus("cloud: game saved, uploading");
          scheduleUpload();
        });
      }
    } catch {}
    return req;
  };

  // ---- slow fallback check, and the first look at page load ----
  let lastSeenHash = null;
  async function pollTick() {
    if (uploading) return;
    try {
      const files = await readSaveFiles();
      if (!files.length) { setStatus("cloud: waiting for your first save"); return; }
      const hash = await hashFiles(files);
      if (hash !== lastSeenHash) {
        lastSeenHash = hash;
        scheduleUpload();
      } else if (statusEl && /^cloud: waiting/.test(statusEl.textContent)) {
        setStatus("cloud: ready");
      }
    } catch (e) {
      console.warn("[cloudsave] poll failed:", e);
    }
  }
  setInterval(pollTick, POLL_MS);
  pollTick();

  // ---- watchdog: if nothing was uploaded for 8 minutes despite a live save, save now ----
  const WATCHDOG_MS = 8 * 60 * 1000;
  setInterval(() => {
    if (uploading || Date.now() - lastCheck < WATCHDOG_MS) return;
    uploadSnapshot();
  }, 30000);

  // ---- restore ----
  async function restore(name) {
    if (!confirm("Replace the current save with this cloud snapshot? The page will reload.")) return;
    const resp = await fetch(`${API}/saves/${name}?u=${viewUID}`);
    if (!resp.ok) { alert("Could not fetch snapshot (HTTP " + resp.status + ")"); return; }
    const files = parseZip(new Uint8Array(await resp.arrayBuffer())).filter((f) => isSaveKey("/idbfs/" + f.name));
    if (!files.length) { alert("That snapshot has no game save in it."); return; }
    // Back up what's here first (skipped if it's already in the cloud), so a restore never loses it.
    clearTimeout(uploadTimer);
    await uploadSnapshot();
    restoring = true;
    await writeSaveFiles(files);
    localStorage.setItem("inscryption-cloud-lasthash", await hashFiles(files));
    location.reload();
  }

  // ---- toast + button pulse ----
  let toastTimer = null;
  function toast(text, opts) {
    opts = opts || {};
    let el = document.getElementById("cloudsave-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "cloudsave-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="cs-check">' + (opts.icon || "&#10003;") + '</span> ' + text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), opts.ms || 3500);
  }
  function pulseButton() {
    const b = document.getElementById("cloudsave-btn");
    if (!b) return;
    b.classList.remove("saved-pulse");
    void b.offsetWidth;
    b.classList.add("saved-pulse");
  }

  // ---- tiny UI: cloud button + panel (same look as the other games) ----
  let panelOpen = false;
  const css = `
    /* Game pages often center text or restyle buttons globally, so the panel sets its own type and resets. */
    #cloudsave-btn { position: fixed; right: 14px; bottom: 14px; z-index: 99990;
      width: 44px; height: 44px; padding: 0; margin: 0; border-radius: 13px;
      border: 1px solid rgba(238, 242, 246, .10); background: rgba(10, 19, 32, .82);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      color: #c9d2dc; cursor: pointer; font: 400 19px/1 system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .35);
      transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease; }
    #cloudsave-btn:hover { background: rgba(23, 34, 47, .95); color: #eef2f6; border-color: rgba(238, 242, 246, .18); transform: translateY(-1px); }
    #cloudsave-btn:active { transform: scale(.95); }
    #cloudsave-panel { position: fixed; right: 14px; bottom: 64px; z-index: 99991;
      width: 288px; max-width: calc(100vw - 28px); max-height: min(72vh, 560px); overflow: auto; overscroll-behavior: contain;
      border-radius: 14px; background: rgba(9, 17, 28, .97);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      color: #eef2f6; border: 1px solid rgba(238, 242, 246, .09);
      box-shadow: 0 18px 50px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .3);
      font: 400 13px/1.45 "Schibsted Grotesk", system-ui, sans-serif; text-align: left; letter-spacing: normal;
      padding: 2px 12px 12px; display: none; transform-origin: bottom right;
      animation: cs-in .18s cubic-bezier(.2, .8, .2, 1);
      scrollbar-width: thin; scrollbar-color: #2a3747 transparent; }
    @keyframes cs-in { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }
    #cloudsave-panel * { box-sizing: border-box; text-align: left; }
    #cloudsave-panel .cs-home { display: inline-flex; align-items: center; min-height: 34px; color: #7f8c9c; text-decoration: none;
      font: 500 11px/1 "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; transition: color .15s ease; }
    #cloudsave-panel .cs-home:hover { color: #eef2f6; }
    #cloudsave-panel h3 { margin: 0 0 2px; padding: 0; font: 700 15px/1.2 "Schibsted Grotesk", system-ui, sans-serif;
      letter-spacing: -.01em; color: #eef2f6; text-transform: none; }
    #cloudsave-panel .cs-status { color: #9aa6b4; font-size: 12px; margin: 0; }
    #cloudsave-panel #cloudsave-sync { color: #66727f; font-size: 11.5px; margin: 1px 0 10px; }
    #cloudsave-panel button { -webkit-appearance: none; appearance: none; margin: 0; min-height: 32px; padding: 0 12px;
      border: 1px solid rgba(238, 242, 246, .10); border-radius: 8px; background: rgba(238, 242, 246, .04); color: #eef2f6;
      font: 500 12px/1 "Schibsted Grotesk", system-ui, sans-serif; letter-spacing: normal; text-transform: none; white-space: nowrap; text-align: center;
      cursor: pointer; box-shadow: none; transition: background .15s ease, border-color .15s ease, transform .1s ease; }
    #cloudsave-panel button:hover { background: rgba(238, 242, 246, .09); border-color: rgba(238, 242, 246, .18); }
    #cloudsave-panel button:active { transform: scale(.97); }
    #cloudsave-panel #cloudsave-now { width: 100%; min-height: 34px; margin: 0 0 6px; background: #eef2f6; border-color: #eef2f6;
      color: #050b14; font-size: 13px; font-weight: 600; }
    #cloudsave-panel #cloudsave-now:hover { background: #fff; border-color: #fff; }
    #cloudsave-panel #cloudsave-now:disabled { opacity: .6; cursor: default; transform: none; }
    #cloudsave-panel .cs-row { display: flex; align-items: center; gap: 6px; margin: 0 -8px; padding: 8px; border-radius: 9px;
      transition: background .15s ease; }
    #cloudsave-panel .cs-row:hover { background: rgba(238, 242, 246, .04); }
    #cloudsave-panel .cs-row span { flex: 1; min-width: 0; line-height: 1.35; }
    #cloudsave-panel .cs-row b { font-weight: 600; font-size: 13px; }
    #cloudsave-panel .cs-row small { color: #7f8c9c; font-size: 11.5px; }
    #cloudsave-panel .cs-row button:last-child { width: 32px; padding: 0; font-size: 14px; }
    #cloudsave-panel .cs-empty { color: #7f8c9c; padding: 10px 0 4px; font-size: 12px; }
    #cloudsave-panel #cloudsave-code { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(238, 242, 246, .07); }
    #cloudsave-panel .cs-code-head { font: 500 11px/1 "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .06em;
      text-transform: uppercase; color: #9aa6b4; margin-bottom: 6px; }
    #cloudsave-panel .cs-code-hint { color: #7f8c9c; font-size: 12px; line-height: 1.5; margin-bottom: 10px; }
    #cloudsave-panel .cs-code-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    #cloudsave-panel .cs-code-row code { flex: 1; min-width: 0; font: 400 11px/1.4 "IBM Plex Mono", ui-monospace, monospace;
      color: #c9d2dc; background: rgba(0, 0, 0, .35); border: 1px solid rgba(238, 242, 246, .07);
      padding: 8px; border-radius: 8px; overflow-wrap: anywhere; user-select: all; }
    #cloudsave-panel #cloudsave-file, #cloudsave-panel #cloudsave-upload { flex: 1; }
    #cloudsave-panel #cloudsave-enter { width: 100%; background: transparent; border-style: dashed; color: #aab4c0; }
    #cloudsave-panel #cloudsave-enter:hover { color: #eef2f6; }
    #cloudsave-panel .cs-viewing { background: rgba(183, 166, 255, .08); border: 1px solid rgba(183, 166, 255, .22);
      border-radius: 9px; padding: 8px; margin: 4px 0 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    #cloudsave-panel .cs-viewing div { flex-basis: 100%; font-size: 12px; }
    #cloudsave-panel .cs-viewing code { font: 400 11px/1 "IBM Plex Mono", ui-monospace, monospace; }
    #cloudsave-toast { position: fixed; right: 14px; bottom: 64px; z-index: 99992; max-width: calc(100vw - 28px);
      background: rgba(9, 17, 28, .96); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      color: #eef2f6; border: 1px solid rgba(238, 242, 246, .09); border-radius: 10px; padding: 9px 14px;
      font: 500 13px/1.35 "Schibsted Grotesk", system-ui, sans-serif; text-align: left; letter-spacing: normal;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .4);
      opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none;
      transition: opacity .22s ease, transform .22s cubic-bezier(.2, .8, .2, 1); }
    #cloudsave-toast.show { opacity: 1; transform: none; }
    /* the panel already shows the save status, so a toast would only cover it */
    #cloudsave-panel[style*="block"] ~ #cloudsave-toast { opacity: 0; }
    #cloudsave-toast .cs-check { color: #b7a6ff; font-weight: 700; margin-right: 2px; }
    @keyframes cs-pulse {
      0% { box-shadow: 0 0 0 0 #b7a6ffb0; }
      100% { box-shadow: 0 0 0 14px #b7a6ff00; }
    }
    #cloudsave-btn.saved-pulse { animation: cs-pulse .9s ease-out 2; border-color: #b7a6ff; color: #eef2f6; }
    #cloudsave-btn:focus-visible, #cloudsave-panel button:focus-visible, #cloudsave-panel a:focus-visible { outline: 2px solid #b7a6ff; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      #cloudsave-panel { animation: none; }
      #cloudsave-toast { transition: none; }
      #cloudsave-btn, #cloudsave-panel button, #cloudsave-panel .cs-row { transition: none; }
      #cloudsave-btn.saved-pulse { animation: none; }
    }
`;
  function nameToDate(n) {
    const m = n.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])) : null;
  }
  function fmtWhen(n) {
    const d = nameToDate(n);
    if (!d) return { abs: n, rel: "" };
    const abs = d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    const rel = mins < 1 ? "just now"
      : mins < 60 ? `${mins} min ago`
      : mins < 1440 ? `${Math.round(mins / 60)}h ago`
      : `${Math.round(mins / 1440)}d ago`;
    return { abs, rel };
  }
  async function refreshList() {
    const list = document.getElementById("cloudsave-list");
    if (!list) return;
    try {
      const saves = await (await fetch(`${API}/saves?u=${viewUID}`)).json();
      list.innerHTML = "";
      if (viewUID !== UID) {
        const bar = document.createElement("div");
        bar.className = "cs-viewing";
        bar.innerHTML = '<div>Viewing saves for code <code>' + viewUID.slice(0, 8) + '&hellip;</code></div>';
        const back = document.createElement("button");
        back.textContent = "Back to mine";
        back.onclick = () => { viewUID = UID; refreshList(); };
        const adopt = document.createElement("button");
        adopt.textContent = "Make this my code";
        adopt.onclick = () => {
          if (!confirm("Use this code as YOUR save code from now on? It becomes your code for every game on this site, and your future autosaves go to it. (Use this to recover your own saves, not for a friend's code.)")) return;
          localStorage.setItem(SHARED_KEY, viewUID);
          localStorage.setItem(OWN_KEY, viewUID);
          fetch(`${API}/saves/pin?u=${viewUID}`, { method: "POST" }).catch(() => {});
          localStorage.removeItem("inscryption-cloud-lasthash");
          UID = viewUID;
          const cv = document.getElementById("cloudsave-code-val");
          if (cv) cv.textContent = UID;
          setStatus("cloud: code adopted");
          refreshList();
        };
        bar.append(back, adopt);
        list.appendChild(bar);
      }
      if (!saves.length) {
        list.innerHTML += '<div class="cs-empty">No cloud saves yet. Play until the game saves and one appears here.</div>';
        return;
      }
      for (const s of saves) {
        const row = document.createElement("div");
        row.className = "cs-row";
        const label = document.createElement("span");
        const when = fmtWhen(s.name);
        const kind = (s.pinned ? "kept · " : "") + (s.name.includes("-m.") ? "manual save" : "autosave");
        label.innerHTML = `<b>${when.abs}</b><br><small>${kind} · ${when.rel} · ${s.size < 1024 ? "under 1 KB" : Math.round(s.size / 1024) + " KB"}</small>`;
        const rBtn = document.createElement("button");
        rBtn.textContent = "Restore";
        rBtn.onclick = () => restore(s.name).catch((e) => alert("Restore failed: " + e.message));
        const dBtn = document.createElement("button");
        dBtn.textContent = "⤓";
        dBtn.title = "Download to computer";
        dBtn.setAttribute("aria-label", "Download to computer");
        dBtn.onclick = () => { location.href = `${API}/saves/${s.name}?u=${viewUID}`; };
        row.append(label, rBtn, dBtn);
        list.appendChild(row);
      }
    } catch (e) {
      list.innerHTML = '<div class="cs-empty">Could not load cloud saves. Close this panel and open it again to retry.</div>';
    }
  }
  function buildUi() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    if (!document.querySelector("link[data-gl-fonts]")) {
      const fonts = document.createElement("link");
      fonts.rel = "stylesheet"; fonts.href = "/fonts/site.css"; fonts.setAttribute("data-gl-fonts", "");
      document.head.appendChild(fonts);
    }
    const btn = document.createElement("button");
    btn.id = "cloudsave-btn";
    btn.title = "Cloud saves";
    btn.setAttribute("aria-label", "Cloud saves");
    btn.textContent = "☁";
    const panel = document.createElement("div");
    panel.id = "cloudsave-panel";
    panel.innerHTML = '<a class="cs-home" href="/games">← Arcade</a><h3>Cloud saves</h3><div class="cs-status" id="cloudsave-status">cloud: waiting for game</div>' +
      '<div class="cs-status" id="cloudsave-sync"></div>' +
      '<button id="cloudsave-now">Save to cloud now</button><div id="cloudsave-list"></div>' +
      '<div id="cloudsave-code"><div class="cs-code-head">Save code</div>' +
      '<div class="cs-code-hint">One code holds your saves for every game here, and it stays saved in this browser. Download it as a file to keep a copy, then upload that file if a browser ever forgets you. A friend can enter your code to grab a copy of your save.</div>' +
      '<div class="cs-code-row"><code id="cloudsave-code-val"></code><button id="cloudsave-copy">Copy</button></div>' +
      '<div class="cs-code-row"><button id="cloudsave-file">Download code file</button><button id="cloudsave-upload">Upload code file</button></div>' +
      '<button id="cloudsave-enter">Enter a save code&hellip;</button></div>';
    const setPanel = (open) => {
      panelOpen = open;
      panel.style.display = open ? "block" : "none";
      if (open) { refreshList(); updateSyncInfo(); }
    };
    const dropFocus = () => {
      const el = document.activeElement;
      if (el && el !== document.body && (btn.contains(el) || panel.contains(el))) el.blur();
    };
    btn.onclick = () => { setPanel(!panelOpen); btn.blur(); };
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (panel.contains(t) || btn.contains(t)) return;
      dropFocus();
      if (panelOpen) setPanel(false);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (panelOpen || (e.key !== " " && e.key !== "Enter")) return;
      dropFocus();
    }, true);
    setInterval(() => { if (panelOpen) updateSyncInfo(); }, 5000);
    document.body.append(btn, panel);
    setTimeout(() => toast("Your progress saves to the cloud automatically", { icon: "&#9729;", ms: 5500 }), 1500);
    statusEl = document.getElementById("cloudsave-status");
    document.getElementById("cloudsave-now").onclick = async () => {
      const b = document.getElementById("cloudsave-now");
      b.disabled = true; b.textContent = "Saving…";
      clearTimeout(uploadTimer);
      await uploadSnapshot(true);
      b.disabled = false; b.textContent = "Save to cloud now";
      refreshList();
    };
    document.getElementById("cloudsave-code-val").textContent = UID;
    document.getElementById("cloudsave-copy").onclick = async () => {
      const b = document.getElementById("cloudsave-copy");
      try {
        await navigator.clipboard.writeText(UID);
        b.textContent = "Copied!";
      } catch {
        prompt("Copy your save code:", UID);
        b.textContent = "Copy";
        return;
      }
      setTimeout(() => { b.textContent = "Copy"; }, 2000);
    };
    document.getElementById("cloudsave-enter").onclick = async () => {
      const code = (prompt("Paste a save code (yours to recover, or a friend's to borrow their save):") || "").trim().toLowerCase();
      if (!code) return;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(code)) {
        alert("That doesn't look like a valid save code.");
        return;
      }
      viewUID = code;
      refreshList();
    };

    // ---- the save code as a file, so nobody has to copy it by hand ----
    function downloadCodeFile() {
      const text = "neekoras.com save code\n" + UID + "\n\nKeep this file. If a browser ever forgets your saves, open any game on neekoras.com, click the cloud button and choose Upload code file.\n";
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "neekoras-save-code.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    document.getElementById("cloudsave-file").onclick = downloadCodeFile;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,text/plain";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    document.getElementById("cloudsave-upload").onclick = () => { fileInput.value = ""; fileInput.click(); };
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const m = (await f.text()).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (!m) { alert("No save code found in that file."); return; }
      const code = m[0].toLowerCase();
      if (code === UID) { toast("That is already your save code"); return; }
      if (!confirm("Use the save code from this file from now on? Your saves for every game on this site come back with it.")) return;
      localStorage.setItem(SHARED_KEY, code);
      localStorage.setItem(OWN_KEY, code);
      localStorage.setItem(CODE_FILE_KEY, "done");
      fetch(`${API}/saves/pin?u=${code}`, { method: "POST" }).catch(() => {});
      localStorage.removeItem(LASTHASH_KEY);
      UID = code;
      viewUID = code;
      const cv = document.getElementById("cloudsave-code-val");
      if (cv) cv.textContent = UID;
      setStatus("cloud: code restored from file");
      toast("Save code restored. Click Restore on a save to load it.", { icon: "&#9729;", ms: 7000 });
      refreshList();
    };
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUi);
  } else {
    buildUi();
  }
})();
