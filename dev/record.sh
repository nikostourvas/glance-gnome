#!/bin/bash
# Screen recording of the nested shell (best with NESTED=headless):
#   dev/record.sh start out.webm
#   ... (dev/eval.sh a demo)
#   dev/record.sh stop
source "$(dirname "$(readlink -f "$0")")/common.sh"
stop=$state/record.stop
case ${1:-} in
start)
    out=$(readlink -f "$2")
    rm -f "$stop" "$out"
    setsid distrobox enter "$box" -- env DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")" \
        gjs -m "$dev/record.js" "$out" "$stop" >"$state/record.log" 2>&1 </dev/null &
    for _ in $(seq 50); do
        grep -q . "$state/record.log" 2>/dev/null && break
        sleep 0.2
    done
    cat "$state/record.log"
    grep -q '^recording' "$state/record.log"
    ;;
stop)
    touch "$stop"
    for _ in $(seq 50); do
        pgrep -f "record.js .* $stop" >/dev/null || exit 0
        sleep 0.2
    done
    echo "the recording didn't stop; see $state/record.log" >&2
    exit 1
    ;;
*)
    echo "usage: $0 start <out.webm> | stop" >&2
    exit 2
    ;;
esac
