// Super+triple-click: the window takes the left half and the others stash
// in a grid at the right; a stash swaps with it; the main window undoes.
const demo = {
    async setup() {
        const calendar = await open('org.gnome.Calendar');
        const clocks = await open('org.gnome.clocks');
        const characters = await open('org.gnome.Characters');
        const recipes = await editor('Recipes.txt');
        const notes = await editor('Notes.txt');
        place(calendar, 140, 90, 640, 600);
        place(clocks, 1180, 80, 600, 460);
        place(characters, 240, 540, 640, 480);
        place(recipes, 1120, 560, 600, 460);
        place(notes, 600, 280, 660, 500);
        await dev.sleep(500);
        place(calendar, 140, 90, 640, 600); // once unmaximized
        await dev.sleep(300);
        notes.activate(global.get_current_time());
        await glide([960, 1000], 1);
        await dev.sleep(800);
        return normalWindows().map(w => { const r = w.get_frame_rect(); return `${w.get_title()} ${[r.x, r.y, r.width, r.height]}`; });
    },

    async act() {
        const notes = normalWindows().find(w => w.get_title().startsWith('Notes'));
        const calendar = windowOf('org.gnome.Calendar');
        await dev.sleep(500);
        caption('Super + triple-click a window');
        await glide(middle(drawn(notes)), 900);
        await dev.sleep(300);
        await superClicks(3);
        caption('It takes the left half, the others line up on the right');
        await dev.sleep(3000);
        caption('Super + triple-click one of them to swap');
        await glide(middle(drawn(calendar)), 900);
        await dev.sleep(300);
        await superClicks(3);
        await dev.sleep(2600);
        caption('Super + triple-click the main window to undo');
        await glide(middle(drawn(calendar)), 900);
        await dev.sleep(300);
        await superClicks(3);
        await glide([960, 1000], 600);
        await dev.sleep(2200);
        caption(null);
        await dev.sleep(400);
        const last = glance._declutter._last;
        return `${normalWindows().filter(w => glance._parking.isStashed(w)).length} stashed, last ${last?.mode}`;
    },
};
