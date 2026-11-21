// Tests G.stashGrid without a shell.
// Run: gjs -m dev/tests/stash-grid.js
import * as G from '../../extension/geometry.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (!ok)
        failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
}
const rect = (x, y, width, height) => ({x, y, width, height});
const inside = (r, room) => r.x >= room.x - 1 && r.y >= room.y - 1 &&
    r.x + r.width <= room.x + room.width + 1 && r.y + r.height <= room.y + room.height + 1;
const apart = places => places.every((a, i) => places.slice(i + 1).every(b =>
    a.x + a.width + G.arrangeGap - 1 <= b.x || b.x + b.width + G.arrangeGap - 1 <= a.x ||
    a.y + a.height + G.arrangeGap - 1 <= b.y || b.y + b.height + G.arrangeGap - 1 <= a.y));
const same = n => Array.from({length: n}, () => ({width: 1000, height: 700}));

// The right half of a 2880x1620 screen with a 32 px top bar.
const room = rect(1444, 32, 1436, 1588);
{
    const {places, scale} = G.stashGrid([{width: 600, height: 400}], room);
    check('one small window keeps its size, centered', scale === 1 && places[0].width === 600 &&
        places[0].x === 1444 + 418 && places[0].y === 32 + 594, JSON.stringify(places));
}
{
    const {places, scale} = G.stashGrid(same(2), room);
    check('two stack in one column', places[0].x === places[1].x && places[1].y > places[0].y,
        JSON.stringify(places));
    check('  and stay large', scale > 0.9, String(scale));
}
for (const n of [3, 4, 6, 7, 9]) {
    const {places, scale} = G.stashGrid(same(n), room);
    check(`${n}: inside the room, apart`, places.every(p => inside(p, room)) && apart(places),
        JSON.stringify(places));
    print(`     ${n} windows: scale ${scale.toFixed(2)}`);
}
{
    const {places} = G.stashGrid(same(6), room);
    const columns = new Set(places.map(p => p.x)).size;
    check('six go in two columns', columns === 2, JSON.stringify(places));
}
{
    const {places} = G.stashGrid(Array.from({length: 3}, () => ({width: 1000, height: 1000})), room);
    const rows = [...new Set(places.map(p => p.y))];
    check('an odd last row is centered', rows.length === 2 &&
        Math.abs(places[2].x + places[2].width / 2 - (room.x + room.width / 2)) <= 1, JSON.stringify(places));
}
{
    const sizes = [{width: 1600, height: 1200}, {width: 400, height: 500}, {width: 900, height: 900}];
    const {places, scale} = G.stashGrid(sizes, room);
    check('mixed sizes: inside, apart, never enlarged', places.every(p => inside(p, room)) && apart(places) &&
        places.every((p, i) => p.width <= sizes[i].width), JSON.stringify(places));
    print(`     mixed: scale ${scale.toFixed(2)}`);
}
check('no windows', G.stashGrid([], room).places.length === 0);

print(failures ? `${failures} failed` : 'all passed');
