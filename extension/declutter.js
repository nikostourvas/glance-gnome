// Declutter, Super+double-click: on a window, it fills the half of main
// nearer to it, full height, and every other window in main is parked (at
// the enabled side edges, balanced, else at the enabled top and bottom;
// Glance puts them in its stashes); on the
// empty desktop, main is just cleared. The same Super+double-click again
// undoes it. Shaking a dragged window only parks the others (no undo).
// Glance's kwin/declutter.cpp and docs/declutter.md.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {enabledEdges} from './config.js';
import {clearDrawn, frameRect} from './draw.js';
import {screenOf} from './parking.js';

const SUPER = Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK;

export function superHeld(mods) {
    return (mods & SUPER) !== 0;
}

function now() {
    return GLib.get_monotonic_time() / 1000;
}

// Windows declutter moves: ordinary windows shown on the active workspace.
function manageable(window) {
    return window.get_window_type() === Meta.WindowType.NORMAL && !window.minimized &&
        !window.is_fullscreen() && !window.is_skip_taskbar() &&
        window.allows_move() && window.allows_resize() && !!window.get_compositor_private() &&
        window.located_on_workspace(global.workspace_manager.get_active_workspace());
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

    // Undoes the last declutter if it was for the same target and the
    // target is still where it put it; else declutters.
    _toggle(target, x, y) {
        const last = this._last;
        const again = last && (target
            ? last.target === target && !this._parking.get(target) &&
                G.sideOf(frameRect(target), screenOf(last.monitor)) === last.half
            : last.desktop);
        if (again) {
            this._undo();
            return;
        }
        const monitor = target
            ? this._parking.monitorOf(target)
            : global.display.get_monitor_index_for_rect(
                new Mtk.Rectangle({x: Math.round(x), y: Math.round(y), width: 1, height: 1}));
        const layout = {desktop: !target, target, half: null, monitor, saved: this._snapshot(monitor)};
        if (target) {
            console.debug(`glance: ${target.get_title()}: declutter`);
            layout.half = G.sideOf(this._parking.drawnRect(target), screenOf(monitor));
            this._parking.fillHalf(target, layout.half, monitor);
            target.activate(global.get_current_time());
        } else {
            console.debug('glance: declutter the desktop');
        }
        this._last = layout;
        this._scatter(target, monitor).catch(logError);
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

    // Every window in main on `monitor` but `except` is parked, the parking
    // columns balanced.
    async _scatter(except, monitor) {
        const movers = this._windows(monitor).filter(w => w !== except && !this._parking.isParked(w));
        if (!movers.length)
            return;

        // A maximized window is parked at its own (unmaximized) size.
        const maximized = movers.filter(w => w.get_maximize_flags() !== 0);
        maximized.forEach(w => w.unmaximize());
        await Promise.all(maximized.map(w => sizeChanged(w)));
        if (this._destroyed)
            return;

        // The side edges if any is on, else the top and bottom. With two,
        // the leftmost (topmost) `toFirst` movers go to the first, the rest
        // to the other, so both end up with about as many tiles.
        const enabled = enabledEdges(this._settings);
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

    // Everything back as it was before the last declutter (windows closed
    // since are skipped).
    _undo() {
        const last = this._last;
        this._last = null;
        console.debug('glance: undo declutter');
        const open = new Set(global.get_window_actors().map(a => a.meta_window));
        for (const {window, parked, frame, maximized} of last.saved) {
            if (!open.has(window))
                continue;
            const from = this._parking.drawnRect(window);
            const current = this._parking.get(window);
            if (parked) {
                if (current && !current.restoring && G.near(current.shown.x, parked.shown.x) &&
                    G.near(current.shown.y, parked.shown.y) && G.near(current.shown.width, parked.shown.width))
                    continue; // untouched
                this._parking.release(window);
                this._parking.park(window, parked.shown, parked.original, parked.monitor,
                    {from, edge: parked.edge});
            } else if (maximized) {
                this._parking.release(window);
                clearDrawn(window);
                window.maximize();
            } else if (current || !G.near(frameRect(window).x, frame.x) ||
                       !G.near(frameRect(window).y, frame.y) || !G.near(frameRect(window).width, frame.width)) {
                this._parking.restore(window, frame, {width: frame.width, height: frame.height},
                    last.monitor, from);
            }
        }
        if (last.target && open.has(last.target))
            last.target.activate(global.get_current_time());
    }
}
