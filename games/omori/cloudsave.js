/*
 * Cloud saves for OMORI (RPG Maker MV) on neekoras.com.
 *
 * The game keeps its save slots ("RPG File1", "RPG File2", ...), its global and config data, and a
 * few extra files (title screen state, seen cutscenes) as text in this site's localStorage. We hook
 * localStorage.setItem to catch the moment the game saves, and upload a snapshot (a STORE zip, same
 * format as the other games, one entry per key) to /games/omori/api/, keeping the newest 10 per save
 * code. Restore writes the keys back and reloads so the game reads them on startup.
 */
(function () {
  const API = "https://neekoras.com/games/omori/api";
  const POLL_MS = 30000; // fallback only; the put hook below is the real trigger
  const DEBOUNCE_MS = 1500;

  // ---- anonymous per-browser identity ----
  // One save code is shared by every game on neekoras.com (they share this origin's storage).
  const SHARED_KEY = "neekoras-save-code";
  const CODE_FILE_KEY = "neekoras-save-code-file"; // "pending" until the code file has been downloaded
  const LASTHASH_KEY = "omori-cloud-lasthash";
  const OWN_KEY = "omori-cloud-uid"; // the code this game used before codes were shared
  const GAME_KEYS = ["hollow-knight-cloud-uid", "celeste-cloud-uid", "pokerogue-cloud-uid", "clustertruck-cloud-uid", "omori-cloud-uid", "ultrakill-cloud-uid"];
  const isCode = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  let OWN = null;
  function userId() {
    try {
      OWN = localStorage.getItem(OWN_KEY);
      let id = localStorage.getItem(SHARED_KEY);
      if (!isCode(id)) {
        id = GAME_KEYS.map((k) => localStorage.getItem(k)).find(isCode);
        if (!id) { id = crypto.randomUUID(); localStorage.setItem(CODE_FILE_KEY, "pending"); }
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

  // ---- reading/writing the game's save straight out of localStorage ----
  // RPG Maker's save slots, global and config data (but not the "...bak" copies it makes for a
  // moment while saving), plus OMORI's extra files written through DataManager.writeToFile and the
  // seen-cutscenes list.
  function isSaveKey(key) {
    return typeof key === "string" &&
      (/^RPG (File\d+|Global|Config)$/.test(key) || key.startsWith("__DATAMANAGER_WRITE_TO_FILE/") || key.startsWith("OMORI_DATA/"));
  }
  function hasProgress(files) {
    return files.some((f) => /^RPG File\d+$/.test(f.name));
  }
  async function readSaveFiles() {
    const enc = new TextEncoder();
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isSaveKey(key)) continue;
      const v = localStorage.getItem(key);
      if (v != null) out.push({ name: key, data: enc.encode(v) });
    }
    return out;
  }
  async function writeSaveFiles(files) {
    const dec = new TextDecoder();
    for (const f of files) origSetItem.call(localStorage, f.name, dec.decode(f.data));
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
    const buf = rawBytes(files);
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
        if (manual) alert("No save to upload yet. Save your game in OMORI first, then try again.");
        return;
      }
      const hash = await hashFiles(files);
      if (!manual && !hasProgress(files)) {
        lastCheck = Date.now();
        setStatus("cloud: waiting for your first save");
        return;
      }
      if (!manual && localStorage.getItem("omori-cloud-lasthash") === hash) {
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
      localStorage.setItem("omori-cloud-lasthash", hash);
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

  // ---- catch the game's own save writes as they land in localStorage ----
  let restoring = false;
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    const r = origSetItem.apply(this, arguments);
    try {
      if (!restoring && this === localStorage && isSaveKey(key)) {
        lastSyncSeen = Date.now();
        setStatus("cloud: game saved, uploading");
        scheduleUpload();
      }
    } catch {}
    return r;
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
    const files = parseZip(new Uint8Array(await resp.arrayBuffer())).filter((f) => isSaveKey(f.name));
    if (!files.length) { alert("That snapshot has no game save in it."); return; }
    // Back up what's here first (skipped if it's already in the cloud), so a restore never loses it.
    clearTimeout(uploadTimer);
    await uploadSnapshot();
    restoring = true;
    await writeSaveFiles(files);
    localStorage.setItem("omori-cloud-lasthash", await hashFiles(files));
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
    #cloudsave-btn { position: fixed; right: 14px; bottom: 14px; z-index: 99990;
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid #4448;
      background: #1c1c28e6; color: #cdd3ff; cursor: pointer; font-size: 22px;
      display: flex; align-items: center; justify-content: center; }
    #cloudsave-btn:hover { background: #262638; }
    #cloudsave-panel { position: fixed; right: 14px; bottom: 66px; z-index: 99991;
      width: 300px; max-height: 60vh; overflow: auto; border-radius: 10px;
      background: #16161ff2; color: #e6e6f0; border: 1px solid #4448;
      font: 13px/1.45 system-ui, sans-serif; padding: 12px; display: none; }
    #cloudsave-panel h3 { margin: 0 0 2px; font-size: 14px; }
    #cloudsave-panel .cs-status { color: #9aa; margin-bottom: 8px; }
    #cloudsave-panel .cs-row { display: flex; align-items: center; gap: 6px;
      padding: 6px 0; border-top: 1px solid #ffffff14; }
    #cloudsave-panel .cs-row span { flex: 1; }
    #cloudsave-panel button { border: 1px solid #4448; background: #262638;
      color: #e6e6f0; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 12px; }
    #cloudsave-panel button:hover { background: #33334a; }
    #cloudsave-panel .cs-empty { color: #889; padding: 6px 0; }
    #cloudsave-panel #cloudsave-now { width: 100%; margin-bottom: 8px;
      background: #2c3e5a; border-color: #4a6a94; font-weight: 600; }
    #cloudsave-panel #cloudsave-now:hover { background: #37507a; }
    #cloudsave-panel #cloudsave-now:disabled { opacity: .6; cursor: default; }
    #cloudsave-panel .cs-row small { color: #99a; }
    #cloudsave-panel #cloudsave-code { border-top: 1px solid #ffffff22; margin-top: 10px; padding-top: 8px; }
    #cloudsave-panel .cs-code-head { font-weight: 600; margin-bottom: 2px; }
    #cloudsave-panel .cs-code-hint { color: #99a; font-size: 12px; margin-bottom: 6px; }
    #cloudsave-panel .cs-code-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    #cloudsave-panel .cs-code-row code { flex: 1; font-size: 10.5px; background: #0d0d14;
      padding: 4px 6px; border-radius: 5px; overflow-wrap: anywhere; user-select: all; }
    #cloudsave-panel #cloudsave-enter { width: 100%; }
    #cloudsave-panel .cs-viewing { background: #2a2438; border: 1px solid #55488a;
      border-radius: 6px; padding: 6px 8px; margin-bottom: 6px;
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    #cloudsave-panel .cs-viewing code { font-size: 11px; }
    #cloudsave-toast { position: fixed; right: 14px; bottom: 70px; z-index: 99992;
      background: #1d2b1de8; color: #b8e6b8; border: 1px solid #3a5a3a;
      border-radius: 8px; padding: 8px 14px; font: 13px system-ui, sans-serif;
      opacity: 0; transform: translateY(8px); pointer-events: none;
      transition: opacity .3s ease, transform .3s ease; }
    #cloudsave-toast.show { opacity: 1; transform: translateY(0); }
    #cloudsave-toast .cs-check { color: #7fd97f; font-weight: 700; }
    @keyframes cs-pulse {
      0% { box-shadow: 0 0 0 0 #7fd97fb0; }
      100% { box-shadow: 0 0 0 14px #7fd97f00; }
    }
    #cloudsave-btn.saved-pulse { animation: cs-pulse .9s ease-out 2; border-color: #7fd97f; }
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
          localStorage.removeItem("omori-cloud-lasthash");
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
        list.innerHTML += '<div class="cs-empty">No cloud saves yet. Save your game in OMORI and one appears here.</div>';
        return;
      }
      for (const s of saves) {
        const row = document.createElement("div");
        row.className = "cs-row";
        const label = document.createElement("span");
        const when = fmtWhen(s.name);
        const kind = (s.pinned ? "kept · " : "") + (s.name.includes("-m.") ? "manual save" : "autosave");
        label.innerHTML = `<b>${when.abs}</b><br><small>${kind} · ${when.rel} · ${(s.size / 1024).toFixed(0)}KB</small>`;
        const rBtn = document.createElement("button");
        rBtn.textContent = "Restore";
        rBtn.onclick = () => restore(s.name).catch((e) => alert("Restore failed: " + e.message));
        const dBtn = document.createElement("button");
        dBtn.textContent = "⤓";
        dBtn.title = "Download to computer";
        dBtn.onclick = () => { location.href = `${API}/saves/${s.name}?u=${viewUID}`; };
        row.append(label, rBtn, dBtn);
        list.appendChild(row);
      }
    } catch (e) {
      list.innerHTML = '<div class="cs-empty">Could not load cloud saves.</div>';
    }
  }
  function buildUi() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const btn = document.createElement("button");
    btn.id = "cloudsave-btn";
    btn.title = "Cloud saves";
    btn.textContent = "☁";
    const panel = document.createElement("div");
    panel.id = "cloudsave-panel";
    panel.innerHTML = '<h3>Cloud saves</h3><div class="cs-status" id="cloudsave-status">cloud: waiting for game</div>' +
      '<div class="cs-status" id="cloudsave-sync"></div>' +
      '<button id="cloudsave-now">Save to cloud now</button><div id="cloudsave-list"></div>' +
      '<div id="cloudsave-code"><div class="cs-code-head">Save code</div>' +
      '<div class="cs-code-hint">This one code holds your saves for every game on this site. A file with it was downloaded on your first visit; keep that file. If a browser forgets you, upload the file here and your saves come back. You can also give the code to a friend so they can grab a copy of your save.</div>' +
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
    // A brand new code is downloaded on the first click or key press (browsers block downloads before that).
    if (localStorage.getItem(CODE_FILE_KEY) === "pending") {
      const first = () => {
        if (localStorage.getItem(CODE_FILE_KEY) !== "pending") return;
        localStorage.setItem(CODE_FILE_KEY, "done");
        downloadCodeFile();
        setTimeout(() => toast("Your save code was saved to your Downloads folder. Keep that file.", { icon: "&#9729;", ms: 8000 }), 800);
      };
      document.addEventListener("pointerdown", first, { once: true, capture: true });
      document.addEventListener("keydown", first, { once: true, capture: true });
    }
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
