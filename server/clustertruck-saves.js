// Clustertruck cloud-save service for neekoras.com
// Stores per-user save snapshots (zip blobs) in a SQLite DB, keeps the newest
// KEEP per user, prunes the rest. Proxied by nginx at /games/clustertruck/api/ -> /.
//
//   GET    /saves?u=<uuid>          -> JSON list [{name, size, time}]
//   POST   /saves?u=<uuid>          -> body is a zip; stored as <utc-stamp>.zip
//   GET    /saves/<name>?u=<uuid>   -> the zip (attachment)
//   POST   /saves/adopt?u=<uuid>&from=<uuid> -> copy snapshots to the shared code
//   POST   /saves/pin?u=<uuid>      -> never prune the newest snapshot

const http = require("http");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 9096;
const HOST = "127.0.0.1";
const DB_PATH = "/var/lib/clustertruck-saves/saves.db";
const KEEP = 10;
const MAX_BODY = 25 * 1024 * 1024; // 25MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_RE = /^\d{8}T\d{6}\d{3}(-m)?\.zip$/;

fs.mkdirSync("/var/lib/clustertruck-saves", { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS saves (
  uid  TEXT NOT NULL,
  name TEXT NOT NULL,
  time TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (uid, name)
)`);
// Pinned ("kept") snapshots are never pruned. When a game switches to a save code that already
// holds saves for it, the newest one is pinned, so a fresh local game autosaving under that code
// can never push the real progress out.
if (!db.prepare("SELECT 1 FROM pragma_table_info('saves') WHERE name = 'pinned'").get()) {
  db.exec("ALTER TABLE saves ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}
const MAX_PINNED = 5;

const stListSaves = db.prepare(
  "SELECT name, length(data) AS size, time, pinned FROM saves WHERE uid = ? ORDER BY name DESC");
const stGetSave = db.prepare("SELECT data FROM saves WHERE uid = ? AND name = ?");
const stInsert = db.prepare("INSERT OR REPLACE INTO saves (uid, name, time, data) VALUES (?, ?, ?, ?)");
const stPrune = db.prepare(
  `DELETE FROM saves WHERE uid = ? AND pinned = 0 AND name NOT IN
     (SELECT name FROM saves WHERE uid = ? ORDER BY name DESC LIMIT ?)`);

// Copy, not move: an old code someone wrote down keeps working.
const stCopy = db.prepare("INSERT OR IGNORE INTO saves (uid, name, time, data) SELECT ?, name, time, data FROM saves WHERE uid = ?");
const stPinNewest = db.prepare("UPDATE saves SET pinned = 1 WHERE uid = ? AND name = (SELECT max(name) FROM saves WHERE uid = ?)");
const stUnpinOld = db.prepare(
  `UPDATE saves SET pinned = 0 WHERE uid = ? AND pinned = 1 AND name NOT IN
     (SELECT name FROM saves WHERE uid = ? AND pinned = 1 ORDER BY name DESC LIMIT ?)`);
function pinNewest(u) {
  stPinNewest.run(u, u);
  stUnpinOld.run(u, u, MAX_PINNED);
}

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || body instanceof Uint8Array;
  const data = isBuf ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": isBuf ? "application/zip" : "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(Buffer.from(data));
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, "$1"); // 20260825T014455123
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const u = url.searchParams.get("u") || "";
  if (!UUID_RE.test(u)) return send(res, 400, { error: "bad or missing user id" });

  const parts = url.pathname.split("/").filter(Boolean); // ["saves"] or ["saves", name]
  if (parts[0] !== "saves") return send(res, 404, { error: "not found" });

  // GET /saves -> list
  if (req.method === "GET" && parts.length === 1) {
    return send(res, 200, stListSaves.all(u));
  }

  // GET /saves/<name> -> download
  if (req.method === "GET" && parts.length === 2) {
    const name = parts[1];
    if (!NAME_RE.test(name)) return send(res, 400, { error: "bad name" });
    const row = stGetSave.get(u, name);
    if (!row) return send(res, 404, { error: "not found" });
    return send(res, 200, row.data, {
      "Content-Disposition": `attachment; filename="clustertruck-${name}"`,
    });
  }

  // POST /saves -> store snapshot, prune to KEEP
  if (req.method === "POST" && parts.length === 1) {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, { error: "too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const body = Buffer.concat(chunks);
      if (body.length < 22 || body[0] !== 0x50 || body[1] !== 0x4b) {
        return send(res, 400, { error: "not a zip" });
      }
      const manual = url.searchParams.get("kind") === "manual";
      const name = `${stamp()}${manual ? "-m" : ""}.zip`;
      stInsert.run(u, name, new Date().toISOString(), body);
      stPrune.run(u, u, KEEP);
      return send(res, 200, { ok: true, name, kept: stListSaves.all(u).map((s) => s.name) });
    });
    return;
  }

  // POST /saves/adopt?u=<shared>&from=<old> -> copy this game's snapshots from an old code to
  // the shared code (one code for every game on the site). Only when the shared code has none
  // for this game yet, so it never mixes two save histories. If it already has some, pin the
  // newest so this browser's local game can't push it out.
  if (req.method === "POST" && parts.length === 2 && parts[1] === "adopt") {
    const from = url.searchParams.get("from") || "";
    if (!UUID_RE.test(from) || from === u) return send(res, 400, { error: "bad from" });
    if (stListSaves.all(u).length) {
      pinNewest(u);
      return send(res, 200, { copied: 0, existing: true });
    }
    const copied = Number(stCopy.run(u, from).changes);
    return send(res, 200, { copied, existing: false });
  }

  // POST /saves/pin?u=<uuid> -> keep the newest snapshot forever (used when adopting a code)
  if (req.method === "POST" && parts.length === 2 && parts[1] === "pin") {
    pinNewest(u);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, HOST, () =>
  console.log(`clustertruck-saves listening on ${HOST}:${PORT}, db=${DB_PATH}, keep=${KEEP}`));
