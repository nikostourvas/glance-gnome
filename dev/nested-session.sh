#!/bin/bash
# Inside the gnome-dev distrobox (dev/run-nested.sh starts it): a nested GNOME
# Shell with the extension and the dev helper enabled, isolated from the real
# session (its own settings, extensions and session bus). With
# HOST_EXTENSIONS=1, copies of the extensions enabled in the real session run
# too, with copies of their settings (dev/run-nested.sh lists and dumps them).
# With X11=1, X11 apps can run in it too (Xwayland, started on demand; see
# dev/open.sh).
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/common.sh"
uuid=$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$dev/../extension/metadata.json")

glib-compile-schemas "$dev/../extension/schemas"
extensions=$state/data/gnome-shell/extensions
schemas=$state/data/glib-2.0/schemas
rm -rf "$extensions" "$schemas"
mkdir -p "$state"/{config,cache,local-state} "$extensions" "$schemas"
ln -sfn "$dev/../extension" "$extensions/$uuid"
ln -sfn "$dev/devhelper" "$extensions/devhelper@glance-gnome"
enabled="'$uuid', 'devhelper@glance-gnome'"
if [ -n "${HOST_EXTENSIONS:-}" ]; then
    while read -r extra; do
        for dir in "$HOME/.local/share/gnome-shell/extensions/$extra" \
                   "/run/host/usr/share/gnome-shell/extensions/$extra"; do
            if [ -d "$dir" ]; then
                cp -r "$dir" "$extensions/"
                enabled+=", '$extra'"
                break
            fi
        done
    done <"$state/host-extensions"
    # Schemas of extensions installed system-wide on the host.
    cp /run/host/usr/share/glib-2.0/schemas/org.gnome.shell.extensions.*.gschema.xml "$schemas/" 2>/dev/null || true
    glib-compile-schemas "$schemas" || true
fi

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
# The extension's log lines (glance: ...) are debug messages.
export G_MESSAGES_DEBUG=Gjs-Console
# Distrobox has the host's system bus here; the shell needs it to start.
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/host/run/dbus/system_bus_socket

if [ "$mode" = headless ]; then
    args=(--headless --virtual-monitor "${SIZE:-2560x1080}")
else
    args=(--devkit --wayland)
fi
[ -n "${X11:-}" ] || args+=(--no-x11)
exec dbus-run-session -- bash -c '
    state=$1 enabled=$2
    shift 2
    echo "$DBUS_SESSION_BUS_ADDRESS" > "$state/bus"
    if [ -n "${HOST_EXTENSIONS:-}" ]; then
        dconf load /org/gnome/shell/extensions/ <"$state/host-extension-settings.ini"
    fi
    dconf write /org/gnome/shell/enabled-extensions "[$enabled]"
    dconf write /org/gnome/shell/welcome-dialog-last-shown-version "\"999\""
    dconf write /org/gnome/desktop/interface/enable-hot-corners false
    dconf reset /org/gnome/shell/disabled-extensions
    # The file indexer would crawl the real home folder.
    dconf write /org/freedesktop/tracker/miner/files/index-recursive-directories "@as []"
    dconf write /org/freedesktop/tracker/miner/files/index-single-directories "@as []"
    exec gnome-shell "$@"
' bash "$state" "$enabled" "${args[@]}" --wayland-display="$display"
