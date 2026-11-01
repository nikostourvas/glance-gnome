#!/bin/bash
# Installs (or updates) the extension in the real session from a fresh
# bundle (dev/pack.sh). GNOME loads it at the next login; the first time,
# then run: gnome-extensions enable glance-gnome@nikostourvas.github.io
set -euo pipefail
dev=$(dirname "$(readlink -f "$0")")
"$dev/pack.sh" >/dev/null
gnome-extensions install --force "$dev/../dist/"*.shell-extension.zip
echo "installed; log out and back in to load it"
