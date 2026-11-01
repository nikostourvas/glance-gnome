// Parks Text Editor, Calculator and Files along the bottom edge (Super+drag
// from each center), and Settings at the right edge.
// Run: NESTED=headless dev/eval.sh "$(cat dev/tests/park-bottom.js)"
Main.overview.hide();
await dev.sleep(600);
const screen = global.display.get_monitor_geometry(0);
const find = cls => global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === cls);
const park = async (cls, x, y) => {
    const w = find(cls);
    w.activate(global.get_current_time());
    await dev.sleep(300);
    const f = w.get_frame_rect();
    const [cx, cy] = [f.x + f.width / 2, f.y + f.height / 2];
    await dev.drag([[cx, cy], [cx, cy + 6], [x, y]], {superKey: true, steps: 30});
    await dev.sleep(700);
};
const bottom = screen.y + screen.height - 2;
await park('org.gnome.TextEditor', 900, bottom);
await park('org.gnome.Calculator', 1300, bottom);
await park('org.gnome.Nautilus', 1700, bottom);
await park('org.gnome.Settings', screen.x + screen.width - 2, 500);
return [Main.overview.visible, dev.windows().map(w => [w.title.slice(0, 10), w.scale])];
