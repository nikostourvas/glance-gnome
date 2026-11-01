// Parked windows: dropped while shrunk, a window becomes a tile against the
// screen edge it was dragged to, in a column at a side or a row at the top
// or bottom, still usable, its app at its
// full size, only drawn small. (Glance also has stashes, windows dropped
// before the very edge staying where and as large as drawn, and lays a
// parking app out as a phone-sized square; here an app keeps its size, so
// its hover preview can show it whole.) Glance's kwin/parked.cpp and
// docs/dragging-and-parking.md.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {EDGE_SETTINGS, enabledEdges, zoneFraction} from './config.js';
import {Ticker, clearDrawn, forgetDrawn, frameRect, setDrawn} from './draw.js';

// A window going back to full size gives up waiting for its app after this
// long (ms), keeping whatever size the app took (it may have a minimum).
const RESTORE_WAIT = 1000;
// Leaving the overview, tiles glide from full size into place this long (ms).
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
        // into it: its home spot), preview (drawn there instead while
        // hovered, see previews.js), aside (drawn there instead while a
        // neighbour is previewed), original (full size), monitor, edge (a
        // G.Edge), zoom (of
        // the app's size, once it has it; resizeFrom: its size before),
        // restoring
        // (going back to full size, until restoreBy), and the glide
        // (animating, from, current, start).
        this._parked = new Map();
        this._dirty = new Set();
        this._later = 0;
        this._timeouts = new Set();
        this._ticker = new Ticker(() => this._advance());
        // The overview shows every window at full size where its frame is,
        // and its copies fly back there as it closes; tiles then glide from
        // there into place instead of appearing at once somewhere else.
        Main.overview.connectObject('hidden', () => this._glideFromFrames(), this);
        // A resolution, scale or monitor change, or a panel coming or going,
        // moves the edges: tiles follow (see _relayout).
        this._relayoutLater = 0;
        Main.layoutManager.connectObject('monitors-changed', () => this._queueRelayout(), this);
        global.display.connectObject('workareas-changed', () => this._queueRelayout(), this);
        // An edge switched off in the settings: its tiles move (see
        // _edgesChanged).
        for (const key of EDGE_SETTINGS)
            settings.connectObject(`changed::${key}`, () => this._edgesChanged(), this);
    }

    destroy() {
        this._settings.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        this._ticker.stop();
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        if (this._relayoutLater)
            global.compositor.get_laters().remove(this._relayoutLater);
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
        return !!parked && !parked.restoring;
    }

    // A window dropped (by a drag) where it was drawn at `drawn`, near
    // `edge`: a tile at that edge, gliding there.
    drop(window, drawn, original, monitor, edge) {
        this.toParking(window, edge, monitor, {from: drawn, original, center: G.lineCenter(edge, drawn)});
    }

    // A window (parked or not) to the tiles at `edge`, keeping its place
    // along it (or `center`).
    toParking(window, edge, monitor, {from, original, center} = {}) {
        const parked = this._parked.get(window);
        const isParked = parked && !parked.restoring;
        const frame = frameRect(window);
        from ??= this.drawnRect(window);
        original ??= isParked ? parked.original : {width: frame.width, height: frame.height};
        center ??= G.lineCenter(edge, isParked ? parked.shown : frame);
        const place = G.parkingTileRect(edge, original, center, screenOf(monitor), workAreaOf(monitor));
        this.release(window);
        this.park(window, place, original, monitor, {from, edge});
    }

    // Parks a window drawn at `place` at `edge` (gliding there from `from`),
    // its app at its full size `original`, and closes up its line of tiles.
    park(window, place, original, monitor, {from = place, edge}) {
        const screen = screenOf(monitor);
        const layout = original;
        const frame = frameRect(window);
        const resize = !G.near(layout.width, frame.width) || !G.near(layout.height, frame.height);
        this._set(window, {
            shown: place, original, monitor, edge, restoring: false,
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
            console.log(`glance: ${window.get_title()}: original ${original.width}x${original.height}, ` +
                `resize to ${layout.width}x${layout.height}`);
            window.move_resize_frame(true, x, y, layout.width, layout.height);
        } else {
            window.move_frame(true, x, y);
        }
        this._glide(window, from);
        this.arrangeLine(edge, monitor, window);
    }

    // Back to full size `original` at `target`, drawn there (scaled) until
    // the app has its size again.
    restore(window, target, original, monitor, from = target) {
        this._set(window, {
            shown: target, original, monitor, restoring: true,
            restoreBy: now() + RESTORE_WAIT,
        });
        console.log(`glance: ${window.get_title()}: restore to ${original.width}x${original.height}`);
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
    // home), gliding there: as a preview, or moved aside for one.
    setPreview(window, rect) {
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

    // The tiles at `edge` of `monitor`, in order along it by home spot.
    line(edge, monitor) {
        const {pos} = G.lineAxis(edge);
        return [...this._parked].filter(([, p]) => !p.restoring && p.monitor === monitor && p.edge === edge)
            .sort(([, a], [, b]) => a.shown[pos] - b.shown[pos])
            .map(([w]) => w);
    }

    // The tiles in the same line as `window`.
    lineOf(window) {
        const parked = this._parked.get(window);
        return this.line(parked.edge, parked.monitor);
    }

    // A window fills a half of main, full height.
    fillHalf(window, side, monitor) {
        const from = this.drawnRect(window);
        this.release(window);
        if (window.get_maximize_flags() !== 0)
            window.unmaximize();
        const rect = G.halfRect(side, screenOf(monitor), workAreaOf(monitor), zoneFraction(this._settings));
        this.restore(window, rect, {width: rect.width, height: rect.height}, monitor, from);
    }

    // Stops managing a window (a drag takes it over); the column it leaves
    // closes ranks.
    release(window) {
        const parked = this._parked.get(window);
        if (!parked)
            return;
        const wasParked = !parked.restoring;
        this._forget(window);
        if (wasParked)
            this.arrangeLine(parked.edge, parked.monitor, null);
    }

    // Each edge holds its tiles as one line (a column at a side, a row at
    // the bottom), centered, ordered by where they are (an arriving window
    // that lands on another goes after it).
    arrangeLine(edge, monitor, arriving) {
        const {pos, size} = G.lineAxis(edge);
        const bounds = G.lineBounds(edge, screenOf(monitor), workAreaOf(monitor));
        const items = [];
        let total = 0;
        for (const [window, parked] of this._parked) {
            if (parked.restoring || parked.monitor !== monitor || parked.edge !== edge)
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

    _set(window, parked) {
        if (!this._parked.has(window)) {
            const queue = () => this._queue(window);
            window.connectObject(
                'position-changed', queue,
                'size-changed', queue,
                'shown', queue,
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
        setDrawn(window, display.x, display.y, display.width / frame.width);
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
        this.arrangeLine(parked.edge, parked.monitor, null);
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
    // re-formed; previews close.
    _relayout() {
        const lines = new Map();
        const nMonitors = global.display.get_n_monitors();
        for (const [window, parked] of this._parked) {
            if (parked.restoring)
                continue;
            let monitor = window.get_monitor();
            if (monitor < 0 || monitor >= nMonitors)
                monitor = global.display.get_primary_monitor();
            const key = `${monitor}:${parked.edge}`;
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
                this.park(window, place, parked.original, monitor, {from: displayRect(parked), edge});
            });
        }
    }

    // Tiles at an edge switched off go to the nearest edge still on, or, if
    // none is, back to full size.
    _edgesChanged() {
        const edges = enabledEdges(this._settings);
        for (const [window, parked] of [...this._parked]) {
            if (parked.restoring || edges.includes(parked.edge))
                continue;
            const screen = screenOf(parked.monitor);
            const area = workAreaOf(parked.monitor);
            const center = {x: parked.shown.x + parked.shown.width / 2, y: parked.shown.y + parked.shown.height / 2};
            if (!edges.length) {
                const target = G.keptIn({
                    x: center.x - parked.original.width / 2, y: center.y - parked.original.height / 2,
                    ...parked.original,
                }, area);
                this.release(window);
                this.restore(window, target, parked.original, parked.monitor, displayRect(parked));
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

    _glideFromFrames() {
        for (const [window, parked] of this._parked) {
            if (parked.restoring || !window.showing_on_its_workspace())
                continue;
            const frame = frameRect(window);
            Object.assign(parked, {
                animating: true, from: frame, current: frame, start: now(), duration: FROM_OVERVIEW_TIME,
            });
            this._apply(window);
        }
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
