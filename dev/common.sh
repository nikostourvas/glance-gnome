# Shared by the dev scripts. Two nested sessions can run side by side:
#   NESTED=window   (default) in a window on the desktop, for trying by hand;
#   NESTED=headless no window, for scripted tests (dev/eval.sh, dev/shot.sh)
#                   that a real mouse can't disturb.
dev=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
mode=${NESTED:-window}
state=$dev/state/$mode
display=wayland-glance-$mode
in_session() {
    distrobox enter gnome-dev -- env DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")" "$@"
}
