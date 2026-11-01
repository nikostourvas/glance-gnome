// Tiling Assistant: snap Calculator to the right half (header drag into the
// right edge), then Super+drag it into the left edge; returns its frames.
const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === 'org.gnome.Calculator');
const frame = () => { const f = w.get_frame_rect(); return [f.x, f.y, f.width, f.height]; };
const r = [];
w.move_resize_frame(true, 900, 200, 360, 616);
await dev.sleep(500);
w.activate(global.get_current_time());
await dev.sleep(300);
let f = w.get_frame_rect();
await dev.drag([[f.x + 90, f.y + 20], [f.x + 96, f.y + 24], [2400, 400], [2556, 400]], {steps: 25});
await dev.sleep(1500);
r.push(['snapped right', frame()]);
w.activate(global.get_current_time());
await dev.sleep(300);
f = w.get_frame_rect();
const [x, y] = [f.x + f.width / 2, f.y + f.height / 2];
await dev.drag([[x, y], [x - 6, y], [1280, 500], [3, 500]], {superKey: true, steps: 30});
await dev.sleep(1500);
r.push(['super-dragged into left edge', frame()]);
return r;
