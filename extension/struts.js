// Room kept for the tiles: at an edge of a monitor where a workspace has
// tiles, that workspace's work area leaves out their strip (a tile's
// thickness and a gap, as G.clearOfTiles), as it leaves out a panel. So
// maximized windows, newly placed ones and the windows Mutter keeps in the
// work area stay beside the tiles, as does tiling by GNOME or an extension;
// fullscreen windows still cover them. Mutter takes these areas (struts)
// per workspace. GNOME Shell sets its own (the top bar's, a dock's) on every
// workspace, so its calls get ours added. GNOME Shell's own layout (the
// overview, menus) and this extension's keep the work area without the
// strips (shellWorkArea). Mutter keeps windows out of a strut when it
// places or maximizes them, not when the user moves them, so a window moved
// or resized over a strip, or over one when its tiles come, is moved out of
// it here (_clear). Mutter ignores a strut at an edge another monitor
// adjoins, so tiles there get none.

import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';
import {frameRect} from './draw.js';

const NEIGHBOR = {
    [G.Edge.LEFT]: Meta.DisplayDirection.LEFT,
    [G.Edge.RIGHT]: Meta.DisplayDirection.RIGHT,
    [G.Edge.TOP]: Meta.DisplayDirection.UP,
    [G.Edge.BOTTOM]: Meta.DisplayDirection.DOWN,
};

const SIDE = {
    [G.Edge.LEFT]: Meta.Side.LEFT,
    [G.Edge.RIGHT]: Meta.Side.RIGHT,
    [G.Edge.TOP]: Meta.Side.TOP,
    [G.Edge.BOTTOM]: Meta.Side.BOTTOM,
};

function workspaces() {
    const manager = global.workspace_manager;
    return [...Array(manager.get_n_workspaces()).keys()].map(i => manager.get_workspace_by_index(i));
}

export class TileStruts {
    constructor(parking) {
        this._parking = parking;
        // GNOME Shell's struts, the last it set (null until then), and ours
        // as each workspace got them (a key).
        this._shellStruts = null;
        this._given = new Map();
        this._later = 0;
        this._clearLater = 0;
        // The window a grab moves or resizes, and its frame before.
        this._grab = null;

        const self = this;
        const proto = Meta.Workspace.prototype;
        this._setStruts = proto.set_builtin_struts;
        this._patched = function (struts) {
            self._shellStruts = struts;
            self._give(this);
        };
        proto.set_builtin_struts = this._patched;
        const layout = Main.layoutManager;
        this._getWorkArea = layout.getWorkAreaForMonitor;
        this._patchedWorkArea = monitor => this.shellWorkArea(monitor) ?? this._getWorkArea.call(layout, monitor);
        layout.getWorkAreaForMonitor = this._patchedWorkArea;

        parking.onTilesChanged = () => this._queue();
        global.workspace_manager.connectObject('notify::n-workspaces', () => this._queue(), this);
        global.display.connectObject(
            'grab-op-begin', (display, window) => {
                this._grab = window ? {window, frame: frameRect(window)} : null;
            },
            'grab-op-end', (display, window) => this._grabEnded(window),
            this);
        // GNOME Shell's struts, through the patch.
        if (typeof layout._updateRegions === 'function')
            layout._updateRegions();
        else
            console.warn("glance: can't get GNOME Shell's struts; no room is kept for tiles");
    }

    destroy() {
        this._parking.onTilesChanged = null;
        global.workspace_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        if (this._clearLater)
            global.compositor.get_laters().remove(this._clearLater);
        const proto = Meta.Workspace.prototype;
        if (proto.set_builtin_struts === this._patched)
            proto.set_builtin_struts = this._setStruts;
        const layout = Main.layoutManager;
        if (layout.getWorkAreaForMonitor === this._patchedWorkArea)
            delete layout.getWorkAreaForMonitor;
        if (this._shellStruts) {
            for (const workspace of workspaces())
                this._setStruts.call(workspace, this._shellStruts);
        }
        this._given.clear();
        this._shellStruts = null;
    }

    // The work area of `monitor` as GNOME Shell's struts leave it, without
    // the tiles' strips (null until GNOME Shell has set them).
    shellWorkArea(monitor) {
        if (!this._shellStruts)
            return null;
        const screen = global.display.get_monitor_geometry(monitor);
        let left = screen.x, right = screen.x + screen.width;
        let top = screen.y, bottom = screen.y + screen.height;
        for (const {rect, side} of this._shellStruts) {
            if (global.display.get_monitor_index_for_rect(rect) !== monitor)
                continue;
            if (side === Meta.Side.LEFT)
                left = Math.max(left, rect.x + rect.width);
            else if (side === Meta.Side.RIGHT)
                right = Math.min(right, rect.x);
            else if (side === Meta.Side.TOP)
                top = Math.max(top, rect.y + rect.height);
            else if (side === Meta.Side.BOTTOM)
                bottom = Math.min(bottom, rect.y);
        }
        return new Mtk.Rectangle({x: left, y: top, width: right - left, height: bottom - top});
    }

    // The edges of `monitor` whose strips are kept for tiles on `workspace`:
    // those with tiles, but not where another monitor adjoins.
    _edges(monitor, workspace) {
        return Object.values(G.Edge).filter(edge => this._parking.line(edge, monitor, workspace).length &&
            global.display.get_monitor_neighbor_index(monitor, NEIGHBOR[edge]) === -1);
    }

    // Our struts for `workspace`: the strip of each edge with tiles on it.
    _ours(workspace) {
        const thickness = G.parkingTile + G.arrangeGap;
        const struts = [];
        for (let monitor = 0; monitor < global.display.get_n_monitors(); monitor++) {
            const screen = global.display.get_monitor_geometry(monitor);
            const area = this.shellWorkArea(monitor);
            for (const edge of this._edges(monitor, workspace)) {
                let rect;
                if (edge === G.Edge.LEFT)
                    rect = {x: screen.x, y: area.y, width: thickness, height: area.height};
                else if (edge === G.Edge.RIGHT)
                    rect = {x: screen.x + screen.width - thickness, y: area.y, width: thickness, height: area.height};
                else if (edge === G.Edge.TOP)
                    rect = {x: area.x, y: area.y, width: area.width, height: thickness};
                else
                    rect = {x: area.x, y: area.y + area.height - thickness, width: area.width, height: thickness};
                struts.push({rect, side: SIDE[edge]});
            }
        }
        return struts;
    }

    // GNOME Shell's struts and ours to `workspace`.
    _give(workspace, ours = this._ours(workspace)) {
        this._given.set(workspace, JSON.stringify(ours));
        const struts = ours.map(({rect, side}) => new Meta.Strut({rect: new Mtk.Rectangle(rect), side}));
        this._setStruts.call(workspace, [...this._shellStruts, ...struts]);
    }

    _queue() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            this._update();
            return false;
        });
    }

    // Each workspace whose tiles changed edges gets its struts again; then
    // windows over the strips move out (some, Mutter moves itself).
    _update() {
        this._queueClear();
        if (!this._shellStruts)
            return;
        const all = workspaces();
        for (const workspace of this._given.keys()) {
            if (!all.includes(workspace))
                this._given.delete(workspace);
        }
        for (const workspace of all) {
            const ours = this._ours(workspace);
            if (this._given.get(workspace) !== JSON.stringify(ours)) {
                console.debug(`glance: room for tiles on workspace ${workspace.index()}: ${ours.length} strips`);
                this._give(workspace, ours);
            }
        }
    }

    // A window the user moved or resized (not parked or stashed by the
    // drop, see drag.js, which acts first) out of the strips.
    _grabEnded(window) {
        const grab = this._grab;
        this._grab = null;
        if (!window || grab?.window !== window)
            return;
        const before = grab.frame;
        const after = frameRect(window);
        if (G.near(before.x, after.x) && G.near(before.y, after.y) &&
            G.near(before.width, after.width) && G.near(before.height, after.height))
            return;
        const resized = !G.near(before.width, after.width) || !G.near(before.height, after.height);
        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.IDLE, () => {
            this._clear(window, resized);
            return false;
        });
    }

    _queueClear() {
        if (this._clearLater)
            return;
        // Once Mutter has moved the windows it keeps out of the new struts.
        this._clearLater = global.compositor.get_laters().add(Meta.LaterType.IDLE, () => {
            this._clearLater = 0;
            for (const actor of global.get_window_actors())
                this._clear(actor.meta_window, false);
            return false;
        });
    }

    // A window over the strip of an edge with tiles moves out of it at its
    // size, as far as it fits (else it clears the left or top one); one
    // resized into it gives up that part instead. Not tiles and stashes
    // (see ParkedWindows._clearStashes), dialogs, maximized or fullscreen
    // windows, or one being moved.
    _clear(window, resized) {
        if (!this._shellStruts || !window.get_compositor_private() ||
            window.get_window_type() !== Meta.WindowType.NORMAL || window.minimized ||
            window.is_fullscreen() || window.get_maximize_flags() === Meta.MaximizeFlags.BOTH ||
            this._parking.get(window) || this._grab?.window === window)
            return;
        const monitor = window.get_monitor();
        const workspace = window.get_workspace() ?? global.workspace_manager.get_active_workspace();
        const edges = this._edges(monitor, workspace);
        if (!edges.length)
            return;
        const room = G.clearOfTiles(G.rect(global.display.get_monitor_geometry(monitor)),
            G.rect(this.shellWorkArea(monitor)), edges);
        const low = (edge, bound) => edges.includes(edge) ? bound : -Infinity;
        const high = (edge, bound) => edges.includes(edge) ? bound : Infinity;
        const frame = frameRect(window);
        let {x, y, width, height} = frame;
        if (resized) {
            const left = Math.max(x, low(G.Edge.LEFT, room.x));
            const top = Math.max(y, low(G.Edge.TOP, room.y));
            width = Math.min(x + width, high(G.Edge.RIGHT, room.x + room.width)) - left;
            height = Math.min(y + height, high(G.Edge.BOTTOM, room.y + room.height)) - top;
            [x, y] = [left, top];
        } else {
            const clear = (start, size, min, max) => Math.max(min, Math.min(start, max - size));
            x = clear(x, width, low(G.Edge.LEFT, room.x), high(G.Edge.RIGHT, room.x + room.width));
            y = clear(y, height, low(G.Edge.TOP, room.y), high(G.Edge.BOTTOM, room.y + room.height));
        }
        if (G.near(x, frame.x) && G.near(y, frame.y) && G.near(width, frame.width) && G.near(height, frame.height))
            return;
        console.debug(`glance: ${window.get_title()}: out of the tiles' strip`);
        this._parking.restore(window, {x, y, width, height}, {width, height}, monitor, frame);
    }
}
