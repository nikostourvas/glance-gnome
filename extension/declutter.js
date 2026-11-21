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

export function superHeld(mods) {
    return (mods & SUPER) !== 0;
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
        // The last Super+click, for double-clicks.
        this._click = null;
        this._mouseSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.mouse'});
        // Super+clicks on the empty desktop come through the stage; on
        // windows they start a Mutter move (see WindowDrag).
        global.stage.connectObject('captured-event', (stage, event) => {
            this._stageEvent(event);
            return Clutter.EVENT_PROPAGATE;
        }, this);
    }

    destroy() {
        global.stage.disconnectObject(this);
        this._destroyed = true;
        this._last = null;
    }

    // A Super+click (pressed at x, y at `time`, released without moving) on
    // `window`, or on the desktop (null).
    superClick(window, x, y, time) {
        const click = this._click;
        const interval = this._mouseSettings.get_int('double-click');
        if (click && click.window === window && time - click.time <= interval &&
            Math.hypot(x - click.x, y - click.y) <= St.Settings.get().drag_threshold) {
            this._click = null;
            this._toggle(window, x, y);
        } else {
            this._click = {window, x, y, time};
        }
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
        const layout = {desktop: !target, target, center: null, monitor, saved: this._snapshot(monitor)};
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

        const enabled = enabledEdges(this._settings);
        const stashAt = scatterStashEdges(this._settings);
        if (stashAt.length) {
            const plan = this._stashPlan(movers, stashAt, monitor);
            if (plan.fits || !enabled.length) {
                this._stash(plan, monitor);
                return;
            }
            console.debug('glance: no room to stash them all whole, park them');
        }
        // The side edges if any is on, else the top and bottom. With two,
        // the leftmost (topmost) `toFirst` movers go to the first, the rest
        // to the other, so both end up with about as many tiles.
        let edges = [G.Edge.LEFT, G.Edge.RIGHT].filter(e => enabled.includes(e));
        if (!edges.length)
            edges = [G.Edge.TOP, G.Edge.BOTTOM].filter(e => enabled.includes(e));
        if (!edges.length)
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
            if (last.target && (parked || this._held(window)))
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
                this._parking.restore(window, frame, {width: frame.width, height: frame.height},
                    last.monitor, from);
            }
        }
        if (last.target && open.has(last.target))
            last.target.activate(global.get_current_time());
    }
}
