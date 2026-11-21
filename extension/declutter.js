// Declutter, Super+double-click: on a tile or stash, it is unparked (see
// ParkedWindows.unpark); on another window, it moves to the middle of the
// screen (at its size, smaller only if it doesn't fit) and the windows in
// its way are pushed aside, left or right of it, at their size, always clear
// of where tiles go (smaller only if they don't fit there), and so that all
// of them still show if they can (Glance
// fills the nearer half of the screen and stashes the others); on the empty
// desktop, every window is parked (at the enabled side edges, balanced, else
// at the enabled top and bottom). The same Super+double-click again undoes
// it. Shaking a dragged window only parks the others (no undo). Glance's
// kwin/declutter.cpp and docs/declutter.md.
//
// Super+triple-click on a window (tile or stash too) makes it the main one:
// it fills the left half of the work area (more only if the app needs it)
// and the other windows, but tiles, are stashed in a grid in the rest (see
// _tile); on a stash of that grid, it swaps places with the main window; on
// another window meanwhile, that one becomes the main one; on the main window
// again, it undoes, back to before the first. So that a third click can come, a
// Super+double-click on a window waits for the double-click time first.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {enabledEdges, glanceSmallest, glanceZoneFraction, scatterStashEdges} from './config.js';
import {clearDrawn, frameRect} from './draw.js';
import {screenOf, workAreaOf} from './parking.js';

const SUPER = Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;
// Mutter's mouse-button-modifier settings, as modifier masks.
const MODIFIERS = {
    '<super>': SUPER,
    '<alt>': Clutter.ModifierType.MOD1_MASK,
    '<control>': Clutter.ModifierType.CONTROL_MASK,
    '<ctrl>': Clutter.ModifierType.CONTROL_MASK,
    '<primary>': Clutter.ModifierType.CONTROL_MASK,
    '<shift>': Clutter.ModifierType.SHIFT_MASK,
};
// The key that moves windows from anywhere (GNOME's "window action key",
// Super by default), for the "Super"+click gestures (see Declutter).
let moveModifier = SUPER;

export function superHeld(mods) {
    return (mods & moveModifier) !== 0;
}

function now() {
    return GLib.get_monotonic_time() / 1000;
}

// Windows declutter moves: ordinary windows shown on the active workspace
// (maximized ones too, unmaximized first, though Mutter doesn't let them be
// resized while maximized).
function manageable(window) {
    return window.get_window_type() === Meta.WindowType.NORMAL && !window.minimized &&
        !window.is_fullscreen() && !window.is_skip_taskbar() && window.allows_move() &&
        (window.allows_resize() || window.get_maximize_flags() !== 0) && !!window.get_compositor_private() &&
        window.located_on_workspace(global.workspace_manager.get_active_workspace());
}

// Whether `r` is (about) at `place`.
function isAt(r, place) {
    return Math.abs(r.x - place.x) <= 2 && Math.abs(r.y - place.y) <= 2 &&
        Math.abs(r.width - place.width) <= 2 && Math.abs(r.height - place.height) <= 2;
}

// Whether `r` is at about `place`: at its top-left, its size give or take
// what an app's size steps (a terminal's character cells) may leave out.
function isAbout(r, place) {
    return Math.abs(r.x - place.x) <= 2 && Math.abs(r.y - place.y) <= 2 &&
        Math.abs(r.width - place.width) <= 48 && Math.abs(r.height - place.height) <= 48;
}

// Resolves once the window has a new size (or after `ms`).
function sizeChanged(window, ms = 500) {
    return new Promise(resolve => {
        let id = 0;
        const done = () => {
            window.disconnect(id);
            GLib.source_remove(timeout);
            resolve();
        };
        id = window.connect('size-changed', done);
        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            window.disconnect(id);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export class Declutter {
    constructor(parking, settings) {
        this._parking = parking;
        this._settings = settings;
        // How windows were before the last declutter, for undoing it.
        this._last = null;
        // The last Super+click, for double- and triple-clicks, and the wait
        // for a third click after a double-click on a window.
        this._click = null;
        this._pending = 0;
        this._mouseSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.mouse'});
        this._wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        const readModifier = () => {
            moveModifier = MODIFIERS[this._wmSettings.get_string('mouse-button-modifier').toLowerCase()] ?? SUPER;
        };
        this._wmSettings.connectObject('changed::mouse-button-modifier', readModifier, this);
        readModifier();
        // Super+clicks on the empty desktop come through the stage; on
        // windows they start a Mutter move (see WindowDrag).
        global.stage.connectObject('captured-event', (stage, event) => {
            this._stageEvent(event);
            return Clutter.EVENT_PROPAGATE;
        }, this);
    }

    destroy() {
        global.stage.disconnectObject(this);
        this._wmSettings.disconnectObject(this);
        moveModifier = SUPER;
        this._cancelPending();
        this._destroyed = true;
        this._last = null;
    }

    // A Super+click (pressed at x, y at `time`, released without moving) on
    // `window`, or on the desktop (null). A double-click on the desktop acts
    // at once; on a window, once no third click came in the double-click
    // time.
    superClick(window, x, y, time) {
        const click = this._click;
        const interval = this._mouseSettings.get_int('double-click');
        const count = click && click.window === window && time - click.time <= interval &&
            Math.hypot(x - click.x, y - click.y) <= St.Settings.get().drag_threshold
            ? click.count + 1 : 1;
        this._cancelPending();
        if (count === 3) {
            this._click = null;
            this._tile(window);
            return;
        }
        this._click = {window, x, y, time, count};
        if (count !== 2)
            return;
        if (!window) {
            this._click = null;
            this._toggle(null, x, y);
            return;
        }
        const wait = Math.max(0, Math.round(time + interval - now()));
        this._pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
            this._pending = 0;
            if (this._click?.count === 2) {
                this._click = null;
                this._toggle(window, x, y);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelPending() {
        if (this._pending)
            GLib.source_remove(this._pending);
        this._pending = 0;
    }

    // `window`, being dragged, was shaken.
    shake(window) {
        console.debug(`glance: ${window.get_title()}: shaken, park the others`);
        this._last = null; // its snapshot no longer holds
        this._scatter(window, this._parking.monitorOf(window)).catch(logError);
    }

    _stageEvent(event) {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS || event.get_button() !== Clutter.BUTTON_PRIMARY ||
            !superHeld(event.get_state()) || Main.overview.visible || Main.sessionMode.isLocked)
            return;
        for (let actor = global.stage.get_event_actor(event); actor; actor = actor.get_parent()) {
            if (actor === Main.layoutManager._backgroundGroup || actor instanceof Meta.BackgroundActor) {
                const [x, y] = event.get_coords();
                this.superClick(null, x, y, now());
                return;
            }
        }
    }

    // On a tile or stash: unparks it (back to its size and place). Else
    // undoes the last declutter if it was for the same target and the target
    // is still where it put it, or declutters.
    _toggle(target, x, y) {
        if (target && this._held(target)) {
            this._parking.unpark(target);
            return;
        }
        const last = this._last;
        const again = last && (target
            ? last.target === target && !this._held(target) && last.center &&
                isAt(frameRect(target), last.center)
            : last.desktop);
        if (again) {
            this._undo();
            return;
        }
        const monitor = target
            ? this._parking.monitorOf(target)
            : global.display.get_monitor_index_for_rect(
                new Mtk.Rectangle({x: Math.round(x), y: Math.round(y), width: 1, height: 1}));
        const layout = {
            mode: target ? 'center' : 'desktop', desktop: !target, target, center: null, monitor,
            saved: this._snapshot(monitor),
        };
        this._last = layout;
        if (target) {
            console.debug(`glance: ${target.get_title()}: to the middle`);
            target.activate(global.get_current_time());
            this._center(target, monitor, layout).catch(logError);
        } else {
            console.debug('glance: declutter the desktop');
            this._scatter(null, monitor).catch(logError);
        }
    }

    // `target` to the middle of the work area, at its size (smaller only if
    // it doesn't fit), and the windows in its way pushed aside, gliding
    // there, never over the enabled edges' tiles (G.clearOfTiles), and so
    // that all of them, and the stashes, still show if they can
    // (G.placeAround). Tiles and stashes stay.
    async _center(target, monitor, layout) {
        const others = this._windows(monitor).filter(w => w !== target && !this._held(w));
        await this._unmaximize([target, ...others]);
        if (this._destroyed || this._last !== layout)
            return;

        const area = workAreaOf(monitor);
        const frame = frameRect(target);
        const width = Math.min(frame.width, area.width);
        const height = Math.min(frame.height, area.height);
        const center = {
            x: Math.round(area.x + (area.width - width) / 2),
            y: Math.round(area.y + (area.height - height) / 2),
            width, height,
        };
        layout.center = center;
        this._parking.restore(target, center, {width, height}, monitor, this._parking.drawnRect(target));

        const room = G.clearOfTiles(screenOf(monitor), area, enabledEdges(this._settings));
        const stacked = global.display.sort_windows_by_stacking(others);
        const rects = stacked.map(frameRect);
        // Stashes stay, and the others go where they leave them showing.
        const order = global.display.sort_windows_by_stacking([...others,
            ...this._windows(monitor).filter(w => w !== target && this._parking.isStashed(w))]);
        const fixed = order.filter(w => this._parking.isStashed(w)).map(w => ({
            rect: this._parking.drawnRect(w),
            under: order.slice(order.indexOf(w) + 1).filter(o => !this._parking.isStashed(o))
                .map(o => stacked.indexOf(o)),
        }));
        G.placeAround(center, room, area, rects, fixed).forEach((place, i) => {
            const rect = rects[i];
            if (place.x !== rect.x || place.y !== rect.y || place.width !== rect.width || place.height !== rect.height) {
                this._parking.restore(stacked[i], place, {width: place.width, height: place.height},
                    monitor, rect);
            }
        });
    }

    // Super+triple-click on `target`: on the last tiling's main window, still
    // about where that put it, undoes it; on another window while that
    // tiling holds (a stash of its grid swaps places with the main window,
    // which otherwise goes first in the grid), makes it the main one, undo
    // still going back to before the tiling; else tiles around `target`.
    _tile(target) {
        const last = this._last;
        if (last?.mode === 'tile' && this._parking.monitorOf(target) === last.monitor) {
            if (target === last.target && !this._held(target) && last.mainRect &&
                isAbout(frameRect(target), last.mainRect)) {
                this._undo();
                return;
            }
            if (target !== last.target) {
                console.debug(`glance: ${target.get_title()}: the main window instead`);
                const slot = last.grid?.indexOf(target) ?? -1;
                if (slot >= 0)
                    last.grid[slot] = last.target;
                else
                    last.grid = [last.target, ...last.grid ?? []];
                last.target = target;
            }
            target.activate(global.get_current_time());
            this._arrangeTiled(last).catch(logError);
            return;
        }
        const monitor = this._parking.monitorOf(target);
        const layout = {
            mode: 'tile', target, monitor, saved: this._snapshot(monitor), grid: null, mainRect: null,
            // Each main window's size before it was one, for when it goes
            // into the grid.
            before: new Map(),
        };
        this._last = layout;
        console.debug(`glance: ${target.get_title()}: main window, tile the others`);
        target.activate(global.get_current_time());
        this._arrangeTiled(layout).catch(logError);
    }

    // The tiling's main window (layout.target) to the left of the work area,
    // clear of the tiles, half its width and all its height (if the app lets
    // it; it may need more), and the other windows but tiles, stashes too,
    // stashed in a grid (G.stashGrid) in the rest: those of the last grid in
    // its order, then the others, most recently used first. Those that would
    // be drawn smaller than the smallest stash size (a setting) are parked
    // instead, the least recently used first, unless no edge parks.
    async _arrangeTiled(layout) {
        const {target: main, monitor} = layout;
        const all = this._windows(monitor).filter(w => w !== main && !this._parking.isParked(w));
        const kept = (layout.grid ?? []).filter(w => all.includes(w));
        const rest = global.display.sort_windows_by_stacking(all.filter(w => !kept.includes(w))).reverse();
        const windows = [...kept, ...rest];
        await this._unmaximize([main, ...windows]);
        if (this._destroyed || this._last !== layout)
            return;

        if (!layout.before.has(main))
            layout.before.set(main, this._sizeOf(main));
        const frame = frameRect(main);
        const resizable = main.allows_resize();
        const mainIn = room => {
            const width = resizable ? Math.floor((room.width - G.arrangeGap) / 2) : Math.min(frame.width, room.width);
            const height = resizable ? room.height : Math.min(frame.height, room.height);
            return {x: room.x, y: Math.round(room.y + (room.height - height) / 2), width, height};
        };
        const roomOf = edges => G.clearOfTiles(screenOf(monitor), workAreaOf(monitor), edges);
        const tileEdges = Object.values(G.Edge).filter(e => this._parking.line(e, monitor).length);
        const parkAt = this._parkingEdges();
        let room = roomOf(tileEdges);
        let mainRect = mainIn(room);
        let fit = this._fitGrid(layout, windows, room, mainRect.x + mainRect.width, !parkAt.length);
        if (fit.count < windows.length) {
            // Some get parked: the grid keeps clear of their tiles too.
            room = roomOf([...tileEdges, ...parkAt]);
            mainRect = mainIn(room);
            fit = this._fitGrid(layout, windows, room, mainRect.x + mainRect.width, false);
        }
        layout.grid = windows.slice(0, fit.count);
        layout.mainRect = mainRect;
        const from = this._parking.drawnRect(main);
        this._parking.release(main);
        this._parking.restore(main, mainRect, {width: mainRect.width, height: mainRect.height}, monitor, from);
        this._stashGrid(layout, fit.places);
        this._parkAll(windows.slice(fit.count), monitor);

        // An app that needs more room than half: the grid moves over.
        await sizeChanged(main, 800);
        if (this._destroyed || this._last !== layout || layout.target !== main)
            return;
        const now = frameRect(main);
        if (now.width <= mainRect.width + 2)
            return;
        console.debug(`glance: ${main.get_title()}: needs ${now.width} px, move the grid over`);
        layout.mainRect = {...mainRect, width: now.width, height: now.height};
        const refit = this._fitGrid(layout, layout.grid, room, mainRect.x + now.width, !parkAt.length);
        const over = layout.grid.slice(refit.count);
        layout.grid = layout.grid.slice(0, refit.count);
        this._stashGrid(layout, refit.places);
        this._parkAll(over, monitor);
    }

    // The most of `windows`, from the first, that a grid in `room` right of
    // `left` holds no smaller than the smallest stash size (all of them with
    // `all`), as {count, places}.
    _fitGrid(layout, windows, room, left, all) {
        const gap = G.arrangeGap;
        const area = {
            x: left + gap, y: room.y + gap,
            width: room.x + room.width - left - 2 * gap, height: room.height - 2 * gap,
        };
        const sizes = windows.map(w => this._sizeOf(w, layout));
        const floor = glanceSmallest(this._settings);
        for (let count = windows.length; count > 0; count--) {
            const {places, scale} = G.stashGrid(sizes.slice(0, count), area);
            if (places.length === count && (all || scale >= floor - 1e-3))
                return {count, places};
        }
        return {count: 0, places: []};
    }

    // A window's full size (a tile's or stash's app size); for a tiling's
    // window that was a main one, its size before that.
    _sizeOf(window, layout = null) {
        const {width, height} = layout?.before.get(window) ?? this._parking.get(window)?.original ??
            frameRect(window);
        return {width, height};
    }

    // The windows of the tiling's grid stashed at `places`, each to go back
    // (when unparked) to where it was before the tiling.
    _stashGrid(layout, places) {
        layout.grid.forEach((window, i) => {
            const parked = this._parking.get(window);
            const saved = layout.saved.find(s => s.window === window);
            const origin = saved?.parked?.origin ?? saved?.frame ??
                (parked && !parked.restoring ? parked.origin : frameRect(window));
            const size = this._sizeOf(window, layout);
            const from = this._parking.drawnRect(window);
            this._parking.release(window);
            this._parking.park(window, places[i], size, layout.monitor,
                {from, edge: G.Edge.RIGHT, origin, stash: true});
        });
    }

    // Unmaximizes those of `windows` that are, noting where they are then
    // in the last declutter's snapshot: undo maximizes them from there, so
    // unmaximizing them later puts them back there too.
    async _unmaximize(windows) {
        const maximized = windows.filter(w => w.get_maximize_flags() !== 0);
        maximized.forEach(w => w.unmaximize());
        await Promise.all(maximized.map(w => sizeChanged(w)));
        for (const item of this._last?.saved ?? []) {
            if (maximized.includes(item.window))
                item.unmaximized = frameRect(item.window);
        }
    }

    // Every manageable window on `monitor`, as it is now.
    _snapshot(monitor) {
        return this._windows(monitor).map(window => {
            const parked = this._parking.get(window);
            return {
                window,
                parked: parked && !parked.restoring ? {...parked} : null,
                frame: frameRect(window),
                maximized: window.is_maximized(),
            };
        });
    }

    _windows(monitor) {
        return global.get_window_actors().map(a => a.meta_window)
            .filter(w => manageable(w) && this._parking.monitorOf(w) === monitor);
    }

    // Whether `window` is a tile or a stash.
    _held(window) {
        return this._parking.isParked(window) || this._parking.isStashed(window);
    }

    // Every window on `monitor` but `except`, stashes too, is parked, the
    // parking columns balanced; or, with the setting (scatter-stashes), they
    // are stashed at the sides stashing is on at (see _stashPlan), as long
    // as all of them then show whole; else, with no edge parking, anyway.
    async _scatter(except, monitor) {
        const movers = this._windows(monitor).filter(w => w !== except && !this._parking.isParked(w));
        if (!movers.length)
            return;

        // A maximized window is parked at its own (unmaximized) size.
        await this._unmaximize(movers);
        if (this._destroyed)
            return;

        const stashAt = scatterStashEdges(this._settings);
        if (stashAt.length) {
            const plan = this._stashPlan(movers, stashAt, monitor);
            if (plan.fits || !enabledEdges(this._settings).length) {
                this._stash(plan, monitor);
                return;
            }
            console.debug('glance: no room to stash them all whole, park them');
        }
        this._parkAll(movers, monitor);
    }

    // The edges _parkAll parks at: the side ones that are on, else the top
    // and bottom ones.
    _parkingEdges() {
        const enabled = enabledEdges(this._settings);
        const edges = [G.Edge.LEFT, G.Edge.RIGHT].filter(e => enabled.includes(e));
        return edges.length ? edges : [G.Edge.TOP, G.Edge.BOTTOM].filter(e => enabled.includes(e));
    }

    // `movers` parked at _parkingEdges. With two, the leftmost (topmost)
    // `toFirst` go to the first, the rest to the other, so both end up with
    // about as many tiles.
    _parkAll(movers, monitor) {
        const edges = this._parkingEdges();
        if (!edges.length || !movers.length)
            return;
        const byY = G.isRow(edges[0]);
        const center = w => {
            const r = this._parking.drawnRect(w);
            return byY ? r.y + r.height / 2 : r.x + r.width / 2;
        };
        movers.sort((a, b) => center(a) - center(b));
        const [first, second = first] = edges;
        const firstCount = this._parking.line(first, monitor).length;
        const secondCount = second === first ? 0 : this._parking.line(second, monitor).length;
        const toFirst = second === first
            ? movers.length
            : G.clamp(Math.round((movers.length + secondCount - firstCount) / 2), 0, movers.length);
        movers.forEach((window, i) => this._parking.toParking(window, i < toFirst ? first : second, monitor));
    }

    // As in Glance: where `windows` (and the stashes already there) would
    // go, as {moves, fits}: into a stash column at each of the side `edges`,
    // beside its tiles, balanced by count in their left-to-right order, each
    // column at one common scale (G.stashColumn). They fit if none overlaps
    // another and the columns don't meet.
    _stashPlan(windows, edges, monitor) {
        const stashes = this._windows(monitor).filter(w => this._parking.isStashed(w) && !windows.includes(w));
        const all = [...windows, ...stashes];
        const center = w => {
            const r = this._parking.drawnRect(w);
            return r.x + r.width / 2;
        };
        all.sort((a, b) => center(a) - center(b));
        const toFirst = edges.length > 1 ? Math.round(all.length / 2) : all.length;
        const screen = screenOf(monitor);
        const area = workAreaOf(monitor);
        const zone = screen.width * glanceZoneFraction(this._settings);
        const columns = [all.slice(0, toFirst), all.slice(toFirst)];
        const moves = [];
        let fits = true;
        const reach = {};
        edges.forEach((edge, i) => {
            const column = columns[i];
            if (!column.length)
                return;
            // Beside the tiles, if that side has any.
            const tiles = this._parking.line(edge, monitor).length ? G.parkingTile + G.arrangeGap : 0;
            const width = Math.max(zone - tiles, G.parkingTile);
            const atLeft = edge === G.Edge.LEFT;
            const band = {
                x: atLeft ? screen.x + tiles : screen.x + screen.width - tiles - width,
                width,
            };
            const sizes = column.map(w => this._parking.get(w)?.original ?? frameRect(w));
            const {places, fits: inColumn} = G.stashColumn(sizes, band, area, glanceSmallest(this._settings), atLeft);
            fits &&= inColumn;
            reach[edge] = atLeft
                ? Math.max(...places.map(r => r.x + r.width))
                : Math.min(...places.map(r => r.x));
            places.forEach((place, j) => moves.push({window: column[j], place, size: sizes[j], edge}));
        });
        if (G.Edge.LEFT in reach && G.Edge.RIGHT in reach && reach[G.Edge.LEFT] + G.arrangeGap > reach[G.Edge.RIGHT])
            fits = false;
        return {moves, fits};
    }

    // Stashes as planned by _stashPlan.
    _stash(plan, monitor) {
        for (const {window, place, size, edge} of plan.moves) {
            const parked = this._parking.get(window);
            const origin = parked && !parked.restoring ? parked.origin : frameRect(window);
            const from = this._parking.drawnRect(window);
            this._parking.release(window);
            this._parking.park(window, place, {width: size.width, height: size.height},
                monitor, {from, edge, origin, stash: true});
        }
    }

    // Everything back as it was before the last declutter (windows closed
    // since are skipped).
    _undo() {
        const last = this._last;
        this._last = null;
        console.debug('glance: undo declutter');
        const open = new Set(global.get_window_actors().map(a => a.meta_window));
        for (const {window, parked, frame, maximized, unmaximized} of last.saved) {
            if (!open.has(window))
                continue;
            // Centering moves no tiles or stashes, so undoing it leaves
            // those alone, also ones parked, stashed or unparked since.
            if (last.mode === 'center' && (parked || this._held(window)))
                continue;
            const from = this._parking.drawnRect(window);
            const current = this._parking.get(window);
            if (parked) {
                if (current && !current.restoring && G.near(current.shown.x, parked.shown.x) &&
                    G.near(current.shown.y, parked.shown.y) && G.near(current.shown.width, parked.shown.width))
                    continue; // untouched
                this._parking.release(window);
                this._parking.park(window, parked.shown, parked.original, parked.monitor,
                    {from, edge: parked.edge, origin: parked.origin, stash: parked.stash});
            } else if (maximized) {
                this._parking.release(window);
                clearDrawn(window);
                if (unmaximized) {
                    window.move_resize_frame(true, unmaximized.x, unmaximized.y,
                        unmaximized.width, unmaximized.height);
                }
                window.maximize();
            } else if (current || !G.near(frameRect(window).x, frame.x) || !G.near(frameRect(window).y, frame.y) ||
                       !G.near(frameRect(window).width, frame.width) || !G.near(frameRect(window).height, frame.height)) {
                this._parking.release(window); // a tile's line closes up
                this._parking.restore(window, frame, {width: frame.width, height: frame.height},
                    last.monitor, from);
            }
        }
        if (last.target && open.has(last.target))
            last.target.activate(global.get_current_time());
    }
}
