// Windows the user moves over the tiles' strip leave it (struts.js
// _clear): with Calculator a tile at the left (parking only there, edge zone
// 20%, stashing off), Text Editor dropped over the strip glides right of
// it, its left edge resized into the strip comes back out of it, and Files,
// partly off screen at the left, moves out once the tile is there. Needs
// those three apps open; best at SIZE=1280x800.
// Run: NESTED=headless dev/eval.sh "$(cat dev/tests/struts-drop.js)"
const {Meta} = imports.gi;
const glance = Main.extensionManager.lookup('glance-gnome@nikostourvas.github.io').stateObj;
const settings = glance._settings;
for (const [key, value] of [['park-left', true], ['park-right', false], ['park-top', false], ['park-bottom', false],
    ['stash-left', false], ['stash-right', false], ['stash-top', false], ['stash-bottom', false]])
    settings.set_boolean(key, value);
settings.set_double('zone-percent', 20);
const byClass = c => global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === c);
const editor = byClass('org.gnome.TextEditor');
const calc = byClass('org.gnome.Calculator');
const files = byClass('org.gnome.Nautilus');
const frame = w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; };
const out = {};
for (const w of [editor, calc, files]) {
    if (w.is_maximized())
        w.unmaximize();
}
await dev.sleep(300);
editor.move_resize_frame(true, 300, 100, 800, 560);
calc.move_frame(true, 700, 120);
files.move_resize_frame(true, -120, 150, 700, 500);
await dev.sleep(600);
out.before = {files: frame(files)};

glance._parking.toParking(calc, 0 /* G.Edge.LEFT */, 0);
await dev.sleep(1200);
out.tileCame = {files: frame(files), workArea: (r => [r.x, r.y, r.width])(global.workspace_manager.get_active_workspace().get_work_area_for_monitor(0))};

// Text Editor Super+dragged so that it covers the tiles, the pointer well
// outside the edge zone.
editor.activate(global.get_current_time());
await dev.sleep(300);
let e = editor.get_frame_rect();
const grab = [e.x + e.width / 2, e.y + e.height / 2];
await dev.drag([grab, [grab[0] + 6, grab[1] + 4], [grab[0] - 300, grab[1]]], {steps: 30, superKey: true});
out.dropped = {editor: frame(editor)};
await dev.sleep(1200);
out.afterDrop = {editor: frame(editor), parked: !!glance._parking.get(editor), files: frame(files),
    top: global.display.sort_windows_by_stacking([editor, files]).at(-1).get_wm_class()};

// Its left edge dragged into the strip.
e = editor.get_frame_rect();
await dev.drag([[e.x - 3, e.y + 200], [e.x - 9, e.y + 200], [60, e.y + 200]], {steps: 30});
out.resized = {editor: frame(editor)};
await dev.sleep(1200);
out.afterResize = {editor: frame(editor)};
return JSON.stringify(out);
