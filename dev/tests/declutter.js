// Super+double-clicks a window (by WM class, default Text Editor), or the
// desktop if the class is "desktop". Twice in a row undoes.
// Run: NESTED=headless dev/eval.sh "const target = 'org.gnome.TextEditor'; $(cat dev/tests/declutter.js)"
const {Clutter} = imports.gi;
let x, y;
if (target === 'desktop') {
    [x, y] = [20, 600];
} else {
    const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === target);
    const a = w.get_compositor_private();
    const [ax, ay] = a.get_transformed_position();
    const [aw, ah] = a.get_transformed_size();
    [x, y] = [ax + aw / 2, ay + ah / 2];
}
dev.key(Clutter.KEY_Super_L, true);
await dev.click(x, y);
await dev.click(x, y);
dev.key(Clutter.KEY_Super_L, false);
await dev.sleep(1500);
return [Main.overview.visible, dev.windows().map(w => [w.title, w.frame, w.scale])];
