// Super+clicks a window `clicks` times (default 3: a triple-click), the
// window found by its title starting with `target`, at its middle.
// Run: NESTED=headless dev/eval.sh "const target = 'Characters'; $(cat dev/tests/tile.js)"
const {Clutter} = imports.gi;
const times = typeof clicks === 'number' ? clicks : 3;
const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_title().startsWith(target));
const a = w.get_compositor_private();
const [ax, ay] = a.get_transformed_position();
const [aw, ah] = a.get_transformed_size();
const [x, y] = [ax + aw / 2, ay + ah / 2];
dev.key(Clutter.KEY_Super_L, true);
for (let i = 0; i < times; i++)
    await dev.click(x, y);
dev.key(Clutter.KEY_Super_L, false);
await dev.sleep(1800);
const glance = Main.extensionManager.lookup('glance-gnome@nikostourvas.github.io').stateObj;
return dev.windows().map(w => [w.title.slice(0, 12), w.frame, w.scale]);
