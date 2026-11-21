// The settings window: which screen edges windows park at, how wide the
// edge zones are, and whether windows are dragged as in Glance (see
// config.js).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const EDGES = [
    ['park-left', 'Left edge', null],
    ['park-right', 'Right edge', null],
    ['park-top', 'Top edge', 'Just below the top bar'],
    ['park-bottom', 'Bottom edge', 'Works best on large screens'],
];

export default class GlancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Settings', icon_name: 'preferences-system-symbolic'});

        const edges = new Adw.PreferencesGroup({
            title: 'Parking Areas',
            description: 'Drag a window to an enabled screen edge to park it there as a small tile.',
        });
        for (const [key, title, subtitle] of EDGES) {
            const row = new Adw.SwitchRow({title});
            if (subtitle)
                row.subtitle = subtitle;
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            edges.add(row);
        }
        page.add(edges);

        const zone = new Adw.PreferencesGroup({
            title: 'Dragging',
            description: "Dialogs, like this settings window, don't shrink, park or stash.",
        });
        const width = new Adw.SpinRow({
            title: 'Edge zone width',
            subtitle: 'How close to an edge the pointer must come for a dragged window to shrink ' +
                'to tile size and park, in percent of the screen width',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 20, step_increment: 0.5, page_increment: 1}),
            digits: 1,
        });
        settings.bind('zone-percent', width, 'value', Gio.SettingsBindFlags.DEFAULT);
        zone.add(width);
        const glance = new Adw.ExpanderRow({
            title: 'Drag and stash as in Glance',
            subtitle: 'As in Glance for KDE: a dragged window starts shrinking farther out, once its ' +
                'edge comes near an edge. Dropped there, it stays as small as it is (a stash); ' +
                'dropped in the edge zone, it parks',
            show_enable_switch: true,
        });
        settings.bind('glance-dragging', glance, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
        // Its settings show whenever it is on.
        settings.bind('glance-dragging', glance, 'expanded', Gio.SettingsBindFlags.GET);
        const start = new Adw.SpinRow({
            title: 'Start shrinking at',
            subtitle: "The window's edge's distance from the screen edge, in percent of the screen " +
                'width (height for the top and bottom)',
            adjustment: new Gtk.Adjustment({lower: 5, upper: 50, step_increment: 1, page_increment: 5}),
            digits: 0,
        });
        settings.bind('glance-zone-percent', start, 'value', Gio.SettingsBindFlags.DEFAULT);
        glance.add_row(start);
        const smallest = new Adw.SpinRow({
            title: 'Shrink down to',
            subtitle: 'The smallest a window gets before the edge zone, in percent of its full size',
            adjustment: new Gtk.Adjustment({lower: 15, upper: 90, step_increment: 5, page_increment: 10}),
            digits: 0,
        });
        settings.bind('glance-smallest-percent', smallest, 'value', Gio.SettingsBindFlags.DEFAULT);
        glance.add_row(smallest);
        const scatter = new Adw.SwitchRow({
            title: 'Shake stashes instead of parking',
            subtitle: 'Shaking a window (or Super+double-clicking the desktop) puts the other windows ' +
                'in a stash beside the tiles at each side, as in Glance, instead of parking them',
        });
        settings.bind('scatter-stashes', scatter, 'active', Gio.SettingsBindFlags.DEFAULT);
        glance.add_row(scatter);
        zone.add(glance);
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

        window.add(page);
        window.add(this._aboutPage());
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
