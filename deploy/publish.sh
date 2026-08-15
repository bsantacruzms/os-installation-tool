#!/usr/bin/env bash
# Copies the built web app to a server over ssh. The app is static, so this is
# only ever a file copy: nothing is executed on the far end.
#
#   ./deploy/publish.sh root@os.brionicx.com:/var/www/osit
#
set -euo pipefail

target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: $0 user@host:/path/to/webroot [ssh-port]" >&2
  exit 2
fi
port="${2:-22}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$here/packages/web/dist"

echo "Building the web app..."
npm --prefix "$here/packages/web" run build

if [ ! -f "$dist/index.html" ]; then
  echo "Build produced no index.html at $dist" >&2
  exit 1
fi

echo "Publishing $(du -sh "$dist" | cut -f1) to $target"
rsync -az --delete -e "ssh -p $port" "$dist/" "$target/"

echo "Done. Remember the helper must allow this origin: see OFFICIAL_ORIGINS in"
echo "packages/agent/src/security.ts"
