// Glance for GNOME: windows shrink as they are dragged toward a screen edge
// and are parked there as small, live tiles. Based on Scott Jenson's Glance
// for KDE Plasma (https://github.com/scottjenson/Glance); its docs/
// describe the design.
//
// - draw.js: drawing a window somewhere other than its frame; menus follow.
// - drag.js: shrinking while dragging.
// - parking.js: parked windows, their columns and rows.
// - struts.js: the work area leaves out the tiles' strips.
// - icons.js: each tile shows its app's icon.
// - previews.js: hovering a tile grows it.
// - declutter.js: Super+double-click centers a window or parks everything;
//   shaking parks the other windows.
// - geometry.js: the rules, as pure functions.
// - config.js: the settings (prefs.js edits them).
// - compat.js: sharing the screen edges with Tiling Assistant.
// - overview.js: the overview and workspace switches show tiles as tiles.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TilingAssistant} from './compat.js';
import {migrateSettings} from './config.js';
import {Declutter} from './declutter.js';
import {WindowDrag} from './drag.js';
import {CloseAnimations, Popups} from './draw.js';
import {ShellPatches} from './overview.js';
import {ParkedWindows} from './parking.js';
import {HoverPreviews} from './previews.js';
import {TileStruts} from './struts.js';

// It stays enabled in the unlock dialog (metadata.json session-modes): else
// every screen lock would put all parked windows back to full size. Nothing
// reacts while locked (windows can't be dragged, hovered or clicked then).
export default class GlanceExtension extends Extension {
    enable() {
        this._turnOffEdgeTiling();
        this._settings = this.getSettings();
        migrateSettings(this._settings);
        this._popups = new Popups();
        this._closeAnimations = new CloseAnimations();
        this._parking = new ParkedWindows(this._settings);
        this._struts = new TileStruts(this._parking);
        this._shellPatches = null;
        this._syncShellPatches();
        this._settings.connectObject('changed::patch-overview', () => this._syncShellPatches(), this);
        this._declutter = new Declutter(this._parking, this._settings);
        this._tilingAssistant = new TilingAssistant();
        this._drag = new WindowDrag(this._parking, this._declutter, this._settings, this._tilingAssistant);
        this._previews = new HoverPreviews(this._parking);
    }

    disable() {
        this._previews.destroy();
        this._drag.destroy();
        this._tilingAssistant.destroy();
        this._declutter.destroy();
        this._settings.disconnectObject(this);
        this._shellPatches?.destroy();
        this._struts.destroy();
        this._parking.destroy();
        this._popups.destroy();
        this._closeAnimations.destroy();
        this._closeAnimations = null;
        this._previews = this._drag = this._tilingAssistant = this._declutter = this._shellPatches = null;
        this._parking = this._popups = this._struts = null;
        this._settings = null;
        this._restoreEdgeTiling();
    }

    // GNOME's overview and workspace switches patched to show tiles
    // (overview.js) if the setting says so.
    _syncShellPatches() {
        const want = this._settings.get_boolean('patch-overview');
        if (want && !this._shellPatches) {
            this._shellPatches = new ShellPatches(this._parking);
        } else if (!want && this._shellPatches) {
            this._shellPatches.destroy();
            this._shellPatches = null;
        }
    }

    // Mutter's edge tiling would snap a window dragged to a side; here it
    // shrinks instead. The user's setting is kept in a file until disable
    // puts it back, so a crash or a killed shell doesn't lose it.
    _turnOffEdgeTiling() {
        this._mutterSettings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._edgeTilingFile = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_state_dir(), this.uuid, 'edge-tiling']));
        try {
            const [, contents] = this._edgeTilingFile.load_contents(null);
            this._edgeTiling = new TextDecoder().decode(contents).trim() === 'true';
        } catch {
            this._edgeTiling = this._mutterSettings.get_boolean('edge-tiling');
            GLib.mkdir_with_parents(this._edgeTilingFile.get_parent().get_path(), 0o700);
            this._edgeTilingFile.replace_contents(new TextEncoder().encode(`${this._edgeTiling}\n`),
                null, false, Gio.FileCreateFlags.NONE, null);
        }
        this._mutterSettings.set_boolean('edge-tiling', false);
    }

    _restoreEdgeTiling() {
        this._mutterSettings.set_boolean('edge-tiling', this._edgeTiling);
        try {
            this._edgeTilingFile.delete(null);
        } catch (e) {
            console.warn(`glance: couldn't remove ${this._edgeTilingFile.get_path()}: ${e.message}`);
        }
        this._mutterSettings = this._edgeTilingFile = null;
    }
}
