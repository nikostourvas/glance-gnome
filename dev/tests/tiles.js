// Where each window is drawn: [title, x, y, width, height, scale], top to bottom.
const drawn = () => global.get_window_actors().filter(a => a.meta_window.get_window_type() === 0).map(a => {
    const w = a.meta_window, f = w.get_frame_rect(), b = w.get_buffer_rect(), s = a.scale_x;
    const [tx, ty] = a.get_translation();
    return [w.get_title().slice(0, 10), Math.round(a.x + tx + (f.x - b.x) * s), Math.round(a.y + ty + (f.y - b.y) * s),
        Math.round(f.width * s), Math.round(f.height * s), +s.toFixed(2)];
}).sort((p, q) => p[2] - q[2]);
