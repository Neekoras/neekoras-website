// Game request box for neekoras.com/games. Proxied by nginx at /games/api/requests.
//
//   POST /requests            body {game, note, website}  -> {ok: true}
//   GET  /requests?key=<key>  -> private HTML list of requests, most asked first
//
// "website" is a hidden honeypot field: real visitors never fill it in.
// Visitor IPs are never stored; only a salted hash is kept in memory for rate limiting.

const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = 9095;
const HOST = "127.0.0.1";
const DIR = "/var/lib/arcade-requests";
const ADMIN_KEY = fs.readFileSync(DIR + "/admin.key", "utf8").trim();
const PER_VISITOR_PER_HOUR = 5;
const PER_DAY_TOTAL = 300;
const MAX_BODY = 4096;

const db = new DatabaseSync(DIR + "/requests.db");
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS requests (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  game TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
)`);
const stInsert = db.prepare("INSERT INTO requests (time, game, note) VALUES (?, ?, ?)");
const stToday = db.prepare("SELECT count(*) AS n FROM requests WHERE time >= ?");
const stAll = db.prepare("SELECT time, game, note FROM requests ORDER BY id DESC LIMIT 500");

const salt = crypto.randomBytes(16);
const recent = new Map(); // visitor hash -> timestamps in the last hour
function allowed(ip) {
  const key = crypto.createHash("sha256").update(salt).update(ip).digest("hex");
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 3600e3);
  if (list.length >= PER_VISITOR_PER_HOUR) return false;
  list.push(now);
  recent.set(key, list);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of recent) if (!list.some((t) => now - t < 3600e3)) recent.delete(k);
}, 600e3).unref();

const clean = (s, max) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function keyOk(k) {
  const a = Buffer.from(String(k || ""));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store" });
  res.end(data);
}

function adminPage() {
  const rows = stAll.all();
  const counts = new Map();
  for (const r of rows) {
    const k = r.game.toLowerCase();
    const c = counts.get(k) || { name: r.game, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n);
  const fmt = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Game requests</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;background:#f3efe6;color:#18160f;max-width:760px;margin:0 auto;padding:32px 16px}
h1{font:400 40px Georgia,serif;margin:0 0 4px}h2{font:400 24px Georgia,serif;margin:32px 0 8px}
p.m{color:#8a8375;margin:0 0 16px}table{width:100%;border-collapse:collapse}
td{padding:8px 6px;border-top:1px solid #d9d2c4;vertical-align:top}td.n{text-align:right;color:#a2492f;font-weight:600;width:3em}
td.t{color:#8a8375;white-space:nowrap;width:9em}.note{color:#3a362c}
</style></head><body>
<h1>Game requests</h1><p class="m">${rows.length} total. Newest first below.</p>
<h2>Most asked for</h2><table>${top.map((c) => `<tr><td>${esc(c.name)}</td><td class="n">${c.n}</td></tr>`).join("") || "<tr><td>None yet.</td></tr>"}</table>
<h2>All requests</h2><table>${rows.map((r) => `<tr><td class="t">${esc(fmt(r.time))}</td><td><b>${esc(r.game)}</b>${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</td></tr>`).join("") || "<tr><td>None yet.</td></tr>"}</table>
</body></html>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/requests") return json(res, 404, { error: "not found" });

  if (req.method === "GET") {
    if (!keyOk(url.searchParams.get("key"))) return json(res, 404, { error: "not found" });
    const html = adminPage();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    return res.end(html);
  }

  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
  let body = "";
  let tooBig = false;
  req.on("data", (c) => {
    body += c;
    if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
  });
  req.on("end", () => {
    if (tooBig) return json(res, 413, { error: "too large" });
    let data;
    try { data = JSON.parse(body); } catch { return json(res, 400, { error: "bad request" }); }
    if (clean(data.website, 100)) return json(res, 200, { ok: true }); // bot filled the honeypot: pretend it worked
    const game = clean(data.game, 80);
    const note = clean(data.note, 400);
    if (game.length < 2) return json(res, 400, { error: "Tell us which game." });
    const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "");
    if (!allowed(ip)) return json(res, 429, { error: "That's a lot of requests. Try again in a bit." });
    const dayStart = new Date(Date.now() - 864e5).toISOString();
    if (stToday.get(dayStart).n >= PER_DAY_TOTAL) return json(res, 429, { error: "The request box is full for today. Try again tomorrow." });
    stInsert.run(new Date().toISOString(), game, note);
    return json(res, 200, { ok: true });
  });
}).listen(PORT, HOST, () => console.log(`arcade-requests listening on ${HOST}:${PORT}`));
