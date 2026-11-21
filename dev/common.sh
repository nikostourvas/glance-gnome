# Shared by the dev scripts. Nested sessions can run side by side:
#   NESTED=window   (default) in a window on the desktop, for trying by hand
#                   (Alt stands in for Super there: see nested-session.sh);
#   NESTED=headless no window, for scripted tests (dev/eval.sh, dev/shot.sh)
#                   that a real mouse can't disturb.
#   NESTED=demo     like headless, for the recordings of dev/demo.sh.
dev=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
mode=${NESTED:-window}
state=$dev/state/$mode
display=wayland-glance-$mode
# The distrobox with GNOME Shell to test against (DEVBOX=gnome-dev: the
# GNOME 50 one).
box=${DEVBOX:-gnome-dev-51}
in_session() {
    distrobox enter "$box" -- env DBUS_SESSION_BUS_ADDRESS="$(cat "$state/bus")" "$@"
}
