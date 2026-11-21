// Hover previews: hovering a parking tile grows it in place to its app's
// real size (1:1, so sharp, no wider than previewMaxWidth of the screen
// unless it is an X11 app, which gets clicks only at 1:1; Glance grows it
// 2.5x), against its screen edge, centered on its spot. The
// other tiles in its line (a column at a side, a row at the top or bottom) move
// aside, so the pointer can roam the preview (Glance leaves them under
// it). The first preview opens after previewDelay; moving onto another tile
// switches at once; leaving shrinks it after previewGrace. Glance's
// kwin/previews.cpp and docs/hover-previews.md.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {frameRect} from './draw.js';
import {screenOf, workAreaOf} from './parking.js';

const BUTTONS = Clutter.ModifierType.BUTTON1_MASK | Clutter.ModifierType.BUTTON2_MASK |
    Clutter.ModifierType.BUTTON3_MASK | Clutter.ModifierType.BUTTON4_MASK | Clutter.ModifierType.BUTTON5_MASK;

function contains(r, x, y) {
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export class HoverPreviews {
    constructor(parking) {
        this._parking = parking;
        // The previewed window, the one the pointer waits on to open, and
        // the tiles moved aside for the preview.
        this._preview = null;
        this._candidate = null;
        this._aside = new Set();
        this._openTimer = 0;
        this._closeTimer = 0;
        global.backend.get_cursor_tracker().connectObject(
            'position-invalidated', () => this._update(), this);
    }

    destroy() {
        global.backend.get_cursor_tracker().disconnectObject(this);
        this._stopOpen();
        this._stopClose();
        this._clearAside();
        this._preview = this._candidate = null;
    }

    // The previewed window, if it still is one (a drag or close ends it
    // elsewhere; its column then goes back home).
    _current() {
        if (this._preview && !this._parking.get(this._preview)?.preview) {
            this._preview = null;
            this._clearAside();
        }
        return this._preview;
    }

    // The parking tile drawn at (x, y) (where it is headed: home, or moved
    // aside), half the gap around it included so moving along the column
    // never falls between two.
    _iconAt(x, y) {
        const workspace = global.workspace_manager.get_active_workspace();
        for (const [window, parked] of this._parking.entries()) {
            if (!this._parking.isParked(window) || window.minimized || !window.located_on_workspace(workspace))
                continue;
            const spot = parked.aside ?? parked.shown;
            if (contains({...spot, y: spot.y - G.arrangeGap / 2, height: spot.height + G.arrangeGap}, x, y))
                return window;
        }
        return null;
    }

    // On every pointer motion: open, switch or close previews. Anywhere on
    // the preview, it stays.
    _update() {
        const preview = this._current();
        const [x, y, mods] = global.get_pointer();
        if ((mods & BUTTONS) !== 0 || global.display.is_grabbed() || Main.overview.visible ||
            Main.sessionMode.isLocked) {
            this._stopOpen();
            return;
        }
        if (preview && contains(this._parking.get(preview).preview, x, y)) {
            this._stopOpen();
            this._stopClose();
            return;
        }
        const icon = this._iconAt(x, y);
        if (!icon) {
            this._stopOpen();
            this._candidate = null;
            if (preview && !this._closeTimer)
                this._closeTimer = this._after(G.previewGrace, () => {
                    this._closeTimer = 0;
                    const current = this._current();
                    if (current)
                        this._close(current);
                });
            return;
        }
        this._stopClose();
        if (icon === preview) {
            this._stopOpen();
        } else if (preview) {
            this._stopOpen();
            this._open(icon);
        } else if (icon !== this._candidate || !this._openTimer) {
            this._stopOpen();
            this._candidate = icon;
            this._openTimer = this._after(G.previewDelay, () => {
                this._openTimer = 0;
                if (this._candidate && this._parking.isParked(this._candidate))
                    this._open(this._candidate);
            });
        }
    }

    // The app at its real size (no taller than the work area, no wider than
    // previewMaxWidth of the screen, or the screen for an X11 app: see
    // ParkedWindows.setPreview), against its edge, centered along it on its
    // spot (where it is now, home or aside), but moved to leave room for at
    // least one tile of its line on each side, as long as the pointer stays
    // on it; on whole pixels, so the frame can go there too.
    _previewRect(window) {
        const parked = this._parking.get(window);
        const {edge} = parked;
        const screen = screenOf(parked.monitor);
        const area = workAreaOf(parked.monitor);
        const frame = frameRect(window);
        const spot = parked.aside ?? parked.shown;
        const maxWidth = window.get_client_type() === Meta.WindowClientType.X11
            ? screen.width
            : screen.width * G.previewMaxWidth;
        const scale = Math.min(1, area.height / frame.height, maxWidth / frame.width);
        const rect = {width: frame.width * scale, height: frame.height * scale};
        // Across its line: against the edge.
        if (edge === G.Edge.TOP)
            rect.y = area.y;
        else if (edge === G.Edge.BOTTOM)
            rect.y = area.y + area.height - rect.height;
        else
            rect.x = edge === G.Edge.LEFT ? spot.x : spot.x + spot.width - rect.width;

        // Along it: centered on its spot, leaving room for a tile on each
        // side, the pointer on it.
        const {pos, size} = G.lineAxis(edge);
        const bounds = G.lineBounds(edge, screen, area);
        const line = this._parking.lineOf(window);
        const index = line.indexOf(window);
        const room = windows => windows.length
            ? Math.max(...windows.map(w => this._parking.get(w).shown[size])) + G.arrangeGap
            : 0;
        const low = bounds.start + room(line.slice(0, index));
        const high = bounds.start + bounds.length - room(line.slice(index + 1)) - rect[size];
        let start = spot[pos] + spot[size] / 2 - rect[size] / 2;
        if (low <= high)
            start = G.clamp(start, low, high);
        const [pointerX, pointerY] = global.get_pointer();
        const pointer = pos === 'x' ? pointerX : pointerY;
        const margin = 20;
        start = G.clamp(start, pointer + margin - rect[size], pointer - margin);
        rect[pos] = G.clamp(start, bounds.start, Math.max(bounds.start, bounds.start + bounds.length - rect[size]));
        return {...rect, x: Math.round(rect.x), y: Math.round(rect.y)};
    }

    _open(window) {
        const old = this._current();
        if (old && old !== window)
            this._parking.setPreview(old, null);
        this._candidate = null;
        const rect = this._previewRect(window);
        this._parking.setPreview(window, rect);
        this._preview = window;
        window.raise();
        this._moveAside(window, rect);
    }

    _close(window) {
        this._parking.setPreview(window, null);
        if (window === this._preview)
            this._preview = null;
        this._clearAside();
    }

    // The other tiles of the previewed window's line, before and after the
    // preview `rect` (above and below it in a column, left and right of it
    // in a row), in their order, arrangeGap apart, closing up if
    // there isn't room, never onto the preview unless there's no room at
    // all.
    _moveAside(window, rect) {
        const parked = this._parking.get(window);
        const {pos, size} = G.lineAxis(parked.edge);
        const bounds = G.lineBounds(parked.edge, screenOf(parked.monitor), workAreaOf(parked.monitor));
        const end = bounds.start + bounds.length;
        const line = this._parking.lineOf(window);
        const index = line.indexOf(window);
        const places = new Map();
        const stack = (windows, from, room, forward) => {
            const sizes = windows.map(w => this._parking.get(w).shown[size]);
            const total = sizes.reduce((a, b) => a + b, 0);
            const gap = windows.length > 1 && total + G.arrangeGap * (windows.length - 1) > room
                ? (room - total) / (windows.length - 1)
                : G.arrangeGap;
            let edge = from;
            windows.forEach((w, i) => {
                const spot = this._parking.get(w).shown;
                let start = forward ? edge : edge - sizes[i];
                start = G.clamp(start, bounds.start, Math.max(bounds.start, end - sizes[i]));
                places.set(w, {...spot, [pos]: start});
                edge = forward ? start + sizes[i] + gap : start - gap;
            });
        };
        const before = rect[pos] - G.arrangeGap;
        const after = rect[pos] + rect[size] + G.arrangeGap;
        stack(line.slice(0, index).reverse(), before, before - bounds.start, false);
        stack(line.slice(index + 1), after, end - after, true);

        this._parking.setAside(window, null);
        for (const w of this._aside) {
            if (!places.has(w))
                this._parking.setAside(w, null);
        }
        this._aside = new Set(places.keys());
        for (const [w, place] of places)
            this._parking.setAside(w, place);
    }

    _clearAside() {
        for (const w of this._aside)
            this._parking.setAside(w, null);
        this._aside.clear();
    }

    _after(ms, callback) {
        return GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopOpen() {
        if (this._openTimer)
            GLib.source_remove(this._openTimer);
        this._openTimer = 0;
    }

    _stopClose() {
        if (this._closeTimer)
            GLib.source_remove(this._closeTimer);
        this._closeTimer = 0;
    }
}
