// Shrinking while dragging: a dragged window is full size until the pointer
// comes within the zone of an enabled screen edge (left, right, top, bottom:
// see config.js); then it shrinks around the pointer, linearly with the
// pointer's depth into the zone, down to minScale at the edge (for the top
// and bottom, the work area's: below the top bar, above any bottom panel).
// So a window of any size can be placed anywhere as long as the pointer
// stays out of the zones. Dropped while shrunk it is parked, a tile at that
// edge; dropped elsewhere it gets its full size back. At an edge with
// stashing on (a setting per edge), the zone is Glance's, measured from the
// window's edge, wider and only down to a smallest size, then (if parking is
// on there too) on to parking size in the edge zone (G.glanceScale); a
// window dropped short of the edge zone (and of parking size) is stashed:
// it stays where and as large as it is drawn. Where Tiling
// Assistant snaps (the pointer at an edge), it does instead (see
// compat.js). Also: a Super+click (a Mutter move that never moved) and
// shaking go to Declutter. Glance's kwin/drag.cpp.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as G from './geometry.js';
import {enabledEdges, glanceSmallest, glanceZoneFraction, stashEdges, zoneFraction} from './config.js';
import {superHeld} from './declutter.js';
import {Ticker, clearDrawn, frameRect, setDrawn} from './draw.js';
import {workAreaOf} from './parking.js';

const MOVES = new Set([Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED]);

export class WindowDrag {
    constructor(parking, declutter, settings, tilingAssistant) {
        this._parking = parking;
        this._declutter = declutter;
        this._settings = settings;
        this._tilingAssistant = tilingAssistant;
        this._drag = null;
        this._ticker = new Ticker(() => this._step());
        global.display.connectObject(
            'grab-op-begin', (display, window, op) => this._begin(window, op),
            'grab-op-end', (display, window) => this._end(window),
            this);
    }

    destroy() {
        global.display.disconnectObject(this);
        this._ticker.stop();
        if (this._drag?.started)
            clearDrawn(this._drag.window);
        this._drag = null;
    }

    _begin(window, op) {
        if (!window || !MOVES.has(op) || window.get_window_type() !== Meta.WindowType.NORMAL ||
            window.is_fullscreen())
            return;
        const [x, y, mods] = global.get_pointer();
        this._drag = {
            window, started: false,
            press: {x, y, time: GLib.get_monotonic_time() / 1000, superKey: superHeld(mods)},
            // Where it was before the drag, for putting it back there after
            // parking (unknown if it was maximized).
            origin: window.get_maximize_flags() === 0 ? frameRect(window) : null,
        };
        this._ticker.start();
    }

    // Once the pointer has moved past the drag threshold (until then it may
    // be a click), and not while maximized (Mutter unmaximizes it first).
    _start(drag) {
        const {window} = drag;
        const {x: px, y: py} = drag.press;
        const parked = this._parking.get(window);
        const frame = frameRect(window);
        Object.assign(drag, {
            original: parked ? parked.original : {width: frame.width, height: frame.height},
            // A parked window's frame isn't under its drawing (Mutter moves
            // the frame by the pointer's movement, wherever it is), so it
            // is drawn from where it was grabbed instead.
            attached: !parked,
            total: 1,
            started: true,
            shake: {dir: 0, far: px, turns: []},
        });
        if (parked) {
            drag.origin = parked.origin ?? null;
            const drawn = this._parking.drawnRect(window);
            drag.gx = G.clamp((px - drawn.x) / drawn.width, 0, 1);
            drag.gy = G.clamp((py - drawn.y) / drawn.height, 0, 1);
            this._parking.release(window);
        }
    }

    _step() {
        const drag = this._drag;
        if (!drag)
            return false;
        const {window} = drag;
        if (!window.get_compositor_private())
            return true;
        const [px, py] = global.get_pointer();
        if (!drag.started) {
            if (window.is_maximized() ||
                Math.hypot(px - drag.press.x, py - drag.press.y) < St.Settings.get().drag_threshold)
                return true;
            this._start(drag);
        }
        this._shakeStep(drag, px);

        drag.monitor = global.display.get_current_monitor();
        const screen = G.rect(global.display.get_monitor_geometry(drag.monitor));
        const area = workAreaOf(drag.monitor);
        const zone = screen.width * zoneFraction(this._settings);
        const parkAt = enabledEdges(this._settings);
        const stashAt = stashEdges(this._settings);
        const glanceZone = glanceZoneFraction(this._settings);
        const smallest = glanceSmallest(this._settings);
        const frame = frameRect(window);
        // A window that wasn't parked is at its own size, whatever the app
        // or Mutter (unmaximizing it) makes that during the drag.
        if (drag.attached)
            drag.original = {width: frame.width, height: frame.height};
        const {original} = drag;
        // From the pointer to each enabled screen edge (and, where stashing
        // is on, to the window's edge on that side, at full size); the edge
        // whose rule shrinks it most is where it parks or is stashed.
        const toScreen = {
            [G.Edge.LEFT]: px - screen.x,
            [G.Edge.RIGHT]: screen.x + screen.width - px,
            [G.Edge.TOP]: Math.max(0, py - area.y),
            [G.Edge.BOTTOM]: Math.max(0, area.y + area.height - py),
        };
        const toWindow = {
            [G.Edge.LEFT]: drag.attached ? px - frame.x : drag.gx * original.width,
            [G.Edge.RIGHT]: drag.attached ? frame.x + frame.width - px : (1 - drag.gx) * original.width,
            [G.Edge.TOP]: drag.attached ? py - frame.y : drag.gy * original.height,
            [G.Edge.BOTTOM]: drag.attached ? frame.y + frame.height - py : (1 - drag.gy) * original.height,
        };
        let edge = null;
        let rule = 1;
        drag.snapping = this._tilingAssistant.snapsAt(px, py, area);
        const edges = Object.values(G.Edge).filter(e => parkAt.includes(e) || stashAt.includes(e));
        for (const e of drag.snapping ? [] : edges) {
            const stashZone = (G.isRow(e) ? screen.height : screen.width) * glanceZone;
            let scale;
            if (!stashAt.includes(e))
                scale = G.pointerScale(toScreen[e], zone);
            else if (parkAt.includes(e))
                scale = G.glanceScale(toScreen[e], toWindow[e], stashZone, smallest, zone);
            else
                scale = G.clamp(G.edgeScale(toScreen[e], toWindow[e], stashZone, smallest), smallest, 1);
            if (scale < rule) {
                edge = e;
                rule = scale;
            }
        }
        drag.edge = edge;
        drag.parks = edge !== null && parkAt.includes(edge);
        drag.stashes = edge !== null && stashAt.includes(edge);
        drag.inZone = drag.parks && toScreen[edge] < zone;
        const total = Math.max(rule, G.parkingScale(original));
        drag.total = total;

        // The scale to draw the current frame at (a parked app may have been
        // resized), around the cursor.
        const scale = total * original.width / frame.width;
        const width = frame.width * scale;
        const height = frame.height * scale;
        let x = drag.attached ? px + (frame.x - px) * scale : px - drag.gx * width;
        let y = drag.attached ? py + (frame.y - py) * scale : py - drag.gy * height;
        // As it shrinks it also slides onto the screen, in step with the
        // shrinking: not at all at full size (a window may hang off an edge
        // when the pointer gets near it), fully at parking size (or, at an
        // edge that only stashes, at the smallest stash size). Then the
        // pointer may leave the grabbed spot.
        const floor = drag.stashes && !drag.parks ? Math.max(smallest, G.parkingScale(original))
            : G.parkingScale(original);
        const onto = floor < 1 ? G.clamp((1 - total) / (1 - floor), 0, 1) : 1;
        x += G.shiftOntoScreen(x, width, screen) * onto;
        y += G.shiftInto(y, height, screen.y, screen.height) * onto;
        drag.drawn = {x, y, width, height};
        if (drag.attached && total >= 1)
            clearDrawn(window);
        else
            setDrawn(window, x, y, scale);
        return true;
    }

    // A change of direction is moving back shakeStroke from the farthest
    // point; shakeTurns of them within shakeTime scatter the other windows
    // (once per drag).
    _shakeStep(drag, x) {
        const shake = drag.shake;
        if (shake.done)
            return;
        if (shake.dir === 0) {
            if (Math.abs(x - shake.far) >= G.shakeStroke) {
                shake.dir = x > shake.far ? 1 : -1;
                shake.far = x;
            }
            return;
        }
        if ((x - shake.far) * shake.dir >= 0) {
            shake.far = x;
            return;
        }
        if ((shake.far - x) * shake.dir < G.shakeStroke)
            return;
        const time = GLib.get_monotonic_time() / 1000;
        shake.dir = -shake.dir;
        shake.far = x;
        shake.turns = [...shake.turns.filter(t => time - t <= G.shakeTime), time];
        if (shake.turns.length >= G.shakeTurns) {
            shake.done = true;
            this._declutter.shake(drag.window);
        }
    }

    _end(window) {
        const drag = this._drag;
        if (!drag || drag.window !== window)
            return;
        this._drag = null;
        this._ticker.stop();
        if (!drag.started) {
            if (drag.press.superKey)
                this._declutter.superClick(window, drag.press.x, drag.press.y, drag.press.time);
            return;
        }
        if (!window.get_compositor_private())
            return;

        const {original} = drag;
        // Stashed short of the edge zone and of parking size, or anywhere
        // at an edge that doesn't park.
        const shrunk = drag.total < G.parkBelow;
        if (shrunk && drag.stashes && (!drag.parks || (!drag.inZone && drag.total > G.parkingScale(original)))) {
            this._parking.stash(window, drag.drawn, original, drag.monitor, drag.edge, drag.origin);
        } else if (shrunk && drag.parks) {
            this._parking.drop(window, drag.drawn, original, drag.monitor, drag.edge, drag.origin);
        } else if (drag.snapping) {
            // Tiling Assistant places it.
            clearDrawn(window);
        } else if (!drag.attached) {
            // Out of parking: full size, the grabbed spot under the pointer
            // as far as the usable area allows (its title bar stays
            // reachable), gliding there from where it was dropped.
            const [px, py] = global.get_pointer();
            const target = G.keptIn({
                x: px - drag.gx * original.width,
                y: py - drag.gy * original.height,
                ...original,
            }, workAreaOf(drag.monitor));
            this._parking.restore(window, target, original, drag.monitor, drag.drawn);
        } else {
            clearDrawn(window);
        }
    }
}
