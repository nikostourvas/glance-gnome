// Development only, loaded in the nested session by dev/run-nested.sh:
// puts the shell in unsafe mode so dev/eval.sh can run code in it, and
// gives that code `dev`: a virtual pointer and keyboard for scripted drags,
// and a summary of the windows.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const sleep = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

const now = () => GLib.get_monotonic_time();

export default class DevHelper extends Extension {
    enable() {
        global.context.unsafe_mode = true;
        const seat = global.stage.context.get_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._devices = [pointer, keyboard];

        // When an X11 app starts (in a session started with X11=1), GNOME
        // Shell starts the session's X11 services as systemd units, which
        // fails in the distrobox, and then Mutter doesn't manage X11 windows:
        // carry on without those services.
        this._startX11Services = Main.wm._startX11Services;
        Main.wm._startX11Services = task => task.return_boolean(true);

        globalThis.dev = {
            sleep,
            move(x, y) {
                pointer.notify_absolute_motion(now(), x, y);
            },
            press(button = Clutter.BUTTON_PRIMARY) {
                pointer.notify_button(now(), button, Clutter.ButtonState.PRESSED);
            },
            release(button = Clutter.BUTTON_PRIMARY) {
                pointer.notify_button(now(), button, Clutter.ButtonState.RELEASED);
            },
            key(keyval, pressed) {
                keyboard.notify_keyval(now(), keyval,
                    pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
            },
            async click(x, y, button = Clutter.BUTTON_PRIMARY) {
                this.move(x, y);
                await sleep(50);
                this.press(button);
                await sleep(50);
                this.release(button);
                await sleep(100);
            },
            // Presses at the first point, moves through the others (each in
            // `steps` steps, `ms` apart), releases at the last. With `superKey`,
            // holds Super throughout (Mutter's move-anywhere modifier).
            async drag(points, {steps = 20, ms = 16, superKey = false, release = true} = {}) {
                if (superKey)
                    this.key(Clutter.KEY_Super_L, true);
                let [x, y] = points[0];
                this.move(x, y);
                await sleep(50);
                this.press();
                await sleep(50);
                for (const [tx, ty] of points.slice(1)) {
                    const [fx, fy] = [x, y];
                    for (let i = 1; i <= steps; i++) {
                        x = fx + (tx - fx) * i / steps;
                        y = fy + (ty - fy) * i / steps;
                        this.move(x, y);
                        await sleep(ms);
                    }
                }
                if (release) {
                    await sleep(100);
                    this.release();
                }
                if (superKey)
                    this.key(Clutter.KEY_Super_L, false);
                await sleep(300);
            },
            windows() {
                return global.get_window_actors().map(actor => {
                    const w = actor.meta_window;
                    const f = w.get_frame_rect();
                    const b = w.get_buffer_rect();
                    const [tx, ty] = actor.get_translation();
                    return {
                        title: w.get_title(),
                        type: w.get_window_type(),
                        transientFor: w.get_transient_for()?.get_title() ?? null,
                        frame: [f.x, f.y, f.width, f.height],
                        buffer: [b.x, b.y, b.width, b.height],
                        actor: [actor.x, actor.y],
                        scale: +actor.scale_x.toFixed(3),
                        translation: [+tx.toFixed(1), +ty.toFixed(1)],
                    };
                });
            },
        };
    }

    disable() {
        Main.wm._startX11Services = this._startX11Services;
        delete globalThis.dev;
        this._devices = null;
    }
}
