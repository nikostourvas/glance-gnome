#!/bin/bash
# Starts (or restarts) a nested GNOME Shell with the extension as it is now:
# in a window, or with NESTED=headless without one (SIZE=2560x1080 sets its
# screen). Log: dev/state/<window|headless>/shell.log.
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/common.sh"
"$dev/stop-nested.sh"
mkdir -p "$state"
rm -f "$state/bus"
setsid distrobox enter gnome-dev -- env NESTED="$mode" SIZE="${SIZE:-}" "$dev/nested-session.sh" \
    >"$state/shell.log" 2>&1 </dev/null &
for _ in $(seq 60); do
    # Ready once started up (the shell opens the overview at the end of
    # that); then out of the overview, to the desktop.
    if [ -s "$state/bus" ] &&
        "$dev/eval.sh" 'typeof globalThis.dev === "object" && !Main.layoutManager._startingUp' 2>/dev/null |
        grep -q true; then
        "$dev/eval.sh" 'const m = global.display.get_monitor_geometry(0); dev.move(m.width / 2, m.height / 2);
            for (let i = 0; i < 20 && Main.overview.visible; i++) { Main.overview.hide(); await dev.sleep(500); }
            return Main.overview.visible' >/dev/null
        echo "nested shell ($mode) ready"
        exit 0
    fi
    sleep 0.5
done
echo "the nested shell ($mode) didn't come up; see $state/shell.log" >&2
exit 1
