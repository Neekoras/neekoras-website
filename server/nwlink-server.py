#!/usr/bin/env python3
"""Hands the NumWorks installer page each game linked for the calculator that is plugged in.

GET /link?app=NumPlay.nwa&at=0x90160000&end=0x903f0000&ram=0x24014a98&ramend=0x24037000&tramp=0x90020030
returns the flat image to write at `at`. Images are cached on disk, since only a few layouts exist.
"""
import hashlib, json, os, subprocess, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

RELEASE = "/var/www/neekoras.com/games/numworks/release"
CACHE = "/var/cache/nwlink"
LINKER = "/opt/neekoras/nwlinker.py"

def apps():
    d = json.load(open(f"{RELEASE}/games.json"))
    return {d["numplay"]["file"]} | {g["file"] for g in d["big"]}

def num(q, k, lo, hi):
    v = int(q[k][0], 16)
    if not lo <= v < hi:
        raise ValueError(k)
    return v

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/link":
            return self.fail(404, "not found")
        try:
            q = parse_qs(u.query)
            app = q["app"][0]
            if app not in apps():
                raise ValueError("app")
            at, end = num(q, "at", 0x90000000, 0x91000000), num(q, "end", 0x90000000, 0x91000001)
            ram, ramend = num(q, "ram", 0x20000000, 0x25000000), num(q, "ramend", 0x20000000, 0x25000001)
            tramp = num(q, "tramp", 0x90000000, 0x91000000)
            if at % 0x10000 or at >= end or ram >= ramend:
                raise ValueError("range")
        except (KeyError, ValueError, IndexError):
            return self.fail(400, "bad request")
        src = f"{RELEASE}/files/{app}"
        key = hashlib.sha256(f"{app}:{os.path.getmtime(src)}:{at}:{end}:{ram}:{ramend}:{tramp}".encode()).hexdigest()
        out = f"{CACHE}/{key}.bin"
        if not os.path.exists(out):
            fd, tmp = tempfile.mkstemp(dir=CACHE)
            os.close(fd)
            r = subprocess.run(["python3", LINKER, src] + [hex(v) for v in (at, end, ram, ramend, tramp)] + [tmp],
                               capture_output=True, text=True)
            if r.returncode:
                os.unlink(tmp)
                self.log_message("link failed for %s: %s", app, r.stderr.strip()[-300:])
                return self.fail(422, "does not fit")
            os.replace(tmp, out)
        data = open(out, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def fail(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(msg.encode())

if __name__ == "__main__":
    os.makedirs(CACHE, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", 9102), H).serve_forever()
