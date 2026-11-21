// Shaking a window with a few others open: they stash at the sides, whole.
const demo = {
    async setup() {
        const clocks = await open('org.gnome.clocks');
        const characters = await open('org.gnome.Characters');
        const calculator = await open('org.gnome.Calculator');
        const notes = await editor('Notes.txt');
        place(clocks, 180, 110, 780, 560);
        place(characters, 1000, 130, 720, 560);
        place(calculator, 1260, 400);
        place(notes, 520, 300, 860, 640);
        await dev.sleep(500);
        notes.activate(global.get_current_time());
        await glide([960, 1000], 1);
    },

    async act() {
        const notes = windowOf('org.gnome.TextEditor');
        await dev.sleep(500);
        caption('Shake a window!');
        await shake(notes);
        caption('All other windows get stashed on the sides');
        await glide([960, 1000], 500);
        await dev.sleep(2600);
        caption(null);
        await dev.sleep(400);
    },
};
