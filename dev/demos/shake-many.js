// Shaking a window with more others open than can stash whole (at the
// default "Shrink down to", 70%): they park as tiles instead.
const demo = {
    async setup() {
        const windows = [
            await open('org.gnome.clocks'),
            await run(['loupe', '/usr/share/backgrounds/gnome/amber-l.jxl']),
            await open('org.gnome.Characters'),
            await editor('Recipes.txt'),
            await run(['loupe', '/usr/share/backgrounds/gnome/blendpills-l.jxl']),
            await open('org.gnome.Calculator'),
        ];
        const spots = [[120, 90], [1040, 70], [260, 420], [760, 140], [1100, 380], [1420, 260]];
        windows.forEach((window, i) => place(window, ...spots[i], 820, 600));
        place(windows[5], 1420, 260);
        const notes = await editor('Notes.txt');
        place(notes, 560, 300, 800, 600);
        await dev.sleep(500);
        notes.activate(global.get_current_time());
        await glide([960, 1000], 1);
        return windows.length + 1;
    },

    async act() {
        const notes = global.display.focus_window;
        await dev.sleep(500);
        caption('Too many windows open?');
        await dev.sleep(1600);
        caption('Shake one! The rest park as tiles');
        await shake(notes);
        await glide([960, 1000], 500);
        await dev.sleep(2400);
        caption('Rest the pointer on one to use it');
        const tiles = normalWindows().filter(w => glance._parking.isParked(w) && drawn(w)[0] > screen.width / 2)
            .sort((a, b) => drawn(a)[1] - drawn(b)[1]);
        const tile = tiles[Math.floor(tiles.length / 2)];
        await glide(middle(drawn(tile)), 800);
        await dev.sleep(1800);
        await glide([1250, 900], 600);
        await dev.sleep(1000);
        caption(null);
        await dev.sleep(400);
        return `${normalWindows().filter(w => glance._parking.isParked(w)).length} parked`;
    },
};
