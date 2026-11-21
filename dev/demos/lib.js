// Helpers for the demo recordings: dev/demo.sh runs a demo with this file in
// front of it, in the nested shell (see dev/eval.sh).
const {Clutter, Gio, GLib, Meta, St} = imports.gi;
const screen = global.display.get_monitor_geometry(0);
const glance = Main.extensionManager.lookup('glance-gnome@nikostourvas.github.io').stateObj;

let at = global.get_pointer().slice(0, 2);
const ease = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Moves the pointer to [x, y], easing in and out, in about `ms`.
async function glide([x, y], ms = 600) {
    const [fx, fy] = at;
    const n = Math.max(1, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) {
        const k = ease(i / n);
        at = [fx + (x - fx) * k, fy + (y - fy) * k];
        dev.move(...at);
        await dev.sleep(16);
    }
}

// Drags from where the pointer is through `points`, each in about `ms`.
async function drag(points, ms = 900, {superKey = false} = {}) {
    if (superKey)
        dev.key(Clutter.KEY_Super_L, true);
    dev.press();
    await dev.sleep(150);
    for (const point of points)
        await glide(point, ms);
    await dev.sleep(150);
    dev.release();
    if (superKey)
        dev.key(Clutter.KEY_Super_L, false);
    await dev.sleep(300);
}

// Shakes `window`, grabbed by its title bar, from side to side.
async function shake(window, {strokes = 6, width = 150} = {}) {
    const [x, y, w] = drawn(window);
    const grab = [x + w / 2, y + 22];
    await glide(grab, 600);
    dev.press();
    await dev.sleep(150);
    await glide([grab[0], grab[1] + 12], 150);
    for (let i = 0; i < strokes; i++)
        await glide([grab[0] + (i % 2 ? -width : width) / (i ? 1 : 2), grab[1] + 12], 120);
    await glide([grab[0], grab[1] + 12], 200);
    await dev.sleep(150);
    dev.release();
    await dev.sleep(300);
}

async function doubleClick({superKey = false} = {}) {
    if (superKey)
        dev.key(Clutter.KEY_Super_L, true);
    for (let i = 0; i < 2; i++) {
        dev.press();
        await dev.sleep(60);
        dev.release();
        await dev.sleep(90);
    }
    if (superKey)
        dev.key(Clutter.KEY_Super_L, false);
    await dev.sleep(300);
}

// A caption at the bottom middle of the screen (none: hides it).
function caption(text) {
    let label = globalThis.demoCaption;
    if (!label) {
        label = globalThis.demoCaption = new St.Label({
            style: 'font-size: 26px; font-weight: bold; color: white; ' +
                'background-color: rgba(0, 0, 0, 0.75); border-radius: 999px; ' +
                'padding: 12px 28px;',
            opacity: 0,
        });
        Main.layoutManager.uiGroup.add_child(label);
    }
    Main.layoutManager.uiGroup.set_child_above_sibling(label, null);
    if (text) {
        label.text = text;
        const [, width] = label.get_preferred_width(-1);
        const [, height] = label.get_preferred_height(width);
        label.set_position(Math.round(screen.x + (screen.width - width) / 2),
            Math.round(screen.y + screen.height - height - 60));
    }
    label.ease({opacity: text ? 255 : 0, duration: 200});
}

const windowOf = wmClass => global.get_window_actors().map(a => a.meta_window)
    .find(w => w.get_wm_class() === wmClass);
const normalWindows = () => global.get_window_actors().map(a => a.meta_window)
    .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);

// Runs `start` and waits for the new window it opens.
async function launch(start, what) {
    const before = new Set(normalWindows());
    start();
    for (let i = 0; i < 150; i++) {
        const window = normalWindows().find(w => !before.has(w));
        if (window) {
            await dev.sleep(600);
            return window;
        }
        await dev.sleep(100);
    }
    throw new Error(`${what} didn't open a window`);
}

// Starts an app by its desktop file id (optionally with files).
function open(id, files = []) {
    const app = Gio.DesktopAppInfo.new(`${id}.desktop`);
    return launch(() => app.launch(files.map(f => Gio.File.new_for_path(f)),
        global.create_app_launch_context(0, -1)), id);
}

// Runs a command (an array of arguments).
function run(argv) {
    return launch(() => GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null), argv[0]);
}

// A demo document in a Text Editor window of its own.
const editor = name => run(['gnome-text-editor', '--new-window', demoFile(`documents/${name}`, name)]);

function place(window, x, y, width, height) {
    if (window.is_maximized())
        window.unmaximize();
    window.move_resize_frame(false, x, y, width ?? window.get_frame_rect().width,
        height ?? window.get_frame_rect().height);
}

// Where a window's frame (without its shadow) is drawn now: [x, y, width,
// height].
function drawn(window) {
    const box = window.get_compositor_private().get_transformed_extents();
    const f = window.get_frame_rect(), b = window.get_buffer_rect();
    const scale = box.size.width / b.width;
    return [box.origin.x + (f.x - b.x) * scale, box.origin.y + (f.y - b.y) * scale,
        f.width * scale, f.height * scale];
}

// A file of the demo folder, copied to the demo's home folder (see
// dev/nested-session.sh), so that its real path doesn't show.
function demoFile(name, as = name.split('/').pop()) {
    const to = Gio.File.new_for_path(`${GLib.get_home_dir()}/Documents/${as}`);
    Gio.File.new_for_path(`${DEMOS}/${name}`).copy(to, Gio.FileCopyFlags.OVERWRITE, null, null);
    return to.get_path();
}

// Keeps the recording and unsafe-mode (dev helper) icons out of the top bar.
for (const name of ['_remoteAccess', '_unsafeMode']) {
    const indicator = Main.panel.statusArea.quickSettings[name];
    if (indicator && !indicator._demoHidden) {
        indicator._demoHidden = true;
        indicator.hide();
        indicator.connect('notify::visible', () => indicator.visible && indicator.hide());
    }
}

const middle = ([x, y, width, height]) => [x + width / 2, y + height / 2];
