// Shrinking while dragging: a window is full size while it lies within main
// (the middle of the screen); once one of its edges enters the zone of an
// enabled screen edge (left, right, top, bottom: see config.js) it shrinks
// around the cursor, linearly with that edge's depth into the zone, down to
// minScale at the screen edge (for the top and bottom, the work area's:
// below the top bar, above any bottom panel). Dropped while shrunk it is
// parked, a tile at that edge; dropped in main it gets its full size back. Also: a
// Super+click (a Mutter move that never moved) and shaking go to
// Declutter. Glance's kwin/drag.cpp.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as G from './geometry.js';
import {enabledEdges, zoneFraction} from './config.js';
import {superHeld} from './declutter.js';
import {Ticker, clearDrawn, frameRect, setDrawn} from './draw.js';
import {workAreaOf} from './parking.js';

const MOVES = new Set([Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED]);

export class WindowDrag {
    constructor(parking, declutter, settings) {
        this._parking = parking;
        this._declutter = declutter;
        this._settings = settings;
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
        const frame = frameRect(window);
        // A window that wasn't parked is at its own size, whatever the app
        // or Mutter (unmaximizing it) makes that during the drag.
        if (drag.attached)
            drag.original = {width: frame.width, height: frame.height};
        const {original} = drag;
        // From the cursor to each enabled screen edge and to the window's
        // edge on that side (at full size); the edge whose rule shrinks it
        // most is where it parks.
        const toWindow = {
            [G.Edge.LEFT]: drag.attached ? px - frame.x : drag.gx * original.width,
            [G.Edge.RIGHT]: drag.attached ? frame.x + frame.width - px : (1 - drag.gx) * original.width,
            [G.Edge.TOP]: drag.attached ? py - frame.y : drag.gy * original.height,
            [G.Edge.BOTTOM]: drag.attached ? frame.y + frame.height - py : (1 - drag.gy) * original.height,
        };
        const toScreen = {
            [G.Edge.LEFT]: px - screen.x,
            [G.Edge.RIGHT]: screen.x + screen.width - px,
            [G.Edge.TOP]: Math.max(0, py - area.y),
            [G.Edge.BOTTOM]: Math.max(0, area.y + area.height - py),
        };
        let edge = null;
        let rule = 1;
        for (const e of enabledEdges(this._settings)) {
            const scale = G.edgeScale(toScreen[e], toWindow[e], zone);
            if (scale < rule) {
                edge = e;
                rule = scale;
            }
        }
        drag.edge = edge;
        const total = Math.max(rule, G.parkingScale(original));
        drag.total = total;

        // The scale to draw the current frame at (a parked app may have been
        // resized), around the cursor.
        const scale = total * original.width / frame.width;
        const width = frame.width * scale;
        const height = frame.height * scale;
        let x = drag.attached ? px + (frame.x - px) * scale : px - drag.gx * width;
        let y = drag.attached ? py + (frame.y - py) * scale : py - drag.gy * height;
        // When even minScale doesn't fit, it slides back on screen (the
        // cursor then leaves the grabbed spot).
        x += G.shiftOntoScreen(x, width, screen);
        if (total < 1)
            y += G.shiftInto(y, height, screen.y, screen.height);
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

        const frame = frameRect(window);
        const {original} = drag;
        if (drag.total < G.parkBelow) {
            this._parking.drop(window, drag.drawn, original, drag.monitor, drag.edge);
        } else if (!drag.attached &&
                   (!G.near(frame.width, original.width) || !G.near(frame.height, original.height))) {
            // Back to full size, keeping the grabbed spot under the cursor.
            const [px, py] = global.get_pointer();
            const target = {
                x: px - drag.gx * original.width,
                y: py - drag.gy * original.height,
                ...original,
            };
            this._parking.restore(window, target, original, drag.monitor);
        } else {
            // Full size: the frame goes where it is drawn.
            if (!drag.attached)
                window.move_frame(true, Math.round(drag.drawn.x), Math.round(drag.drawn.y));
            clearDrawn(window);
        }
    }
}
