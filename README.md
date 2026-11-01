# Glance for GNOME

A GNOME Shell extension (GNOME 50) porting the core of Scott Jenson's
[Glance](https://github.com/scottjenson/Glance), a window-management
experiment for wide monitors built for KDE Plasma. Glance's `docs/` describe
the design; this port follows its rules and tuning.

- Drag a window toward an enabled screen edge (left and right by default;
  top and bottom can be turned on in the settings): it stays full size
  until its edge goes into that edge's zone (2% of the screen width by
  default), then shrinks around the cursor. The top and bottom zones start
  at the usable area, below the top bar and above any bottom panel.
- Drop it anywhere in an edge zone and it is **parked**: a 180 px tile in
  a column at a side or a row along the top or bottom, still usable
  (clicks, typing, scrolling and its menus work). The app keeps its size
  and is only drawn small.
- **Hover previews:** rest the pointer on a tile and it grows in place to
  the window's full size (at most 60% of the screen wide), readable and
  usable; the other tiles in its column (or row) move out of its way, so
  you can use the whole preview without switching. Move onto another tile to
  flip to it; the preview shrinks back and the column returns when the
  pointer leaves.
- Drag a tile back into main and it gets its original size back. Tiles are
  easiest to move with Super+drag.
- Leaving the overview (which shows parked windows at full size), parked
  windows shrink back into their tiles instead of jumping there.
- Tiles follow resolution, scale and monitor changes, and panels coming or
  going: each goes back to its edge on its window's monitor.
- **Declutter:** Super+double-click a window and it fills the half of main
  nearer to it, full height, while every other window is parked (in the
  two side columns, balanced). Super+double-click the empty desktop to just clear
  main. The same Super+double-click again undoes it.
- **Shake:** shake a window while dragging it and every other window is
  parked; the dragged one lands wherever it is dropped.
- **Settings** (the extension's preferences): which edges park windows, and
  the edge zone width (1-20% of the screen width). Changes apply at once;
  tiles at an edge switched off move to the nearest edge still on (or back
  to full size if none is).
- Edge tiling is turned off while the extension is on, and put back after.

## Status

A first prototype. Differences from Glance, by choice: no stashes (Glance
keeps windows dropped before the very edge where and as large as drawn),
parked apps keep their size (Glance lays them out as phone-sized squares),
previews show the whole window, narrower edge zones, parking rows along
the top and bottom. Not ported yet: tilted tiles,
grabbing tiles anywhere, minimize = park, Meta+arrows, Meta+drag
acceleration, Meta+wheel, the Alt+Tab map and clips. Known
gaps: menus of a window whose frame Mutter keeps partly off screen may open
in the wrong place; dialogs of a parked window open at full size where its
frame is; X11 apps are untested.

## How it works

A window is drawn somewhere other than its frame by scaling and moving its
window actor (`extension/draw.js`). Unlike KWin, Mutter maps pointer input
through the actor's transform, so a shrunk window stays usable without the
frame tricks Glance needs on KDE. Menus and tooltips are separate windows
placed by Mutter relative to the real frame; they are moved next to the
drawn window, at full size.

## Development

Code changes are tried in a nested GNOME Shell, not the real session, so
nothing needs a logout. It runs from a Fedora 44 distrobox:

    distrobox create -n gnome-dev -i registry.fedoraproject.org/fedora-toolbox:44
    distrobox enter gnome-dev -- sudo dnf install gnome-shell mutter-devkit dbus-daemon \
        gnome-backgrounds gnome-text-editor gnome-calculator nautilus firefox

Then, on the host:

    dev/run-nested.sh                 # (re)start the nested shell in a window
    dev/open.sh gnome-text-editor     # open an app in it
    NESTED=headless dev/run-nested.sh # a second one without a window, for scripted tests
    NESTED=headless dev/eval.sh "$(cat dev/tests/park-right.js)"
    NESTED=headless dev/shot.sh       # screenshot
    NESTED=headless dev/scale.sh 2    # change its monitor's scale (a resolution change)
    dev/prefs.sh                      # open the extension's settings in the nested shell

Each nested session has its own settings, extensions and session bus under
`dev/state/`; the real session isn't touched. `dev/devhelper` (loaded only
there) enables `dev/eval.sh` and provides a virtual pointer for scripted
drags. Log: `dev/state/<window|headless>/shell.log` (lines start `glance:`).

## License

MIT, see [LICENSE](LICENSE). Contains logic ported from Glance, Copyright
(c) 2026 Scott Jenson.
