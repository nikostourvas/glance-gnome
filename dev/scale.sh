#!/bin/bash
# Sets the nested session's (first) monitor scale, e.g. dev/scale.sh 2 — a
# resolution-like change (its logical size divides by the scale).
source "$(dirname "$(readlink -f "$0")")/common.sh"
call() { in_session gdbus call --session --dest org.gnome.Mutter.DisplayConfig \
    --object-path /org/gnome/Mutter/DisplayConfig --method "org.gnome.Mutter.DisplayConfig.$@"; }
config=$(call GetCurrentState)
serial=$(sed -n 's/^(uint32 \([0-9]*\),.*/\1/p' <<<"$config")
mode=$(grep -o "('[0-9]*x[0-9]*@[0-9.]*'" <<<"$config" | head -1 | tr -d "('")
connector=$(grep -o "(('[^']*'" <<<"$config" | head -1 | tr -d "('")
call ApplyMonitorsConfig "$serial" 1 "[(0, 0, $1, 0, true, [('$connector', '$mode', @a{sv} {})])]" "@a{sv} {}"
