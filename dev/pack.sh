#!/bin/bash
# Builds the installable bundle, dist/<uuid>.shell-extension.zip: the
# extension's files, its settings schema and the license (the format
# extensions.gnome.org takes).
set -euo pipefail
root=$(dirname "$(readlink -f "$0")")/..
mkdir -p "$root/dist"
cd "$root/extension"
extra=(--extra-source=../LICENSE)
for f in *.js; do
    case $f in extension.js|prefs.js) ;; *) extra+=(--extra-source="$f") ;; esac
done
gnome-extensions pack --force --out-dir="$root/dist" \
    --schema=schemas/org.gnome.shell.extensions.glance-gnome.gschema.xml "${extra[@]}" .
ls "$root/dist/"*.shell-extension.zip
