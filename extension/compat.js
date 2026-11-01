// Sharing the screen edges with Tiling Assistant, which snaps a dragged
// window when the pointer comes within its preview area of a work-area
// edge: while the pointer is there, it snaps and windows don't shrink or
// park (see WindowDrag). Dropping a window that is shrinking before the
// pointer gets there parks it.

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'tiling-assistant@leleat-on-github';
const SCHEMA = 'org.gnome.shell.extensions.tiling-assistant';

export class TilingAssistant {
    constructor() {
        // Its settings while it is enabled, null if it isn't, undefined
        // until looked up again.
        this._settings = undefined;
        Main.extensionManager.connectObject('extension-state-changed', (manager, extension) => {
            if (extension.uuid === UUID)
                this._settings = undefined;
        }, this);
    }

    destroy() {
        Main.extensionManager.disconnectObject(this);
        this._settings = null;
    }

    // Whether Tiling Assistant snaps a window dragged with the pointer at
    // (x, y), in the work area `area`.
    snapsAt(x, y, area) {
        const settings = this._lookup();
        if (!settings)
            return false;
        const h = settings.get_int('horizontal-preview-area');
        const v = settings.get_int('vertical-preview-area');
        return x <= area.x + h || x >= area.x + area.width - h ||
            y <= area.y + v || y >= area.y + area.height - v;
    }

    _lookup() {
        if (this._settings !== undefined)
            return this._settings;
        this._settings = null;
        const extension = Main.extensionManager.lookup(UUID);
        if (extension?.state !== ExtensionState.ACTIVE)
            return null;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(
                extension.dir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup(SCHEMA, false);
            if (schema)
                this._settings = new Gio.Settings({settings_schema: schema});
        } catch (e) {
            console.warn(`glance: can't read Tiling Assistant's settings: ${e.message}`);
        }
        return this._settings;
    }
}
