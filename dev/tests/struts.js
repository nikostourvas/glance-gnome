// Room kept for tiles (struts.js): with Calculator parked at the left edge,
// Mutter's work area leaves out the strip (GNOME Shell's stays whole), a
// maximized Text Editor and a Files window that was over the strip move
// right of it, a fullscreen Files covers the tile, another workspace keeps
// its whole work area, and unparking gives the strip back. Needs those
// three apps open (dev/open.sh gnome-text-editor, gnome-calculator,
// nautilus).
// Run: NESTED=headless dev/eval.sh "$(cat dev/tests/struts.js)"
const {Meta} = imports.gi;
const glance = Main.extensionManager.lookup('glance-gnome@nikostourvas.github.io').stateObj;
const byClass = c => global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === c);
const editor = byClass('org.gnome.TextEditor');
const calc = byClass('org.gnome.Calculator');
const files = byClass('org.gnome.Nautilus');
const frame = w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; };
const workArea = (i = 0) => {
    const r = global.workspace_manager.get_workspace_by_index(i).get_work_area_for_monitor(0);
    return [r.x, r.y, r.width, r.height];
};
const shellArea = () => { const r = Main.layoutManager.getWorkAreaForMonitor(0); return [r.x, r.y, r.width, r.height]; };
const out = {};
const note = key => {
    out[key] = {workArea: workArea(), shellArea: shellArea(), editor: frame(editor), files: frame(files)};
};

for (const w of [editor, calc, files]) {
    if (w.is_maximized())
        w.unmaximize();
}
await dev.sleep(300);
calc.move_frame(true, 700, 300);
files.move_resize_frame(true, 40, 300, 800, 500);
editor.set_maximize_flags(Meta.MaximizeFlags.BOTH);
await dev.sleep(800);
note('before');

glance._parking.toParking(calc, 0 /* G.Edge.LEFT */, 0);
await dev.sleep(1000);
note('parked');
out.parked.otherWorkspace = workArea(1);
out.parked.tile = glance._parking.get(calc)?.shown;

files.make_fullscreen();
await dev.sleep(800);
out.fullscreen = {files: frame(files),
    top: global.display.sort_windows_by_stacking([calc, files]).at(-1).get_wm_class()};
files.unmake_fullscreen();
await dev.sleep(800);

glance._parking.unpark(calc);
await dev.sleep(1500);
note('unparked');
editor.unmaximize();
return JSON.stringify(out);
