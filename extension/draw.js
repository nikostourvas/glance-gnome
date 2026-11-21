// Where windows are drawn when that isn't where their frame is: the
// frame's top-left drawn at (x, y), scaled by `scale`, set as a scale and a
// translation on the window actor. Mutter maps pointer input to Wayland
// apps through the actor's transform, so a window drawn small stays usable
// (X11 apps get it where their frame is: see ParkedWindows.setPreview).
// Menus and tooltips of such a window follow it (see followParent).

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';

import * as G from './geometry.js';

const drawn = new Map();
const popups = new Set();

const POPUP_TYPES = new Set([
    Meta.WindowType.DROPDOWN_MENU,
    Meta.WindowType.POPUP_MENU,
    Meta.WindowType.TOOLTIP,
    Meta.WindowType.COMBO,
    Meta.WindowType.MENU,
]);

// Whether a window is drawn somewhere other than its frame.
export function isDrawn(window) {
    return drawn.has(window);
}

export function frameRect(window) {
    return G.rect(window.get_frame_rect());
}

export function setDrawn(window, x, y, scale) {
    drawn.set(window, {x, y, scale});
    transformActor(window, x, y, scale);
    for (const popup of popups) {
        if (popup.get_transient_for() === window)
            followParent(popup);
    }
}

export function clearDrawn(window) {
    if (!drawn.delete(window))
        return;
    const actor = window.get_compositor_private();
    if (actor) {
        actor.set_scale(1, 1);
        actor.set_translation(0, 0, 0);
    }
    for (const popup of popups) {
        if (popup.get_transient_for() === window)
            followParent(popup);
    }
}

// For a window going away.
export function forgetDrawn(window) {
    drawn.delete(window);
}

function transformActor(window, x, y, scale) {
    const actor = window.get_compositor_private();
    if (!actor)
        return;
    // The actor is at the buffer's top-left, which is outside the frame
    // when the app draws its own shadows.
    const frame = window.get_frame_rect();
    const buffer = window.get_buffer_rect();
    actor.set_pivot_point(0, 0);
    actor.set_scale(scale, scale);
    actor.set_translation(
        x - actor.x - (frame.x - buffer.x) * scale,
        y - actor.y - (frame.y - buffer.y) * scale,
        0);
}

// A menu or tooltip of a window drawn elsewhere: drawn at full size at the
// point of the drawn window it was opened from (Mutter placed it relative
// to the real frame), kept on screen.
function followParent(popup) {
    const parent = popup.get_transient_for();
    const at = parent ? drawn.get(parent) : null;
    if (!at) {
        clearDrawn(popup);
        return;
    }
    const parentFrame = parent.get_frame_rect();
    const frame = popup.get_frame_rect();
    let x = at.x + (frame.x - parentFrame.x) * at.scale;
    let y = at.y + (frame.y - parentFrame.y) * at.scale;
    const monitor = global.display.get_monitor_index_for_rect(
        new Mtk.Rectangle({x: Math.round(x), y: Math.round(y), width: frame.width, height: frame.height}));
    const screen = global.display.get_monitor_geometry(monitor < 0 ? popup.get_monitor() : monitor);
    x += G.shiftInto(x, frame.width, screen.x, screen.width);
    y += G.shiftInto(y, frame.height, screen.y, screen.height);
    setDrawn(popup, x, y, 1);
}

// Watches new menus and tooltips so they follow their window.
export class Popups {
    constructor() {
        global.display.connectObject('window-created',
            (display, window) => this._created(window), this);
    }

    destroy() {
        global.display.disconnectObject(this);
        for (const popup of popups) {
            popup.disconnectObject(this);
            clearDrawn(popup);
        }
        popups.clear();
    }

    _created(window) {
        if (!POPUP_TYPES.has(window.get_window_type()))
            return;
        popups.add(window);
        const follow = () => followParent(window);
        window.connectObject(
            'position-changed', follow,
            'size-changed', follow,
            'shown', follow,
            'unmanaged', () => {
                window.disconnectObject(this);
                popups.delete(window);
                forgetDrawn(window);
            }, this);
        follow();
    }
}

// Calls `step` on every frame while it returns true.
export class Ticker {
    constructor(step) {
        this._step = step;
        this._timeline = null;
    }

    start() {
        if (this._timeline)
            return;
        this._timeline = new Clutter.Timeline({actor: global.stage, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => {
            if (!this._step())
                this.stop();
        });
        this._timeline.start();
    }

    stop() {
        this._timeline?.stop();
        this._timeline = null;
    }
}
