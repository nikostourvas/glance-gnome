// Parks Calculator and Text Editor at the right edge (both must be open):
// they should form one centered column of tiles, apps laid out as squares.
// Run: NESTED=headless dev/eval.sh "$(cat dev/tests/park-right.js)"
const frames = () => Object.fromEntries(global.get_window_actors().map(
    a => [a.meta_window.get_wm_class(), a.meta_window.get_frame_rect()]));
const screen = global.display.get_monitor_geometry(0);
const edge = screen.x + screen.width - 8;
const c = frames()['org.gnome.Calculator'];
await dev.drag([[c.x + c.width * 0.25, c.y + 20], [c.x + c.width * 0.25 + 6, c.y + 24], [edge, 400]]);
await dev.sleep(500);
const e = frames()['org.gnome.TextEditor'];
await dev.drag([[e.x + 220, e.y + 22], [e.x + 226, e.y + 26], [edge, 700]], {steps: 40});
await dev.sleep(800);
return dev.windows().map(w => [w.title, w.frame, w.scale]);
