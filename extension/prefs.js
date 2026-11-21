// The settings window, in tabs: where windows park and how close to an edge
// they must come, where they are stashed (as in Glance) and how they shrink
// on the way, and credits (see config.js).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const EDGES = [
    ['left', 'Left edge', null],
    ['right', 'Right edge', null],
    ['top', 'Top edge', 'Just below the top bar'],
    ['bottom', 'Bottom edge', 'Works best on large screens'],
];

const DIALOGS = "Dialogs, like this settings window, don't shrink, park or stash.";

export default class GlancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(this._parkingPage(settings));
        window.add(this._stashingPage(settings));
        window.add(this._aboutPage());
    }

    _edgeSwitches(settings, prefix, group) {
        for (const [edge, title, subtitle] of EDGES) {
            const row = new Adw.SwitchRow({title});
            if (subtitle)
                row.subtitle = subtitle;
            settings.bind(`${prefix}-${edge}`, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
    }

    _spinRow(settings, key, title, subtitle, lower, upper, step, digits) {
        const row = new Adw.SpinRow({
            title, subtitle, digits,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _parkingPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Parking', icon_name: 'sidebar-show-symbolic'});

        const edges = new Adw.PreferencesGroup({
            title: 'Park At',
            description: 'Drag a window to an edge parking is on at and it becomes a small, live tile ' +
                'there. ' + DIALOGS,
        });
        this._edgeSwitches(settings, 'park', edges);
        page.add(edges);

        const zone = new Adw.PreferencesGroup({title: 'Dragging'});
        zone.add(this._spinRow(settings, 'zone-percent', 'Edge zone width',
            'How close to an edge the pointer must come for a dragged window to shrink to tile ' +
            'size and park, in percent of the screen width', 1, 20, 0.5, 1));
        page.add(zone);

        const animations = new Adw.PreferencesGroup({title: 'Animations'});
        const patch = new Adw.SwitchRow({
            title: 'Tiles in overview and workspace switches',
            subtitle: "Parked windows stay tiles when switching workspaces and grow from their edge " +
                "in the overview. This changes GNOME's own animations: turn it off if a GNOME " +
                'update breaks them.',
        });
        settings.bind('patch-overview', patch, 'active', Gio.SettingsBindFlags.DEFAULT);
        animations.add(patch);
        page.add(animations);
        return page;
    }

    _stashingPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Stashing', icon_name: 'view-restore-symbolic'});

        const edges = new Adw.PreferencesGroup({
            title: 'Stash At',
            description: 'As in Glance for KDE: a window dragged toward an edge stashing is on at ' +
                'shrinks as its own edge nears the screen edge. Dropped there, it stays as small as it ' +
                'is, still usable (a stash). Where parking is on too, dropping it in the edge zone ' +
                'parks it. ' + DIALOGS,
        });
        this._edgeSwitches(settings, 'stash', edges);
        page.add(edges);

        const shrinking = new Adw.PreferencesGroup({title: 'Shrinking'});
        shrinking.add(this._spinRow(settings, 'glance-zone-percent', 'Start shrinking at',
            "The window's edge's distance from the screen edge, in percent of the screen width " +
            '(height for the top and bottom)', 5, 50, 1, 0));
        shrinking.add(this._spinRow(settings, 'glance-smallest-percent', 'Shrink down to',
            'The smallest a window gets before the edge zone, in percent of its full size',
            15, 90, 5, 0));
        page.add(shrinking);

        const shaking = new Adw.PreferencesGroup({title: 'Shaking'});
        const scatter = new Adw.SwitchRow({
            title: 'Shake stashes instead of parking',
            subtitle: 'Shaking a window (or Super+double-clicking the desktop) puts the other windows ' +
                'in a stash at each side stashing is on at, beside any tiles, as in Glance, instead ' +
                'of parking them',
        });
        settings.bind('scatter-stashes', scatter, 'active', Gio.SettingsBindFlags.DEFAULT);
        shaking.add(scatter);
        page.add(shaking);

        // The rest only matters with stashing on somewhere.
        const sync = () => {
            const on = EDGES.some(([edge]) => settings.get_boolean(`stash-${edge}`));
            shrinking.sensitive = shaking.sensitive = on;
        };
        for (const [edge] of EDGES)
            settings.connect(`changed::stash-${edge}`, sync);
        sync();
        return page;
    }

    // Credit to Glance, which inspired this extension.
    _aboutPage() {
        const page = new Adw.PreferencesPage({title: 'About', icon_name: 'help-about-symbolic'});
        const credit = new Adw.PreferencesGroup({
            title: 'Inspired by Glance',
            description: 'This extension is inspired by Glance, created by Scott Jenson. It is not ' +
                'a full port: it builds on some of his ideas and code, and changes or adds others.',
        });
        credit.add(this._linkRow('Glance for KDE Plasma, by Scott Jenson', 'https://github.com/scottjenson/Glance'));
        page.add(credit);

        const port = new Adw.PreferencesGroup({
            title: 'This extension',
            description: 'MIT License. Copyright (c) 2026 Scott Jenson (Glance) and Nikos Tourvas ' +
                '(Glance for GNOME).',
        });
        port.add(this._linkRow('Glance for GNOME', this.metadata.url));
        page.add(port);
        return page;
    }

    _linkRow(title, uri) {
        const row = new Adw.ActionRow({title, subtitle: uri, activatable: true});
        row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        row.connect('activated', () => new Gtk.UriLauncher({uri}).launch(row.get_root(), null, null));
        return row;
    }
}
