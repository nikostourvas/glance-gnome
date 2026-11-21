// Stashing a window (dragged toward a side) and parking one (dragged to the
// very edge).
const demo = {
    async setup() {
        const calendar = await open('org.gnome.Calendar');
        const notes = await editor('Notes.txt');
        const calculator = await open('org.gnome.Calculator');
        place(calendar, 420, 110, 1080, 760);
        place(notes, 760, 260, 860, 640);
        place(calculator, 240, 330);
        await dev.sleep(500);
        calendar.activate(global.get_current_time());
        await dev.sleep(200);
        calculator.activate(global.get_current_time());
        await dev.sleep(200);
        notes.activate(global.get_current_time());
        await glide([960, 1000], 1);
    },

    async act() {
        const notes = windowOf('org.gnome.TextEditor');
        const calculator = windowOf('org.gnome.Calculator');
        await dev.sleep(500);

        caption('Drag a window toward a side: it shrinks');
        let [x, y, width] = drawn(notes);
        await glide([x + width / 2, y + 22], 700);
        await drag([[x + width / 2 + 360, y + 60]], 1600);
        caption('Let go: it stays there as a stash, still usable');
        await glide([960, 1000], 600);
        await dev.sleep(1800);

        caption('Drag one to the very edge: it parks as a tile');
        [x, y, width] = drawn(calculator);
        await glide([x + width * 0.3, y + 22], 700);
        await drag([[4, 520]], 1400);
        await glide([520, 1000], 600);
        await dev.sleep(1200);

        caption('Rest the pointer on a tile to use it');
        await glide(middle(drawn(calculator)), 700);
        await dev.sleep(1800);
        await glide([520, 1000], 600);
        await dev.sleep(1000);
        caption(null);
        await dev.sleep(400);
        return [glance._parking.isStashed(notes), glance._parking.isParked(calculator)].join();
    },
};
