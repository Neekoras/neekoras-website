#!/usr/bin/env python3
"""Mirror the latest NumPlay release (NumWorks calculator games) into the arcade.

Downloads the .nwa files and thumbnails to /var/www/neekoras.com/games/numworks/release/, makes a source
archive (NumPlay is GPL-3.0, so its source is offered next to the files), and writes games.json for
the "Have a NumWorks?" section of games.html.  Run with sudo:  sudo python3 ~/update-numworks.py
"""
import html, json, os, re, shutil, subprocess, tempfile, urllib.request

REPO = "Mason363/NumPlay"
OUT = "/var/www/neekoras.com/games/numworks/release"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "neekoras-numworks-mirror"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

rel = json.loads(get(f"https://api.github.com/repos/{REPO}/releases/latest"))
tag = rel["tag_name"]
assets = {a["name"]: a for a in rel["assets"]}
readme = get(f"https://raw.githubusercontent.com/{REPO}/{tag}/README.md").decode()

def section(title):
    start = readme.index(title)
    nxt = readme.find("\n## ", start + 3)
    return readme[start: nxt if nxt != -1 else None]

# Games bundled in NumPlay.nwa: the alt text of each thumbnail in "Games in NumPlay".
bundled = [html.unescape(t) for t in re.findall(r'alt="([^"]+)"', section("## Games in NumPlay"))]

# Big games: each <td> has a thumbnail, a title, a one-line description and a download link.
big = []
for td in re.findall(r"<td[^>]*>(.*?)</td>", section("## Big games"), re.S):
    m = re.search(r'src="(docs/media/thumb_[a-z0-9_]+\.png)".*?<b>(.*?)</b>.*?<sub>(.*?)</sub>.*?/download/([A-Za-z0-9_-]+\.nwa)', td, re.S)
    if m:
        thumb, title, desc, file = m.groups()
        big.append({"title": html.unescape(title), "desc": html.unescape(desc), "file": file, "thumb": thumb})
if len(big) < 10 or not bundled:
    raise SystemExit(f"README layout changed (found {len(big)} big games, {len(bundled)} bundled); not updating")

stage = tempfile.mkdtemp(prefix="numworks-")
os.makedirs(f"{stage}/files"); os.makedirs(f"{stage}/img")
def fetch_asset(name):
    data = get(assets[name]["browser_download_url"])
    open(f"{stage}/files/{name}", "wb").write(data)
    return len(data)

numplay = {"file": "NumPlay.nwa", "size": fetch_asset("NumPlay.nwa"), "games": bundled}
upsilon = {"file": "NumPlay-Upsilon.nwa", "size": fetch_asset("NumPlay-Upsilon.nwa")} if "NumPlay-Upsilon.nwa" in assets else None
for g in big:
    g["size"] = fetch_asset(g["file"])
    img = os.path.basename(g["thumb"])
    open(f"{stage}/img/{img}", "wb").write(get(f"https://raw.githubusercontent.com/{REPO}/{tag}/{g['thumb']}"))
    g["thumb"] = "img/" + img

# Bytes each app takes on the calculator once linked (the installer page plans the space with this).
def flash_size(name):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["python3", "/opt/neekoras/nwlinker.py", f"{stage}/files/{name}", "0x90000000", "0x90800000",
                        "0x24000000", "0x24040000", "0x90000000", tmp + "/a.bin"], check=True)
        return os.path.getsize(tmp + "/a.bin")

numplay["flash"] = flash_size(numplay["file"])
for g in big:
    g["flash"] = flash_size(g["file"])

# Source archive of the same release, without the demo GIFs (GPL-3.0 asks for the source to be offered).
src = f"NumPlay-{tag}-source.tar.gz"
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", tag, f"https://github.com/{REPO}.git", tmp + "/r"], check=True)
    subprocess.run(["git", "-C", tmp + "/r", "archive", "--format=tar.gz", "-o", f"{stage}/files/{src}", "HEAD", "--", ".", ":(exclude)docs/media"], check=True)

json.dump({"version": tag.lstrip("v"), "released": rel["published_at"][:10], "numplay": numplay, "upsilon": upsilon,
           "big": big, "source": "files/" + src, "license": "GPL-3.0"}, open(f"{stage}/games.json", "w"), indent=1)

if os.path.exists(OUT):
    shutil.rmtree(OUT)
shutil.move(stage, OUT)
subprocess.run(["chown", "-R", "www-data:www-data", OUT], check=True)
subprocess.run(["chmod", "-R", "a+rX", OUT], check=True)
print(f"NumPlay {tag}: {len(bundled)} games in NumPlay.nwa, {len(big)} big games -> {OUT}")
