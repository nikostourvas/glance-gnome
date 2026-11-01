#!/bin/bash
# Runs an app from the gnome-dev distrobox in the nested shell, e.g.
#   dev/open.sh gnome-text-editor
#   dev/open.sh firefox --no-remote --profile dev/state/firefox
source "$(dirname "$(readlink -f "$0")")/common.sh"
setsid distrobox enter gnome-dev -- env DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")" \
    WAYLAND_DISPLAY="$display" GDK_BACKEND=wayland MOZ_ENABLE_WAYLAND=1 "$@" \
    >>"$state/apps.log" 2>&1 </dev/null &
