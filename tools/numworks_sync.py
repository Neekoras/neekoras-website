#!/usr/bin/env python3
"""Brings the NumWorks page's game catalog up to date with a NumPlay release.

    python3 tools/numworks_sync.py            # the latest release
    python3 tools/numworks_sync.py v1.24.19   # a named one

It fills games/numworks/release/ with what the page reads:
    games.json   the list of games, their sizes and where their files are
    files/       NumPlay.nwa, NumPlay-Upsilon.nwa, one .nwa per big game, and the source archive
    img/         one thumbnail per big game

Games come from https://github.com/Mason363/NumPlay (GPL-3.0). The release folder is not kept in git;
copy it to the server after running this. A description already on the page is kept, so wording
edited by hand in games.json survives an update; new games get the repo's own one-line description.
"""
import json, os, re, struct, sys, urllib.request

REPO = "Mason363/NumPlay"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "games", "numworks", "release")
# Release files whose names do not follow from the game's title.
FILES = {"isaac": "BindingOfIsaac.nwa", "finalearth2": "FinalEarth2.nwa", "fnafworld": "FiveNightsAtFreddysWorld.nwa", "fourplayer": "FourPlayers.nwa"}


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "numworks-sync", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    return data if binary else data.decode()


def save(url, path, size=None):
    if os.path.exists(path) and (size is None or os.path.getsize(path) == size):
        return False
    data = get(url, binary=True)
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)
    return True


def file_for(game):
    if game["id"] in FILES:
        return FILES[game["id"]]
    name = game.get("app") or "".join(w[:1].upper() + w[1:] for w in re.split(r"[\s\-]+", game["title"]))
    return re.sub(r"[^A-Za-z0-9]", "", name.removesuffix(".nwa")) + ".nwa"


def flash_size(path):
    """Bytes the app takes on the calculator: its header plus every loaded section with contents.
    Comes out a little under what the linker produces, so a small margin is added."""
    b = open(path, "rb").read()
    if b[:4] != b"\x7fELF" or b[4] != 1 or b[5] != 1:
        raise ValueError(f"{path} is not a 32-bit little-endian ELF file")
    shoff, = struct.unpack_from("<I", b, 0x20)
    shentsize, shnum = struct.unpack_from("<HH", b, 0x2E)
    total = 32
    for i in range(shnum):
        _, typ, flags, _, _, size, _, _, align, _ = struct.unpack_from("<10I", b, shoff + i * shentsize)
        if flags & 2 and typ not in (8, 0x70000001):  # loaded, and not .bss or unwind tables
            a = max(align, 1)
            total = (total + a - 1) // a * a + size
    return total + 256


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "latest"
    rel = json.loads(get(f"https://api.github.com/repos/{REPO}/releases/" + ("latest" if tag == "latest" else f"tags/{tag}")))
    tag = rel["tag_name"]
    assets = {a["name"]: a for a in rel["assets"]}
    raw = f"https://raw.githubusercontent.com/{REPO}/{tag}/"
    games = sorted(json.loads(get(raw + "games/games.json")), key=lambda g: (g["rank"], g["id"]))

    os.makedirs(f"{OUT}/files", exist_ok=True)
    os.makedirs(f"{OUT}/img", exist_ok=True)
    old = {}
    if os.path.exists(f"{OUT}/games.json"):
        old = {g["file"]: g for g in json.load(open(f"{OUT}/games.json")).get("big", [])}

    def fetch(name):
        a = assets[name]
        if save(a["browser_download_url"], f"{OUT}/files/{name}", a["size"]):
            print("  got", name)
        return a["size"]

    big, missing = [], []
    for g in games:
        if not g.get("xl"):
            continue
        name = file_for(g)
        if name not in assets:
            missing.append(f"{g['title']} ({name})")
            continue
        size, thumb = fetch(name), f"img/thumb_{g['id']}.png"
        save(raw + f"docs/media/readme/thumb_{g['id']}.png", f"{OUT}/{thumb}")
        big.append({"title": g["title"], "desc": old.get(name, {}).get("desc") or g["tagline"], "file": name,
                    "thumb": thumb, "size": size, "flash": flash_size(f"{OUT}/files/{name}")})

    source = f"NumPlay-{tag}-source.tar.gz"
    if save(f"https://github.com/{REPO}/archive/refs/tags/{tag}.tar.gz", f"{OUT}/files/{source}"):
        print("  got", source)
    out = {
        "version": tag.lstrip("v"),
        "released": rel["published_at"][:10],
        "numplay": {"file": "NumPlay.nwa", "size": fetch("NumPlay.nwa"),
                    "games": [g["title"] for g in games if not g.get("xl") and g.get("default") is not False],
                    "flash": flash_size(f"{OUT}/files/NumPlay.nwa")},
        "upsilon": {"file": "NumPlay-Upsilon.nwa", "size": fetch("NumPlay-Upsilon.nwa")},
        "big": big,
        "source": f"files/{source}",
        "license": "GPL-3.0",
    }
    with open(f"{OUT}/games.json", "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")

    keep = {g["file"] for g in big} | {"NumPlay.nwa", "NumPlay-Upsilon.nwa", source}
    stale = sorted(n for n in os.listdir(f"{OUT}/files") if n not in keep)
    print(f"{tag}: NumPlay with {len(out['numplay']['games'])} games, and {len(big)} big games")
    if missing:
        print("not in this release, left out:", ", ".join(missing))
    if stale:
        print("no longer listed, safe to delete from files/:", ", ".join(stale))


if __name__ == "__main__":
    main()
