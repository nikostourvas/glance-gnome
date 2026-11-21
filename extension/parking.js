// Parked windows: dropped while shrunk, a window becomes a tile against the
// screen edge it was dragged to, in a column at a side or a row at the top
// or bottom, still usable, its app at its
// full size, only drawn small. With Glance-style dragging (a setting, see
// drag.js), a window dropped short of parking size is stashed instead:
// drawn where and as large as it was dropped, on no line, still usable.
// (Glance lays a parking app out as a phone-sized square; here an app keeps
// its size, so its hover preview can show it whole.) Glance's
// kwin/parked.cpp and docs/dragging-and-parking.md.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {EDGE_SETTINGS, enabledEdges, glanceDragging} from './config.js';
import {Ticker, clearDrawn, forgetDrawn, frameRect, setDrawn} from './draw.js';
import {TileIcons} from './icons.js';

// A window going back to full size gives up waiting for its app after this
// long (ms), keeping whatever size the app took (it may have a minimum).
const RESTORE_WAIT = 1000;
// Leaving the overview, tiles glide into place this long (ms).
const FROM_OVERVIEW_TIME = 250;

export function screenOf(monitor) {
    return G.rect(global.display.get_monitor_geometry(monitor));
}

export function workAreaOf(monitor) {
    return G.rect(Main.layoutManager.getWorkAreaForMonitor(monitor));
}

function now() {
    return GLib.get_monotonic_time() / 1000;
}

function activeWorkspace() {
    return global.workspace_manager.get_active_workspace();
}

// The workspace whose lines of tiles a window's tile is in: its own, or the
// active one for a window on all workspaces.
function workspaceOf(window) {
    return window.get_workspace() ?? activeWorkspace();
}

// Where a parked window is headed: its preview, else where it was moved
// aside to (for a neighbour's preview), else its home spot.
function targetRect(parked) {
    return parked.preview ?? parked.aside ?? parked.shown;
}

// Where a parked window is drawn now: part way while gliding, else its
// target.
function displayRect(parked) {
    return parked.animating ? parked.current : targetRect(parked);
}

export class ParkedWindows {
    constructor(settings) {
        this._settings = settings;
        // Per window: shown (where it is drawn, its frame's width fitted
        // into it: its home spot), stash (a stash, not a tile), preview
        // (drawn there instead while
        // hovered, see previews.js), aside (drawn there instead while a
        // neighbour is previewed), original (full size), origin (where it
        // was before it was parked, or null), monitor, edge (a G.Edge), zoom
        // (of
        // the app's size, once it has it; resizeFrom: its size before),
        // restoring
        // (going back to full size, until restoreBy), and the glide
        // (animating, from, current, start).
        this._parked = new Map();
        this._icons = new TileIcons();
        this._dirty = new Set();
        this._later = 0;
        this._timeouts = new Set();
        this._ticker = new Ticker(() => this._advance());
        // Without the overview patched (see overview.js), the overview shows
        // parked windows at full size where their frames are, and its copies
        // fly back there as it closes: tiles then glide in from there.
        this.overviewPatched = false;
        Main.overview.connectObject('hidden', () => {
            if (!this.overviewPatched)
                this._glideFromFrames();
        }, this);
        // A resolution, scale or monitor change, or a panel coming or going,
        // moves the edges: tiles follow (see _relayout).
        this._relayoutLater = 0;
        Main.layoutManager.connectObject('monitors-changed', () => this._queueRelayout(), this);
        global.display.connectObject('workareas-changed', () => this._queueRelayout(), this);
        // Each workspace has its own lines of tiles; a window on all
        // workspaces joins the active one's.
        this._arrangeLater = 0;
        global.workspace_manager.connectObject('active-workspace-changed', () => this._queueArrangeAll(), this);
        // An edge switched off in the settings: its tiles move (see
        // _edgesChanged).
        for (const key of EDGE_SETTINGS)
            settings.connectObject(`changed::${key}`, () => this._edgesChanged(), this);
        // Glance-style dragging switched off: stashes get their full size
        // back.
        settings.connectObject('changed::glance-dragging', () => this._glanceChanged(), this);
    }

    destroy() {
        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._ticker.stop();
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        if (this._relayoutLater)
            global.compositor.get_laters().remove(this._relayoutLater);
        if (this._arrangeLater)
            global.compositor.get_laters().remove(this._arrangeLater);
        this._timeouts.forEach(id => GLib.source_remove(id));
        for (const window of [...this._parked.keys()])
            this._restoreNow(window);
    }

    get(window) {
        return this._parked.get(window) ?? null;
    }

    entries() {
        return this._parked.entries();
    }

    monitorOf(window) {
        return this._parked.get(window)?.monitor ?? window.get_monitor();
    }

    // Where the window is drawn now (part way, while gliding).
    drawnRect(window) {
        const parked = this._parked.get(window);
        if (!parked)
            return frameRect(window);
        const display = displayRect(parked);
        const frame = frameRect(window);
        return {...display, height: frame.height * display.width / frame.width};
    }

    // Whether a window is a tile (not going back to full size).
    isParked(window) {
        const parked = this._parked.get(window);
        return !!parked && !parked.restoring && !parked.stash;
    }

    // Whether a window is a stash (not going back to full size).
    isStashed(window) {
        const parked = this._parked.get(window);
        return !!parked && !parked.restoring && !!parked.stash;
    }

    // A window dropped (by a drag) where it was drawn at `drawn`, near
    // `edge`: a tile at that edge, gliding there.
    drop(window, drawn, original, monitor, edge, origin) {
        this.toParking(window, edge, monitor, {from: drawn, original, center: G.lineCenter(edge, drawn), origin});
    }

    // A window (parked, stashed or not) to the tiles at `edge`, keeping its
    // place along it (or `center`). Its `origin` (see park) is where it is
    // now if neither yet.
    toParking(window, edge, monitor, {from, original, center, origin} = {}) {
        const parked = this._parked.get(window);
        const held = parked && !parked.restoring;
        const frame = frameRect(window);
        from ??= this.drawnRect(window);
        original ??= held ? parked.original : {width: frame.width, height: frame.height};
        center ??= G.lineCenter(edge, held ? parked.shown : frame);
        if (origin === undefined)
            origin = held ? parked.origin : frame;
        const place = G.parkingTileRect(edge, original, center, screenOf(monitor), workAreaOf(monitor));
        this.release(window);
        this.park(window, place, original, monitor, {from, edge, origin});
    }

    // Parks a window drawn at `place` at `edge` (gliding there from `from`),
    // its app at its full size `original`, and closes up its line of tiles;
    // or, with `stash`, stashes it there. `origin` is where it was before it
    // was parked (null: unknown), for unpark.
    park(window, place, original, monitor, {from = place, edge, origin = null, stash = false}) {
        const screen = screenOf(monitor);
        const layout = original;
        const frame = frameRect(window);
        const resize = !G.near(layout.width, frame.width) || !G.near(layout.height, frame.height);
        this._set(window, {
            shown: place, original, origin, monitor, edge, stash, restoring: false,
            zoom: place.width / layout.width,
            resizeFrom: resize ? {width: frame.width, height: frame.height} : null,
        });

        // The frame (invisible) goes as near the drawing as it can while
        // staying on screen: Mutter then gives the window the right monitor,
        // places its menus without sliding them, and the app keeps drawing.
        const kept = G.keptIn({x: place.x, y: place.y, ...layout}, workAreaOf(monitor));
        const x = Math.round(kept.x);
        const y = Math.round(kept.y);
        if (resize) {
            console.debug(`glance: ${window.get_title()}: original ${original.width}x${original.height}, ` +
                `resize to ${layout.width}x${layout.height}`);
            window.move_resize_frame(true, x, y, layout.width, layout.height);
        } else {
            window.move_frame(true, x, y);
        }
        this._glide(window, from);
        if (!stash)
            this.arrangeLine(edge, monitor, window, workspaceOf(window));
        this._clearStashes(monitor, workspaceOf(window));
    }

    // Stashes on `monitor` and `workspace` that lie over the strip of an
    // edge that has tiles (a tile's thickness and a gap, as for centering:
    // G.clearOfTiles) slide inward, gliding, until they clear it, so they
    // never hide tiles. An edge without tiles keeps no strip.
    _clearStashes(monitor, workspace) {
        if (this._clearing)
            return;
        const edges = Object.values(G.Edge).filter(e => this.line(e, monitor, workspace).length);
        if (!edges.length)
            return;
        const screen = screenOf(monitor);
        const area = workAreaOf(monitor);
        const room = G.clearOfTiles(screen, area, edges);
        this._clearing = true;
        try {
            for (const [window, parked] of [...this._parked]) {
                if (!parked.stash || parked.restoring || parked.monitor !== monitor ||
                    !window.located_on_workspace(workspace))
                    continue;
                const spot = parked.shown;
                const height = spot.width * parked.original.height / parked.original.width;
                // Only off the strips, not into the work area otherwise.
                const clear = (start, size, low, high) =>
                    Math.max(low, Math.min(start, high - size));
                const x = clear(spot.x, spot.width,
                    edges.includes(G.Edge.LEFT) ? room.x : -Infinity,
                    edges.includes(G.Edge.RIGHT) ? room.x + room.width : Infinity);
                const y = clear(spot.y, height,
                    edges.includes(G.Edge.TOP) ? room.y : -Infinity,
                    edges.includes(G.Edge.BOTTOM) ? room.y + room.height : Infinity);
                if (G.near(x, spot.x) && G.near(y, spot.y))
                    continue;
                console.debug(`glance: ${window.get_title()}: stash clear of the tiles`);
                this.park(window, {...spot, x, y}, parked.original, monitor,
                    {from: displayRect(parked), edge: parked.edge, origin: parked.origin, stash: true});
            }
        } finally {
            this._clearing = false;
        }
    }

    // A window dropped (Glance-style dragging) where it was drawn at
    // `drawn`, in the zone of `edge` but larger than a tile: stashed there.
    stash(window, drawn, original, monitor, edge, origin) {
        this.release(window);
        this.park(window, drawn, original, monitor, {edge, origin, stash: true});
    }

    // Back to full size `original` at `target`, drawn there (scaled) until
    // the app has its size again.
    restore(window, target, original, monitor, from = target) {
        this._set(window, {
            shown: target, original, monitor, restoring: true,
            restoreBy: now() + RESTORE_WAIT,
        });
        console.debug(`glance: ${window.get_title()}: restore to ${original.width}x${original.height}`);
        window.move_resize_frame(true, Math.round(target.x), Math.round(target.y),
            original.width, original.height);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_WAIT + 50, () => {
            this._timeouts.delete(id);
            this._queue(window);
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        this._glide(window, from);
    }

    // Draws a parked window at `rect` instead of its home spot (null: back
    // home), gliding there: as a preview, or moved aside for one. A preview
    // at full size takes the window's frame along (and leaves it there):
    // Mutter gives an X11 (Xwayland) app clicks where its frame is, not
    // where it is drawn.
    setPreview(window, rect) {
        const frame = frameRect(window);
        if (rect && G.near(rect.width, frame.width) && G.near(rect.height, frame.height) &&
            (frame.x !== rect.x || frame.y !== rect.y))
            window.move_frame(true, rect.x, rect.y);
        this._setInstead(window, 'preview', rect);
    }

    setAside(window, rect) {
        this._setInstead(window, 'aside', rect);
    }

    _setInstead(window, key, rect) {
        const parked = this._parked.get(window);
        if (!parked || (parked[key] ?? null) === rect)
            return;
        const from = displayRect(parked);
        parked[key] = rect;
        this._glide(window, from);
    }

    // The tiles at `edge` of `monitor` on `workspace` (the active one by
    // default), in order along it by home spot.
    line(edge, monitor, workspace = activeWorkspace()) {
        const {pos} = G.lineAxis(edge);
        return [...this._parked].filter(([w, p]) => !p.restoring && !p.stash && p.monitor === monitor &&
                p.edge === edge && w.located_on_workspace(workspace))
            .sort(([, a], [, b]) => a.shown[pos] - b.shown[pos])
            .map(([w]) => w);
    }

    // The tiles in the same line as `window`, on the active workspace.
    lineOf(window) {
        const parked = this._parked.get(window);
        return this.line(parked.edge, parked.monitor);
    }

    // Stops managing a window (a drag takes it over); the column it leaves
    // closes ranks.
    release(window) {
        const parked = this._parked.get(window);
        if (!parked)
            return;
        const wasParked = !parked.restoring && !parked.stash;
        const workspace = workspaceOf(window);
        this._forget(window);
        if (wasParked)
            this.arrangeLine(parked.edge, parked.monitor, null, workspace);
    }

    // Each edge holds its tiles on a workspace as one line (a column at a
    // side, a row at the top or bottom), centered, ordered by where they are
    // (an arriving window that lands on another goes after it).
    arrangeLine(edge, monitor, arriving, workspace = activeWorkspace()) {
        const {pos, size} = G.lineAxis(edge);
        const bounds = G.lineBounds(edge, screenOf(monitor), workAreaOf(monitor));
        const items = [];
        let total = 0;
        for (const [window, parked] of this._parked) {
            if (parked.restoring || parked.stash || parked.monitor !== monitor || parked.edge !== edge ||
                !window.located_on_workspace(workspace))
                continue;
            let key = parked.shown[pos] + parked.shown[size] / 2;
            if (window === arriving)
                key += parked.shown[size] / 2;
            items.push({window, parked, key});
            total += parked.shown[size] + (items.length > 1 ? G.arrangeGap : 0);
        }
        items.sort((a, b) => a.key - b.key);

        let start = Math.max(bounds.start, bounds.start + (bounds.length - total) / 2);
        for (const {window, parked} of items) {
            if (Math.abs(parked.shown[pos] - start) > 0.5) {
                const from = {...displayRect(parked)};
                parked.shown = {...parked.shown, [pos]: start};
                this._glide(window, from);
            }
            start += parked.shown[size] + G.arrangeGap;
        }
    }

    // Every line of tiles re-formed (the active workspace's last, so tiles
    // of windows on all workspaces end up in its lines).
    arrangeAll() {
        const manager = global.workspace_manager;
        const active = manager.get_active_workspace();
        const workspaces = [...Array(manager.get_n_workspaces()).keys()]
            .map(i => manager.get_workspace_by_index(i))
            .filter(w => w !== active);
        for (const workspace of [...workspaces, active]) {
            for (let monitor = 0; monitor < global.display.get_n_monitors(); monitor++) {
                for (const edge of Object.values(G.Edge))
                    this.arrangeLine(edge, monitor, null, workspace);
            }
        }
    }

    _queueArrangeAll() {
        if (this._arrangeLater)
            return;
        this._arrangeLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._arrangeLater = 0;
            this.arrangeAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _set(window, parked) {
        if (!this._parked.has(window)) {
            const queue = () => this._queue(window);
            window.connectObject(
                'position-changed', queue,
                'size-changed', queue,
                'shown', queue,
                'workspace-changed', () => this._queueArrangeAll(),
                'unmanaged', () => this._closed(window), this);
            // The shell's own animations (minimize, maximize) reset the
            // actor's scale when they finish.
            window.get_compositor_private()?.connectObject('transitions-completed', queue, this);
        }
        this._parked.set(window, {animating: false, ...parked});
    }

    _forget(window) {
        window.disconnectObject(this);
        window.get_compositor_private()?.disconnectObject(this);
        this._parked.delete(window);
        this._dirty.delete(window);
        this._icons.remove(window);
    }

    _closed(window) {
        this.release(window);
        forgetDrawn(window);
    }

    _queue(window) {
        this._dirty.add(window);
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            const windows = [...this._dirty];
            this._dirty.clear();
            windows.forEach(w => this._apply(w));
            return GLib.SOURCE_REMOVE;
        });
    }

    // Draws a parked window where it belongs: its current frame fitted into
    // `shown` by width, so nothing jumps while the app catches up with a
    // resize.
    _apply(window) {
        const parked = this._parked.get(window);
        if (!parked)
            return;
        if (window.is_maximized() || window.is_fullscreen()) {
            this.release(window);
            clearDrawn(window);
            return;
        }
        const frame = frameRect(window);
        const resized = G.near(frame.width, parked.original.width) && G.near(frame.height, parked.original.height);
        if (parked.restoring && !parked.animating && (resized || now() > parked.restoreBy)) {
            this._forget(window);
            clearDrawn(window);
            const x = Math.round(parked.shown.x);
            const y = Math.round(parked.shown.y);
            if (frame.x !== x || frame.y !== y)
                window.move_frame(true, x, y);
            return;
        }
        this._followApp(window, parked, frame);
        const display = displayRect(parked);
        const scale = display.width / frame.width;
        setDrawn(window, display.x, display.y, scale);
        this._icons.update(window, display.x, display.y, scale, !parked.restoring && !parked.stash && !parked.preview);
    }

    // Once the app has its size (or the nearest it allows: it may have a
    // minimum), the tile's home spot follows the app's size at the tile's
    // zoom, against its edge, centered where it was; its line then closes
    // up.
    _followApp(window, parked, frame) {
        if (parked.restoring)
            return;
        if (parked.resizeFrom) {
            if (G.near(frame.width, parked.resizeFrom.width) && G.near(frame.height, parked.resizeFrom.height))
                return; // not yet
            parked.resizeFrom = null;
        }
        const width = frame.width * parked.zoom;
        const height = frame.height * parked.zoom;
        const spot = parked.shown;
        if (G.near(width, spot.width) && G.near(height, spot.height))
            return;
        if (parked.stash) {
            // A stash keeps its top-left.
            parked.shown = {...spot, width, height};
            return;
        }
        const screen = screenOf(parked.monitor);
        const area = workAreaOf(parked.monitor);
        let x, y;
        if (G.isRow(parked.edge)) {
            x = G.clamp(spot.x + spot.width / 2 - width / 2, screen.x, Math.max(screen.x, screen.x + screen.width - width));
            y = parked.edge === G.Edge.TOP ? spot.y : spot.y + spot.height - height;
        } else {
            x = parked.edge === G.Edge.LEFT ? spot.x : spot.x + spot.width - width;
            y = G.clamp(spot.y + spot.height / 2 - height / 2, area.y, Math.max(area.y, area.y + area.height - height));
        }
        parked.shown = {x, y, width, height};
        this.arrangeLine(parked.edge, parked.monitor, null, workspaceOf(window));
    }

    _queueRelayout() {
        if (this._relayoutLater)
            return;
        this._relayoutLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._relayoutLater = 0;
            this._relayout();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Every tile back at its edge on the monitor its window is on now (the
    // primary one if that is gone), each line in the same order as before,
    // re-formed; previews close. Stashes stay as they are, moved onto that
    // monitor's screen if they are off it.
    _relayout() {
        const lines = new Map();
        const nMonitors = global.display.get_n_monitors();
        for (const [window, parked] of [...this._parked]) {
            if (parked.restoring)
                continue;
            let monitor = window.get_monitor();
            if (monitor < 0 || monitor >= nMonitors)
                monitor = global.display.get_primary_monitor();
            if (parked.stash) {
                const screen = screenOf(monitor);
                const spot = parked.shown;
                const place = {
                    ...spot,
                    x: spot.x + G.shiftInto(spot.x, spot.width, screen.x, screen.width),
                    y: spot.y + G.shiftInto(spot.y, spot.height, screen.y, screen.height),
                };
                this.park(window, place, parked.original, monitor,
                    {from: displayRect(parked), edge: parked.edge, origin: parked.origin, stash: true});
                continue;
            }
            const key = `${monitor}:${parked.edge}:${window.get_workspace()?.index() ?? 'all'}`;
            if (!lines.has(key))
                lines.set(key, []);
            lines.get(key).push({window, parked, monitor, order: G.lineCenter(parked.edge, parked.shown)});
        }
        for (const items of lines.values()) {
            items.sort((a, b) => a.order - b.order);
            const {monitor, parked: {edge}} = items[0];
            const screen = screenOf(monitor);
            const area = workAreaOf(monitor);
            const bounds = G.lineBounds(edge, screen, area);
            items.forEach(({window, parked}, i) => {
                const center = bounds.start + bounds.length * (i + 0.5) / items.length;
                const place = G.parkingTileRect(edge, parked.original, center, screen, area);
                this.park(window, place, parked.original, monitor,
                    {from: displayRect(parked), edge, origin: parked.origin});
            });
        }
        this.arrangeAll();
    }

    // A tile or stash back to its size and to where it was before it was
    // parked (centered if that isn't known), gliding there
    // (Super+double-click, see Declutter).
    unpark(window) {
        const parked = this._parked.get(window);
        if (!parked || parked.restoring)
            return;
        const from = displayRect(parked);
        const {original, origin, monitor} = parked;
        const area = workAreaOf(monitor);
        const target = G.keptIn(origin
            ? {x: origin.x, y: origin.y, ...original}
            : {x: area.x + (area.width - original.width) / 2, y: area.y + (area.height - original.height) / 2,
                ...original}, area);
        console.debug(`glance: ${window.get_title()}: unpark`);
        this.release(window);
        this.restore(window, target, original, monitor, from);
        window.activate(global.get_current_time());
    }

    // Tiles at an edge switched off go to the nearest edge still on, or, if
    // none is, back to full size. (Stashes stay.)
    _edgesChanged() {
        const edges = enabledEdges(this._settings);
        for (const [window, parked] of [...this._parked]) {
            if (parked.restoring || parked.stash || edges.includes(parked.edge))
                continue;
            const screen = screenOf(parked.monitor);
            const area = workAreaOf(parked.monitor);
            const center = {x: parked.shown.x + parked.shown.width / 2, y: parked.shown.y + parked.shown.height / 2};
            if (!edges.length) {
                this._toFullSize(window, parked);
                continue;
            }
            const distance = {
                [G.Edge.LEFT]: center.x - screen.x,
                [G.Edge.RIGHT]: screen.x + screen.width - center.x,
                [G.Edge.TOP]: center.y - area.y,
                [G.Edge.BOTTOM]: area.y + area.height - center.y,
            };
            const nearest = edges.reduce((a, b) => distance[b] < distance[a] ? b : a);
            this.toParking(window, nearest, parked.monitor, {from: displayRect(parked)});
        }
    }

    // Stashes back to full size when Glance-style dragging is switched off.
    _glanceChanged() {
        if (glanceDragging(this._settings))
            return;
        for (const [window, parked] of [...this._parked]) {
            if (!parked.restoring && parked.stash)
                this._toFullSize(window, parked);
        }
    }

    // A tile or stash back to full size, centered where it is drawn, in the
    // work area.
    _toFullSize(window, parked) {
        const {shown, original, monitor} = parked;
        const target = G.keptIn({
            x: shown.x + shown.width / 2 - original.width / 2,
            y: shown.y + shown.height / 2 - original.height / 2,
            ...original,
        }, workAreaOf(monitor));
        this.release(window);
        this.restore(window, target, original, monitor, displayRect(parked));
    }

    _glideFromFrames() {
        for (const window of this._parked.keys()) {
            if ((this.isParked(window) || this.isStashed(window)) && window.showing_on_its_workspace())
                this.glideFrom(window, frameRect(window));
        }
    }

    // A tile's window at full size against its edge, centered on the tile
    // (where a hover preview of it would be), in the work area; a stash's,
    // centered on it.
    fullAtEdge(window) {
        const parked = this._parked.get(window);
        const frame = frameRect(window);
        const screen = screenOf(parked.monitor);
        const area = workAreaOf(parked.monitor);
        const spot = targetRect(parked);
        let x, y;
        if (parked.stash) {
            x = spot.x + spot.width / 2 - frame.width / 2;
            y = spot.y + spot.height / 2 - frame.height / 2;
        } else if (G.isRow(parked.edge)) {
            x = spot.x + spot.width / 2 - frame.width / 2;
            y = parked.edge === G.Edge.TOP ? area.y : area.y + area.height - frame.height;
        } else {
            x = parked.edge === G.Edge.LEFT ? screen.x : screen.x + screen.width - frame.width;
            y = spot.y + spot.height / 2 - frame.height / 2;
        }
        return G.keptIn({x, y, width: frame.width, height: frame.height}, area);
    }

    // Draws a tile gliding into place from `from` (where the overview's copy
    // of it ended, see overview.js).
    glideFrom(window, from) {
        const parked = this._parked.get(window);
        if (!parked)
            return;
        Object.assign(parked, {animating: true, from, current: from, start: now(), duration: FROM_OVERVIEW_TIME});
        this._apply(window);
        this._ticker.start();
    }

    // Draws the window moving from `from` to where it now belongs.
    _glide(window, from) {
        const parked = this._parked.get(window);
        const to = targetRect(parked);
        if (G.near(from.x, to.x) && G.near(from.y, to.y) && G.near(from.width, to.width)) {
            this._apply(window);
            return;
        }
        Object.assign(parked, {animating: true, from, current: from, start: now(), duration: G.animationTime});
        this._apply(window);
        this._ticker.start();
    }

    _advance() {
        let any = false;
        for (const [window, parked] of this._parked) {
            if (!parked.animating)
                continue;
            const t = (now() - parked.start) / parked.duration;
            if (t >= 1)
                parked.animating = false;
            else
                parked.current = G.lerpRect(parked.from, targetRect(parked), G.easeOut(t));
            any ||= parked.animating;
            this._apply(window);
        }
        return any;
    }

    // On disable: back to full size, about where it was drawn.
    _restoreNow(window) {
        const parked = this._parked.get(window);
        this._forget(window);
        clearDrawn(window);
        const {original, shown} = parked;
        const area = workAreaOf(parked.monitor);
        const x = Math.round(G.clamp(shown.x, area.x, Math.max(area.x, area.x + area.width - original.width)));
        const y = Math.round(G.clamp(shown.y, area.y, Math.max(area.y, area.y + area.height - original.height)));
        const frame = frameRect(window);
        if (!G.near(frame.width, original.width) || !G.near(frame.height, original.height))
            window.move_resize_frame(true, x, y, original.width, original.height);
        else
            window.move_frame(true, x, y);
    }
}
