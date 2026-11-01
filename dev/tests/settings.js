// Exercises the settings: top parking, an edge switched off with a tile on
// it, all edges off, and the zone width. Needs Text Editor, Calculator and
// Files open. Run: NESTED=headless dev/eval.sh "$(cat dev/tests/tiles.js) $(cat dev/tests/settings.js)"
const settings = Main.extensionManager.lookup('glance-gnome@nikostourvas.github.io').stateObj._settings;
const r = [];
Main.overview.hide();
await dev.sleep(600);
const find = cls => global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === cls);
const screen = global.display.get_monitor_geometry(0);
const superDrag = async (w, x, y) => {
    w.activate(global.get_current_time());
    await dev.sleep(300);
    const a = w.get_compositor_private();
    const [ax, ay] = a.get_transformed_position();
    const [aw, ah] = a.get_transformed_size();
    const [cx, cy] = [ax + aw / 2, ay + ah / 2];
    await dev.drag([[cx, cy], [cx, cy - 6], [x, y]], {superKey: true, steps: 30});
    await dev.sleep(800);
};
for (const key of ['park-left', 'park-right', 'park-top', 'park-bottom'])
    settings.reset(key);
settings.reset('zone-percent');
settings.set_boolean('park-top', true);
await superDrag(find('org.gnome.TextEditor'), 1280, 1);
r.push(['top', drawn()]);
const te = drawn().find(d => d[0].startsWith('abfds'));
dev.move(1280, 600);
await dev.sleep(100);
dev.move(te[1] + te[3] / 2, te[2] + te[4] / 2);
await dev.sleep(900);
r.push(['top preview', drawn().filter(d => d[0].startsWith('abfds'))]);
dev.move(1280, 700);
await dev.sleep(900);
await superDrag(find('org.gnome.Calculator'), screen.width - 2, 500);
r.push(['right', drawn()]);
settings.set_boolean('park-right', false);
await dev.sleep(800);
r.push(['right off', drawn()]);
for (const key of ['park-left', 'park-top'])
    settings.set_boolean(key, false);
await dev.sleep(1800);
r.push(['all off', drawn()]);
settings.set_boolean('park-left', true);
const f = find('org.gnome.Nautilus');
await superDrag(f, 150, 500);
r.push(['x=150 at 2%', drawn().filter(d => d[0] === 'Home')]);
settings.set_double('zone-percent', 10);
await superDrag(f, 150, 500);
r.push(['x=150 at 10%', drawn().filter(d => d[0] === 'Home')]);
for (const key of ['park-left', 'park-right', 'park-top', 'park-bottom'])
    settings.reset(key);
settings.reset('zone-percent');
return r;
