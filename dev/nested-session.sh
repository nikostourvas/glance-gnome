#!/bin/bash
# Inside the gnome-dev distrobox (dev/run-nested.sh starts it): a nested GNOME
# Shell with the extension and the dev helper enabled, isolated from the real
# session (its own settings, extensions and session bus).
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/common.sh"
uuid=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$dev/../extension/metadata.json")

glib-compile-schemas "$dev/../extension/schemas"
mkdir -p "$state"/{config,data/gnome-shell/extensions,cache,local-state}
ln -sfn "$dev/../extension" "$state/data/gnome-shell/extensions/$uuid"
ln -sfn "$dev/devhelper" "$state/data/gnome-shell/extensions/devhelper@glance-gnome"

export XDG_CONFIG_HOME=$state/config XDG_DATA_HOME=$state/data
export XDG_CACHE_HOME=$state/cache XDG_STATE_HOME=$state/local-state
unset DBUS_SESSION_BUS_ADDRESS
# Only the container's apps: the host's Flatpak exports would list apps
# the container can't start.
export XDG_DATA_DIRS=/usr/local/share:/usr/share
# Firefox gets a profile of its own (its default is the real ~/.mozilla).
mkdir -p "$state/firefox" "$state/data/applications"
sed "s|^Exec=firefox|Exec=firefox --no-remote --profile $state/firefox|" \
    /usr/share/applications/org.mozilla.firefox.desktop >"$state/data/applications/org.mozilla.firefox.desktop"
# Distrobox has the host's system bus here; the shell needs it to start.
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/host/run/dbus/system_bus_socket

if [ "$mode" = headless ]; then
    args=(--headless --virtual-monitor "${SIZE:-2560x1080}")
else
    args=(--devkit --wayland)
fi
exec dbus-run-session -- bash -c '
    state=$1 uuid=$2
    shift 2
    echo "$DBUS_SESSION_BUS_ADDRESS" > "$state/bus"
    dconf write /org/gnome/shell/enabled-extensions "[\"$uuid\", \"devhelper@glance-gnome\"]"
    dconf write /org/gnome/shell/welcome-dialog-last-shown-version "\"999\""
    dconf write /org/gnome/desktop/interface/enable-hot-corners false
    dconf reset /org/gnome/shell/disabled-extensions
    # The file indexer would crawl the real home folder.
    dconf write /org/freedesktop/tracker/miner/files/index-recursive-directories "@as []"
    dconf write /org/freedesktop/tracker/miner/files/index-single-directories "@as []"
    exec gnome-shell "$@"
' bash "$state" "$uuid" "${args[@]}" --no-x11 --wayland-display="$display"
