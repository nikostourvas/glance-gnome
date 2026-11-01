// Parks every normal window not yet drawn small at the right edge, with
// Super+drag from its center (each raised first), at the heights in `ys`.
// Run: NESTED=headless dev/eval.sh "$(cat dev/tests/park-all-right.js)"
Main.overview.hide();
await dev.sleep(600);
const screen = global.display.get_monitor_geometry(0);
const windows = global.get_window_actors()
    .filter(a => a.meta_window.get_window_type() === 0 && a.scale_x === 1)
    .map(a => a.meta_window);
const ys = [250, 450, 650, 850];
for (const [i, w] of windows.entries()) {
    w.activate(global.get_current_time());
    await dev.sleep(300);
    const f = w.get_frame_rect();
    const [x, y] = [f.x + f.width / 2, f.y + f.height / 2];
    await dev.drag([[x, y], [x + 6, y], [screen.x + screen.width - 4, ys[i % ys.length]]], {superKey: true, steps: 30});
    await dev.sleep(600);
}
return [Main.overview.visible, dev.windows().map(w => [w.title, w.frame, w.scale])];
