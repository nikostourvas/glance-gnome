// Each tile shows its app's icon, as the overview's window previews do, but
// inside the tile, whose neighbours are close (the overview's hangs over the
// window's bottom edge). The icon is a child of the window's actor: it moves
// with the tile, and a window over the tile covers it too. Scaled against the
// tile's scale, it stays one size and sharp. It isn't reactive, so clicks go
// through it to the window. It fades out while the tile is previewed.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as G from './geometry.js';

const ICON_SIZE = 48;
// Between the icon and the tile's bottom edge.
const ICON_MARGIN = 6;

// A workspace switch's copies of tiles, which have the tile's scale (see
// overview.js).
const tileCopies = new Set();

export function addTileCopy(clone) {
    tileCopies.add(clone);
    clone.connect('destroy', () => tileCopies.delete(clone));
}

const TileIcon = GObject.registerClass(
class TileIcon extends St.Bin {
    // Other copies of the window (the overview's, which have their own icon,
    // and Alt+Tab's) don't have the tile's scale: there it would come out
    // huge.
    vfunc_paint(context) {
        if (tileCopies.size > 0 || !this.is_in_clone_paint())
            super.vfunc_paint(context);
    }
});

export class TileIcons {
    constructor() {
        this._icons = new Map();
    }

    // Puts `window`'s icon at the bottom of its tile, drawn at (x, y) at
    // `scale`, fading in or out as `show` says.
    update(window, x, y, scale, show) {
        const actor = window.get_compositor_private();
        const icon = this._icons.get(window) ?? (show && actor ? this._create(window, actor) : null);
        if (!icon)
            return;
        // The actor is at the buffer's top-left (see draw.js).
        const frame = window.get_frame_rect();
        const buffer = window.get_buffer_rect();
        const width = frame.width * scale;
        const height = frame.height * scale;
        // Smaller only on a tile too short for it.
        const fit = Math.min(1, height / (ICON_SIZE + 2 * ICON_MARGIN));
        const size = ICON_SIZE * fit;
        // On whole pixels, to stay sharp.
        const left = Math.round(x + (width - size) / 2);
        const top = Math.round(y + height - size - ICON_MARGIN * fit);
        icon.set_scale(fit / scale, fit / scale);
        icon.set_position((left - x) / scale + frame.x - buffer.x, (top - y) / scale + frame.y - buffer.y);
        if (icon.show !== show) {
            icon.show = show;
            icon.ease({
                opacity: show ? 255 : 0,
                duration: G.animationTime,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    remove(window) {
        this._icons.get(window)?.destroy();
    }

    _create(window, actor) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app)
            return null;
        const texture = app.create_icon_texture(ICON_SIZE);
        texture.add_style_class_name?.('icon-dropshadow');
        const icon = new TileIcon({child: texture, opacity: 0});
        actor.add_child(icon);
        // It also goes when the actor does.
        icon.connect('destroy', () => this._icons.delete(window));
        this._icons.set(window, icon);
        return icon;
    }
}
