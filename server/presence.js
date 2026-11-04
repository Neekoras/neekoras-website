// Live viewer count for neekoras.com.
//
// Each open page sends a heartbeat with an anonymous id it made up in the
// browser; a viewer counts as present for TTL ms after their last heartbeat.
// Everything lives in memory, so a restart just resets the count. No IPs, no
// user agents, no paths, nothing written to disk.
//
//   GET /presence?id=<uuid>  -> { count }
//
// Proxied by nginx at /api/presence.

const http = require("http");

const PORT = 9093;
const HOST = "127.0.0.1";
const TTL = 45 * 1000; // a heartbeat keeps a viewer "here" for this long
const MAX = 20000; // hard cap so a flood can't grow the map forever
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @type {Map<string, number>} anonymous id -> last heartbeat (ms) */
const seen = new Map();

function prune() {
  const cutoff = Date.now() - TTL;
  for (const [id, t] of seen) {
    if (t < cutoff) seen.delete(id);
  }
}
setInterval(prune, 15000).unref?.();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    const data = JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Cache-Control": "no-store",
    });
    res.end(data);
  };

  if (url.pathname !== "/presence") return send(404, { error: "not found" });
  if (req.method !== "GET") return send(405, { error: "method not allowed" });

  const id = url.searchParams.get("id") || "";
  prune();
  if (UUID_RE.test(id) && (seen.has(id) || seen.size < MAX)) {
    seen.set(id, Date.now());
  }
  send(200, { count: seen.size });
});

server.listen(PORT, HOST, () => console.log(`presence listening on ${HOST}:${PORT}, ttl=${TTL}ms`));
