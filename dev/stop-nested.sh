#!/bin/bash
# Stops the nested GNOME Shell (NESTED=window or headless), if it is running.
source "$(dirname "$(readlink -f "$0")")/common.sh"
pattern="^gnome-shell .*--wayland-display=$display\$"
pkill -f "$pattern" || exit 0
for _ in $(seq 50); do
    pgrep -f "$pattern" >/dev/null || exit 0
    sleep 0.1
done
pkill -9 -f "$pattern"
