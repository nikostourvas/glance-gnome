#!/bin/bash
# Saves a screenshot of the nested shell (default: dev/state/<mode>/shot.png).
source "$(dirname "$(readlink -f "$0")")/common.sh"
out=$(readlink -f "${1:-$state/shot.png}")
in_session gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$out" >/dev/null && echo "$out"
