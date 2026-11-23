# Glance for GNOME

An experiment in window management for GNOME Shell, inspired by Scott
Jenson's [Glance](https://github.com/scottjenson/Glance) for KDE Plasma.

The middle of the screen is where you work. This extension treats the edges
as a place to keep windows you still want at hand: drag a window to a side
and it becomes a small tile there, like an icon on a shelf, yet it stays
live and usable. Rest the pointer on a tile to see and use the window at
full size.

![Notes is dragged toward the right side, shrinks, and stays there as a
stash; Calculator is dragged to the left edge and parks as a tile, which
grows to full size while the pointer rests on it](docs/stash-and-park.gif)

## How it works

The screen has three kinds of areas:

- **The middle:** windows here are full size, wherever and however large
  they are.
- **Edge zones:** a thin strip along each edge parking is on at (left and
  right by default, 2% of the screen width). A window dragged with the pointer in a
  zone shrinks; dropped there, it parks.
- **Parking:** the tiles themselves, in a column at each side, or a row at
  the top or bottom.
- **Stash** (at edges stashing is on at: left and right by default, see
  Settings): the band between the middle and an edge, where windows shrink
  as they near the edge and stay as small as they are drawn. Stashing can
  be switched off, leaving only parking.

Key mechanics:

- **Dragging a window toward an edge shrinks it.** Toward an edge that
  stashes (the sides, by default), it starts shrinking once its own edge
  comes near the screen edge, down to "Shrink down to" (see Settings), and
  shrinks on to tile size in the edge zone. Toward an edge that only
  parks, it stays full size until the pointer enters the edge zone, then
  shrinks around the pointer, the closer to the edge the smaller.
- **Dropping it in the zone parks it** as a 180 px tile. The tiles of each
  edge keep to a centered line, which rearranges itself as windows come
  and go. A line too long for its edge shrinks its tiles together, down to
  two thirds of their size, and beyond that overlaps them evenly, so every
  tile stays on screen with a part showing. Each tile shows its app's
  icon, as the overview does.
- **Tiles stay usable.** You can click, type and scroll in them, and their
  menus open. The app keeps its size; it is only drawn small.
- **Hover over a tile to read it:** it grows in place to the window's full
  size (at most 60% of the screen wide), and the other tiles in its line
  move out of the way. Move onto another tile to switch to it; leave and it
  shrinks back.
- **Dragging a tile back into the middle** gives the window its size back,
  where it is dropped. Tiles are easiest to grab with Super+drag, from
  anywhere in the tile.
- **Shake a window** from side to side while dragging it, and every other
  window is stashed at the sides, where stashing is on and they all fit
  whole there, or else parked.
- **Each workspace has its own tiles** (windows shown on all workspaces join
  the current one's). Switching workspaces, tiles slide along as tiles; in
  the overview, a parked window grows out of its edge into the grid and
  shrinks back into its tile when the overview closes.
- **Tiles follow the screen:** resolution, scale and monitor changes, and
  panels coming or going.

Shaking a window with a few others open stashes them at the sides:

![Notes is shaken; Clocks and Characters stash at the left side and
Calculator at the right, all of them whole](docs/shake-few.gif)

With more open than can stash whole, they park as tiles instead:

![Seven windows are open; Notes is shaken and the other six park as tiles,
three at each side; one grows to full size under the
pointer](docs/shake-many.gif)

## Gestures

The Super key (Windows / Meta) is the window system's key (or the "Window
Action Key" set in GNOME Tweaks):

- **Super + double-click a window** to focus on it: it moves to the middle
  of the screen at its size (smaller only if it doesn't fit), and the
  windows in its way fan out to its left and right, split between the sides
  so that as much of them as possible shows, and cascade down the screen:
  the higher in the stack, the nearer the middle and the lower. Tiles and
  stashes stay where they are, and the others avoid covering the stashes. They always leave
  room for the tiles and keep their size unless they don't fit. Do it again
  to undo.
- **Super + double-click a tile** (or a stash) to unpark it: the window goes
  back to its size and to where it was before it was parked.
- **Super + double-click the empty desktop** to stash or park every
  window, as a shake does. Do it again to undo.
- **Super + triple-click a window** to work in it with the others beside
  it: it takes the left half of the screen (more only if the app needs
  it), and the other windows line up on the right as stashes in a grid,
  all at one size, as large as fits. If that would draw them smaller than
  "Shrink down to" (70% by default), the least recently used park as tiles
  instead. Tiles stay where they are.
  - Super + triple-click a stash of the grid to swap it with the main
    window, or a tile to make it the main window.
  - Super + triple-click the main window to undo: every window goes back to
    how it was before the first triple-click.
- **Super + drag** moves a window or tile from anywhere inside it.

A Super + double-click on a window acts once the double-click time has
passed (400 ms by default), in case a third click follows.

Super + triple-clicking a window puts it beside the others:

![Notes is Super+triple-clicked: it fills the left half of the screen, and
Calendar, Clocks, Characters and Recipes line up in a grid on the right.
Calendar is triple-clicked and swaps places with Notes; triple-clicking
Calendar again puts every window back](docs/tiling.gif)

## Settings

In the extension's preferences (the Extensions app, Extension Manager, or
`gnome-extensions prefs glance-gnome@nikostourvas.github.io`), in tabs.

**Parking:**

- **Park at:** which screen edges park windows (left and right by default).
  The top and bottom rows sit inside the usable area, below the top bar and
  above any bottom panel. The bottom works best on large screens.
- **Edge zone width:** how close to an edge the pointer must come, in
  percent of the screen width (1-20%, default 2%), for a dragged window to
  shrink and park.
- **Tiles in overview and workspace switches** (on by default): keep parked
  windows as tiles in those animations. This changes GNOME's own
  animations, which can change between GNOME releases: each change is only
  made if GNOME's code is as expected and falls back to GNOME's own
  behaviour on any error, but if a GNOME update breaks them, turn this off.

**Stashing:**

- **Stash at:** which screen edges stash windows, as in Glance (left and
  right by default). Dragged toward such an edge, a window shrinks once its own edge
  (not the pointer) comes near the screen edge, the closer the smaller.
  Dropped there, it stays where and as small as it is, still usable (a
  stash). Where parking is on at that edge too, dropping it with the
  pointer in the edge zone, or once at tile size, parks it; where it isn't,
  it is stashed even at the very edge. Stashes never cover tiles: at an
  edge with tiles, a stash over their strip slides inward until it clears
  it. Drag a stash back to the middle to give it its full size. Switching
  stashing off at an edge gives its stashes their full size back. Switch
  it off at every edge to do without stashes: a dragged window then stays
  full size until the pointer reaches an edge zone, and parks there, and
  shaking parks the other windows. Super + triple-click still lines
  windows up as stashes in its grid.
- **Start shrinking at:** how far from the screen edge the window's edge
  starts shrinking, in percent of the screen (5-50%, default 5%; Glance's
  is 25%).
- **Shrink down to:** the smallest a window gets before the edge zone, in
  percent of its size (15-90%, default 70%; Glance's is 15%); in the edge zone
  of an edge that parks, it goes on to tile size.
- **Shake stashes instead of parking** (on by default): shaking a window, or
  Super+double-clicking the desktop, puts the other windows (and the
  stashes already there) in a column at each side stashing is on at,
  beside any tiles, at one common scale, as in Glance, no smaller than
  "Shrink down to". Only if they all show whole that way: else they are
  parked (or, with no edge parking, stashed anyway, overlapping from top
  to bottom).

Dialogs, like the settings window itself, don't shrink, park or stash.
Changes apply at once; tiles at an edge parking is switched off at move to
the nearest edge still on, or back to full size if none is.

## Suggested GNOME setting

GNOME can maximize a window only vertically: it gets the full height of
the screen and keeps its width, so there is still room beside it. Setting
a middle-click on a title bar to do that (by default it does nothing)
goes well with this extension. GNOME Tweaks doesn't offer this option,
so set it in a terminal:

    gsettings set org.gnome.desktop.wm.preferences action-middle-click-titlebar 'toggle-maximize-vertically'

Then middle-click a window's title bar to maximize it vertically, and
again to give it its size back. To undo the setting:
`gsettings reset org.gnome.desktop.wm.preferences action-middle-click-titlebar`.

## Status

Early and experimental. It runs on GNOME Shell 50 and 51 (Wayland) and is
developed on Fedora 45 (Bluefin) with GNOME 51. It relies on parts of
GNOME Shell that are not a stable API, so a new GNOME release may need an
update of the extension.

## Installing

From a [release](https://github.com/nikostourvas/glance-gnome/releases):
download `glance-gnome@nikostourvas.github.io.shell-extension.zip` and run

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
- A menu of a parked window that is larger than the screen can open in the
  wrong place (the window's hidden full-size frame can't fit on screen).
- X11 (Xwayland) apps get clicks where their hidden full-size window is,
  not where they are drawn. To make small tiles and stashes of them usable,
  that hidden window follows the pointer over them, so the point under the
  pointer is the one drawn there. A click made while the pointer is still
  moving fast can land a little off, and a window much larger than the
  screen can't always be moved far enough.

## Differences from Glance

Glance's design, from its `docs/`, is the starting point. By choice, this
extension stashes only at the edges stashing is on at (the sides by default;
Glance keeps windows dropped before any edge where and as large as drawn),
starts shrinking a window nearer the edge and shrinks it less (by default
from its edge within 5% of the screen, down to 70%; Glance: 25%, down to
15%), parks once the pointer reaches a thin edge zone (at edges that only
park, it shrinks windows by the pointer's distance to the edge too), keeps
parked apps at their size (Glance lays them out as phone-sized squares),
shows the whole window in previews, moves neighbouring tiles out of a
preview's way, centers a Super+double-clicked window (filling half the
screen and stashing the rest, as Glance's double-click does, is
Super+triple-click here, always the left half, with the rest in a grid
beside it), and can park at the top and bottom. Left out: tilted tiles,
grabbing tiles anywhere without Super, minimize = park, Meta+arrows,
Meta+drag acceleration, Meta+wheel, the Alt+Tab map and clips.

## Under the hood

A window is drawn somewhere other than its frame by scaling and moving its
window actor (`extension/draw.js`). Unlike KWin, Mutter maps pointer input
through the actor's transform, so a shrunk window stays usable without the
frame tricks Glance needs on KDE. Menus and tooltips are separate windows
placed by Mutter relative to the real frame; they are moved next to the
drawn window, at full size.

## Development

Code changes are tried in a nested GNOME Shell, not the real session, so
nothing needs a logout. It runs from a Fedora 45 (GNOME 51) distrobox:

    distrobox create -n gnome-dev-51 -i registry.fedoraproject.org/fedora-toolbox:45
    distrobox enter gnome-dev-51 -- sudo dnf install gnome-shell mutter-devkit dbus-daemon \
        gnome-backgrounds gnome-text-editor gnome-calculator nautilus xorg-x11-server-Xwayland \
        gnome-extensions-app

(`DEVBOX=<name>` before a dev script picks another one, such as a Fedora 44
box for GNOME 50.)

Then, on the host:

    dev/run-nested.sh                 # (re)start the nested shell in a window
    SIZE=1920x1080 dev/run-nested.sh  # the same, in a window about that size
    dev/open.sh gnome-text-editor     # open an app in it
    NESTED=headless dev/run-nested.sh # a second one without a window, for scripted tests
    NESTED=headless dev/eval.sh "$(cat dev/tests/park-right.js)"
    NESTED=headless dev/shot.sh       # screenshot
    gjs -m dev/tests/place-around.js  # where centering puts other windows (no shell needed)
    gjs -m dev/tests/stash-grid.js    # the triple-click grid (no shell needed)
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
`dev/state/`; the real session isn't touched. In the nested window, Alt does
what Super does, since the desktop around it keeps Super + clicks for
itself. `dev/devhelper` (loaded only there) enables `dev/eval.sh` and
provides a virtual pointer for scripted drags. Log:
`dev/state/<window|headless>/shell.log` (lines start `glance:`).

## Issues and requests

This is a personal project, shared as is. Issues for bugs and ideas are
welcome, and some may be fixed or built, but there is no promise of support,
fixes or new features, nor of when they would come. Pull requests may be
reviewed slowly or not merged.

## Acknowledgements

This extension is built on Scott Jenson's ideas. His
[Glance](https://github.com/scottjenson/Glance) for KDE Plasma is its
starting point: the middle of the screen for work, the edges as a shelf,
windows that shrink toward them and stay usable as stashes and tiles. In
his talk "Are we really going to use the same Desktop UX forever?" he
shows a setup like this one, from 29:10:

[![Scott Jenson: Are we really going to use the same Desktop UX forever?
(video, from 29:10)](https://i.ytimg.com/vi/V7AfAcQwLW0/hqdefault.jpg)](https://www.youtube.com/watch?v=V7AfAcQwLW0&t=1750s)

Many thanks to him for sharing them.

## License

MIT, see [LICENSE](LICENSE). Inspired by Glance and contains some of its
logic, Copyright (c) 2026 Scott Jenson.
