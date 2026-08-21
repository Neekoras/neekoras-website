#!/usr/bin/env bash
# Deploy the prebuilt Celeste (Webleste) WASM bundle to this server.
# No .NET, no emscripten, no 1h build -- just downloads a ~43MB prebuilt
# tarball and wires up nginx. Safe to re-run (idempotent).
#
# Usage:  sudo ./scripts/deploy-celeste.sh
#
# To ship a NEW build later: rebuild on a beefy box (see the celeste-wasm
# repo Makefile), tar the frontend/dist, upload it as the release asset
# below (gh release upload $TAG celeste-dist.tar.gz --clobber), then re-run this.

set -euo pipefail

REPO="Neekoras/neekoras-website"
TAG="celeste-v1.4.0.0"
ASSET="celeste-dist.tar.gz"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

WEBROOT="/var/www/celeste"
SITE_CONF="/etc/nginx/sites-available/neekoras.com"

echo ">> Downloading prebuilt Celeste bundle ($TAG)..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fSL "$URL" -o "$TMP/$ASSET"

echo ">> Extracting to $WEBROOT ..."
rm -rf "$WEBROOT"
mkdir -p "$WEBROOT"
tar xzf "$TMP/$ASSET" -C "$WEBROOT"
chown -R www-data:www-data "$WEBROOT"

# ---- nginx: add the /games/celeste/ location once ----
if grep -q "location /games/celeste/" "$SITE_CONF"; then
  echo ">> nginx location already present, leaving it."
else
  echo ">> Adding nginx location + COOP/COEP headers ..."
  cp "$SITE_CONF" "${SITE_CONF}.bak.$(date +%s 2>/dev/null || echo bak)"
  BLOCK="$TMP/celeste-loc.conf"
  cat > "$BLOCK" <<'BLOCK'

    # ---- Celeste WASM (prebuilt bundle, served from /var/www/celeste) ----
    location = /games/celeste { return 301 /games/celeste/; }
    location /games/celeste/ {
        alias /var/www/celeste/;
        index index.html;
        try_files $uri $uri/ /games/celeste/index.html;

        add_header Cross-Origin-Opener-Policy   "same-origin"  always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header X-Content-Type-Options       "nosniff"      always;
        add_header Content-Security-Policy "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data: https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:" always;

        include /etc/nginx/mime.types;
        default_type application/octet-stream;
    }
BLOCK
  # splice the block in just before the final closing brace of the file
  python3 - "$SITE_CONF" "$BLOCK" <<'PY'
import sys
conf, block = sys.argv[1], sys.argv[2]
s = open(conf).read()
b = open(block).read()
i = s.rstrip().rfind("}")
open(conf, "w").write(s[:i] + b + "\n" + s[i:])
PY
fi

echo ">> Testing + reloading nginx ..."
nginx -t
systemctl reload nginx

echo ">> Done. Celeste is served at /games/celeste/"
