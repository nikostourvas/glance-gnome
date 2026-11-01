// GNOME's overview and workspace-switch animation show copies of windows
// (Clutter clones), which don't see how a parked window is drawn: they would
// show it at full size where its frame is. Patched (and put back on
// disable) so they show tiles where they are:
// - A workspace switch's copy of a tile gets the tile's scale and move.
// - The overview animates a parked window's preview from and to the
//   window at full size against its edge, centered on its tile (where its
//   hover preview would be; GNOME keeps a preview at least its grid size
//   while opening and closing, so it can't start from the tile itself); the
//   grid is still laid out with the window's real size. After closing, the
//   tile glides in from where its preview ended.
// These reach into GNOME's own (unstable) code, so each is applied only if
// what it patches is there, and anything going wrong in them falls back to
// GNOME's own behaviour (with one warning). The setting 'patch-overview'
// turns them off.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';
import {WorkspaceLayout} from 'resource:///org/gnome/shell/ui/workspace.js';
import {BaseWorkspaceGroup} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

import {Ticker, isDrawn} from './draw.js';

let warned = false;

function warnOnce(what, error) {
    if (warned)
        return;
    warned = true;
    console.warn(`glance: ${what} failed, falling back to GNOME's own behaviour: ${error}`);
}

export class ShellPatches {
    constructor(parking) {
        this._parking = parking;
        this._undo = [];
        this._patchWorkspaceSwitch();
        if (this._patchOverview())
            parking.overviewPatched = true;
    }

    destroy() {
        Main.overview.disconnectObject(this);
        this._recorder?.stop();
        this._undo.reverse().forEach(undo => undo());
        this._undo = [];
        this._parking.overviewPatched = false;
    }

    _patchWorkspaceSwitch() {
        this._patchMethod(BaseWorkspaceGroup.prototype, '_createClone', original => function (windowActor) {
            const clone = original.call(this, windowActor);
            try {
                if (clone && isDrawn(windowActor.meta_window)) {
                    const pivot = windowActor.pivot_point;
                    const [tx, ty] = windowActor.get_translation();
                    clone.set_pivot_point(pivot.x, pivot.y);
                    clone.set_scale(windowActor.scale_x, windowActor.scale_y);
                    clone.set_translation(tx, ty, 0);
                }
            } catch (e) {
                warnOnce('drawing a tile in a workspace switch', e);
            }
            return clone;
        });
    }

    // Whether it patched the overview.
    _patchOverview() {
        const parking = this._parking;
        const descriptor = Object.getOwnPropertyDescriptor(WindowPreview.prototype, 'boundingBox');
        const layoutMethods = ['_createBestLayout', '_getWindowSlots'];
        if (typeof descriptor?.get !== 'function' ||
            !layoutMethods.every(name => typeof WorkspaceLayout.prototype[name] === 'function')) {
            console.warn("glance: GNOME's overview isn't as expected, its parked windows are left as they are");
            return false;
        }

        // Where the overview animates a preview from and to: for a parked
        // window, at its tile (see above), except while the grid is laid out.
        let realBoxes = false;
        Object.defineProperty(WindowPreview.prototype, 'boundingBox', {
            configurable: true,
            get() {
                const box = descriptor.get.call(this);
                if (realBoxes)
                    return box;
                try {
                    const parked = parking.get(this.metaWindow);
                    return parked && !parked.restoring ? parking.fullAtEdge(this.metaWindow) : box;
                } catch (e) {
                    warnOnce('placing a tile in the overview', e);
                    return box;
                }
            },
        });
        this._undo.push(() => Object.defineProperty(WindowPreview.prototype, 'boundingBox', descriptor));
        for (const name of layoutMethods) {
            this._patchMethod(WorkspaceLayout.prototype, name, original => function (...args) {
                realBoxes = true;
                try {
                    return original.apply(this, args);
                } finally {
                    realBoxes = false;
                }
            });
        }

        // While the overview closes, where each tile's preview is (the
        // previews are gone by the time it has closed).
        this._lastPreviews = new Map();
        this._recorder = new Ticker(() => {
            this._recordPreviews();
            return true;
        });
        Main.overview.connectObject(
            'hiding', () => this._recorder.start(),
            'hidden', () => this._glideFromPreviews(), this);
        return true;
    }

    _patchMethod(prototype, name, make) {
        const original = prototype[name];
        if (typeof original !== 'function') {
            console.warn(`glance: GNOME has no ${name} any more, left as it is`);
            return;
        }
        prototype[name] = make(original);
        this._undo.push(() => {
            prototype[name] = original;
        });
    }

    _recordPreviews() {
        try {
            for (const [window, parked] of this._parking.entries()) {
                const preview = window._delegate;
                if (parked.restoring || !(preview instanceof WindowPreview) || !preview.windowContainer)
                    continue;
                const extents = preview.windowContainer.get_transformed_extents();
                if (extents.size.width > 0) {
                    this._lastPreviews.set(window, {
                        x: extents.origin.x, y: extents.origin.y,
                        width: extents.size.width, height: extents.size.height,
                    });
                }
            }
        } catch (e) {
            warnOnce('following the overview closing', e);
        }
    }

    _glideFromPreviews() {
        this._recorder.stop();
        for (const [window, from] of this._lastPreviews) {
            const parked = this._parking.get(window);
            if (parked && !parked.restoring && window.showing_on_its_workspace())
                this._parking.glideFrom(window, from);
        }
        this._lastPreviews.clear();
    }
}
