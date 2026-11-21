# Glance for GNOME

A GNOME Shell extension that parks windows at the screen edges. Drag a
window toward an edge and it shrinks; let go and it becomes a small, live
tile there. Hover a tile to see and use the window at full size.

Based on Scott Jenson's [Glance](https://github.com/scottjenson/Glance), a
window-management experiment for wide monitors on KDE Plasma, whose design
and rules it follows, with some changes (see [Differences from
Glance](#differences-from-glance)).

## Features

- **Parking.** Drag a window toward an enabled screen edge (left and right
  by default; top and bottom in the settings). It stays full size until
  the pointer comes within that edge's zone (2% of the screen width by
  default), then shrinks around the pointer. Windows of any size can be
  placed anywhere as long as the pointer stays out of the zones. Drop it in
  a zone and it becomes a 180 px
  tile in a column at a side, or a row at the top or bottom. Tiles stay
  live and usable: clicks, typing, scrolling and menus work. The app keeps
  its size; it is only drawn small. Each tile shows its app's icon, as the
  overview does.
- **Glance-style dragging and stashes** (a setting, off by default): as in
  Glance for KDE, a dragged window shrinks once its edge comes within a
  quarter of the screen of an enabled edge, the closer the smaller. Drop it
  there and it stays where and as small as it is, still usable (a stash);
  drop it against the edge at tile size and it parks. Drag a stash out of
  the zone to give it its full size back.
- **Hover previews.** Rest the pointer on a tile and it grows in place to
  the window's full size (at most 60% of the screen wide; X11 apps: see
  Known limitations). The other tiles
  in its line move out of the way, so the whole preview can be used. Move
  onto another tile to switch to it; leave and it shrinks back.
- **Unparking.** Super+double-click a tile (or stash) and the window goes back to its
  size and to where it was before it was parked. Or drag a tile back into
  the middle of the screen: the window gets its size back where it is
  dropped. Tiles are easiest to drag with Super+drag (from anywhere in the
  tile).
- **Centering.** Super+double-click a (not parked) window: it moves to the
  middle of the screen at its size (smaller only if it doesn't fit), and the
  windows in its way fan out to its left and right, so that each still
  shows if it can: the higher in the stack, the nearer the middle. They
  always leave room for tiles at the edges, and keep their size unless they
  don't fit in what is left. A window out of the way stays where it is,
  unless it is hidden.
  Handy to bring what you are working on straight ahead.
  Super+double-click the empty desktop to park every window. The same
  Super+double-click again undoes it.
- **Shake.** Shake a window from side to side while dragging it, and every
  other window is parked.
- Each workspace has its own columns and rows of tiles (tiles of windows
  on all workspaces join the current one's).
- Switching workspaces, tiles slide along as tiles. Opening the overview, a
  parked window grows from its edge (where its hover preview would be)
  into the grid, and shrinks back into its tile when it closes. (This
  changes GNOME's own animations, which can change between GNOME
  releases: each change is only made if GNOME's code is as expected, falls
  back to GNOME's own behaviour on any error, and can be turned off in the
  settings.) Tiles follow resolution, scale and monitor changes, and panels
  coming or going.

## Requirements

GNOME Shell 50 on Wayland. Developed on Fedora 44 (Bluefin).

## Installation

From a release: download the `.shell-extension.zip` and run

    gnome-extensions install --force glance-gnome@nikostourvas.github.io.shell-extension.zip

From source:

    git clone https://github.com/nikostourvas/glance-gnome.git
    cd glance-gnome
    dev/install.sh

Then log out and back in (GNOME on Wayland loads new extensions at login)
and enable it:

    gnome-extensions enable glance-gnome@nikostourvas.github.io

or with the Extensions app or Extension Manager. To update, install again
and log out and back in. To remove it:
`gnome-extensions uninstall glance-gnome@nikostourvas.github.io`.

## Settings

In the extension's preferences (Extensions app, Extension Manager, or
`gnome-extensions prefs glance-gnome@nikostourvas.github.io`):

- **Parking areas:** which screen edges park windows. The top and bottom
  rows sit inside the usable area, below the top bar and above any bottom
  panel. The bottom works best on large screens.
- **Edge zone width:** how close to an edge the pointer must come, in
  percent of the screen width (1-20%), for a dragged window to shrink and
  park.
- **Drag and stash as in Glance:** Glance's zones and stashes instead (see
  above); the edge zone width isn't used then. Switching it off gives
  stashed windows their full size back.
- **Tiles in overview and workspace switches:** keep parked windows as
  tiles in those animations (on by default; see above).

Changes apply at once. Tiles at an edge that is switched off move to the
nearest edge still on, or back to full size if none is.

## Compatibility

- GNOME's own edge tiling (dragging a window to a side to fill half the
  screen) is turned off while the extension is on, and put back after.
- **Tiling Assistant** snaps a dragged window when the pointer reaches a
  screen edge (within its 15 px preview area by default). With both on, drop
  a window while it is shrinking, before the pointer gets there, and it
  parks; push the pointer into that area and the window goes back to full
  size and Tiling Assistant snaps it.
- Other tiling extensions that react to dragging windows to screen edges
  are untested and will likely compete with parking.

## Known limitations

- Dialogs of a parked window open at full size where its (invisible) frame
  is.
- A menu of a parked window can open in the wrong place if Mutter keeps the
  window's frame partly off screen.
- X11 (Xwayland) apps get clicks where their (invisible) full-size window
  is, not where they are drawn. Their hover previews are always shown at
  full size, with the window moved there, so they can be used as usual;
  a click on such a tile itself lands on whatever part of the full-size
  window is there.

## Differences from Glance

Glance's design, from its `docs/`, is the basis. By choice, this extension
has no stashes unless Glance-style dragging is on (Glance keeps windows
dropped before the very edge where and as large as drawn), keeps parked
apps at their size (Glance lays them out as
phone-sized squares), shows the whole window in previews, moves neighbouring
tiles out of a preview's way, centers a Super+double-clicked window
instead of filling the nearer half of the screen and stashing the rest,
shrinks windows by the pointer's distance to
an edge rather than the window's, in narrower zones (Glance: the window's
edge within 25% of the screen per side; Glance-style dragging does that),
and can park at the top and bottom. Not ported: tilted
tiles, grabbing tiles anywhere without Super, minimize = park, Meta+arrows,
Meta+drag acceleration, Meta+wheel, the Alt+Tab map and clips.

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
    gjs -m dev/tests/place-around.js  # where centering puts other windows (no shell needed)
    NESTED=headless dev/scale.sh 2    # change its monitor's scale (a resolution change)
    dev/prefs.sh                      # open the extension's settings in the nested shell
    dev/workspace.sh 2                # switch the nested shell to workspace 2
    HOST_EXTENSIONS=1 dev/run-nested.sh  # also run copies of the real session's enabled
                                         # extensions, with copies of their settings
    X11=1 dev/run-nested.sh           # also let X11 (Xwayland) apps run in it, then:
    X11=1 dev/open.sh gnome-calculator   # open an app as an X11 app
    dev/pack.sh                       # build dist/<uuid>.shell-extension.zip
    dev/install.sh                    # install it in the real session

Each nested session has its own settings, extensions and session bus under
`dev/state/`; the real session isn't touched. `dev/devhelper` (loaded only
there) enables `dev/eval.sh` and provides a virtual pointer for scripted
drags. Log: `dev/state/<window|headless>/shell.log` (lines start `glance:`).

## License

MIT, see [LICENSE](LICENSE). Contains logic ported from Glance, Copyright
(c) 2026 Scott Jenson.
