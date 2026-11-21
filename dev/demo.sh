#!/bin/bash
# Records a demo of the extension as a GIF, for the README:
#   dev/demo.sh stash-and-park [out.gif]   (default: docs/stash-and-park.gif)
# The demo, dev/demos/<name>.js (with dev/demos/lib.js), sets up windows,
# then acts while dev/record.sh records, in a fresh headless nested shell
# (NESTED=demo, SIZE=1920x1080) with a large pointer. Needs ffmpeg.
set -euo pipefail
export NESTED=demo SIZE=${SIZE:-1920x1080}
source "$(dirname "$(readlink -f "$0")")/common.sh"
name=$1
out=$(readlink -m "${2:-$dev/../docs/$name.gif}")
"$dev/stop-nested.sh"
rm -rf "$state"
"$dev/run-nested.sh" >/dev/null
in_session dconf write /org/gnome/desktop/interface/cursor-size 48
step() {
    local code result
    code="const DEMOS = '$dev/demos'; $(cat "$dev/demos/lib.js" "$dev/demos/$name.js")
return await demo.$1();"
    result=$(in_session gdbus call --session --timeout 120 --dest org.gnome.Shell \
        --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "(async () => { $code })()")
    [[ $result == "(true,"* ]] || { echo "$name $1: $result" >&2; exit 1; }
    [ -z "${DEMO_DEBUG:-}" ] || echo "$name $1: $result" >&2
}
step setup
"$dev/record.sh" start "$state/$name.webm" >/dev/null
step act
"$dev/record.sh" stop
mkdir -p "$(dirname "$out")"
# Frames over 12% black (the top bar is 3%) are dropped: stashing by a shake
# leaves one frame black where the windows were.
ffmpeg -v error -y -i "$state/$name.webm" -vf "blackframe=amount=0:threshold=20,\
metadata=mode=select:key=lavfi.blackframe.pblack:value=12:function=less,\
fps=20,scale=960:-1:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" "$out"
"$dev/stop-nested.sh"
echo "$out"
