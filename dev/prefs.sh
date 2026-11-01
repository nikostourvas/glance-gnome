#!/bin/bash
# Opens the extension's settings window in the nested shell.
source "$(dirname "$(readlink -f "$0")")/common.sh"
uuid=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$dev/../extension/metadata.json")
in_session env WAYLAND_DISPLAY="$display" gnome-extensions prefs "$uuid"
