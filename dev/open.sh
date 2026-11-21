#!/bin/bash
# Runs an app from the dev distrobox (see common.sh) in the nested shell, e.g.
#   dev/open.sh gnome-text-editor
#   dev/open.sh firefox --no-remote --profile dev/state/firefox
# With X11=1, as an X11 app (the nested shell must have been started with
# X11=1 too).
source "$(dirname "$(readlink -f "$0")")/common.sh"
if [ -n "${X11:-}" ]; then
    # Mutter's Xwayland display and its authority file.
    x11=$("$dev/eval.sh" 'const GLib = imports.gi.GLib; `${GLib.getenv("DISPLAY")} ${GLib.getenv("XAUTHORITY")}`' |
        sed -n "s/^(true, '\"\(.*\)\"')$/\1/p")
    read -r xdisplay xauthority <<<"$x11"
    backend=(GDK_BACKEND=x11 DISPLAY="$xdisplay" XAUTHORITY="$xauthority" WAYLAND_DISPLAY=)
else
    backend=(GDK_BACKEND=wayland WAYLAND_DISPLAY="$display" MOZ_ENABLE_WAYLAND=1)
fi
setsid distrobox enter "$box" -- env DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")" \
    "${backend[@]}" "$@" \
    >>"$state/apps.log" 2>&1 </dev/null &
