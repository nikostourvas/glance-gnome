// Tests G.placeAround without a shell: fixed cases, then random layouts on a
// large and a small screen, reporting how many left a window hidden.
// Run: gjs -m dev/tests/place-around.js
import * as G from '../../extension/geometry.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (!ok)
        failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
}
const rect = (x, y, width, height) => ({x, y, width, height});
const shownOf = (center, area, placed) =>
    placed.map((r, i) => G.visibleSize(r, [center, ...placed.slice(i + 1)], area));
function centered(area, width, height) {
    return rect(area.x + Math.round((area.width - width) / 2), area.y + Math.round((area.height - height) / 2), width, height);
}

const big = rect(0, 32, 2880, 1588);
const bigRoom = G.clearOfTiles(rect(0, 0, 2880, 1620), big, [G.Edge.LEFT, G.Edge.RIGHT]);
const small = rect(0, 32, 1280, 768);
const smallRoom = G.clearOfTiles(rect(0, 0, 1280, 800), small, [G.Edge.LEFT, G.Edge.RIGHT]);

{
    const center = centered(big, 1400, 1200);
    const [a] = G.placeAround(center, bigRoom, big, [rect(800, 300, 400, 500)]);
    check('one that fits goes right beside it', a.x === center.x - 400 && a.y === 300, JSON.stringify(a));
}
{
    const center = centered(big, 1000, 800);
    const out = rect(100, 100, 300, 300);
    const [a] = G.placeAround(center, bigRoom, big, [out]);
    check('one out of the way stays, even in the tile room', a.x === 100 && a.y === 100, JSON.stringify(a));
}
{
    const center = centered(big, 1400, 1200);
    const same = () => rect(800, 200, 1200, 900);
    const placed = G.placeAround(center, bigRoom, big, [same(), same(), same(), same()]);
    const shown = shownOf(center, big, placed);
    check('same windows at the same spot all show', shown.every(s => s >= G.wellVisible), JSON.stringify(shown));
    check('and stay out of the tile room', placed.every(r => r.x >= bigRoom.x && r.x + r.width <= bigRoom.x + bigRoom.width),
        JSON.stringify(placed));
}
{
    const center = centered(big, 1000, 800);
    const under = rect(2000, 300, 300, 300);
    const over = rect(1950, 200, 500, 600);
    const [a, b] = G.placeAround(center, bigRoom, big, [under, over]);
    const shown = shownOf(center, big, [a, b]);
    check('one already hidden by another is shown', shown[0] >= G.minVisible, JSON.stringify([a, b]));
    check('the one hiding it stays', b.x === 1950 && b.y === 200, JSON.stringify(b));
}
{
    const center = centered(big, 360, 616);
    const wide = () => rect(600, 150, 1800, 1200);
    const placed = G.placeAround(center, bigRoom, big, [wide(), wide(), wide(), wide()]);
    const shown = shownOf(center, big, placed);
    check('wide windows behind a small one all show', shown.every(s => s >= G.minVisible), JSON.stringify(shown));
}
{
    const center = centered(small, 800, 600);
    const placed = G.placeAround(center, smallRoom, small, [rect(100, 60, 1000, 650), rect(200, 80, 1000, 650)]);
    check('small screen: windows too wide for the room shrink to fit it',
        placed.every(r => r.width === smallRoom.width && r.x === smallRoom.x && r.height === 650), JSON.stringify(placed));
}
{
    const center = centered(small, 1100, 700);
    const placed = G.placeAround(center, smallRoom, small, [rect(300, 60, 600, 500)]);
    check('a center wider than the room still leaves pushed windows in it',
        placed.every(r => r.x >= smallRoom.x && r.x + r.width <= smallRoom.x + smallRoom.width), JSON.stringify(placed));
}

// Random layouts: how often is a window left hidden?
let seed = 12345;
const random = (low, high) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return low + Math.floor(seed / 2147483648 * (high - low + 1));
};
function fuzz(name, area, room, sizes, centerSizes, runs = 2000) {
    let bad = 0, gone = 0, inTileRoom = 0, thin = 0, total = 0;
    const badBy = {}, totalBy = {};
    for (let run = 0; run < runs; run++) {
        const windows = [];
        const n = random(1, 8);
        for (let i = 0; i < n; i++) {
            const [w, h] = sizes[random(0, sizes.length - 1)];
            windows.push(rect(random(area.x, Math.max(area.x, area.x + area.width - w)),
                random(area.y, Math.max(area.y, area.y + area.height - h)), w, h));
        }
        const [cw, ch] = centerSizes[random(0, centerSizes.length - 1)];
        const center = centered(area, cw, ch);
        const placed = G.placeAround(center, room, area, windows);
        const shown = shownOf(center, area, placed);
        total++;
        totalBy[n] = (totalBy[n] ?? 0) + 1;
        if (shown.some(s => s < G.minVisible)) {
            bad++;
            badBy[n] = (badBy[n] ?? 0) + 1;
        }
        if (Math.min(...shown) < G.wellVisible)
            thin++;
        if (Math.min(...shown) < 10)
            gone++;
        placed.forEach((r, i) => {
            const moved = r.x !== windows[i].x || r.y !== windows[i].y;
            if (moved && (r.x < room.x || r.x + r.width > room.x + room.width))
                inTileRoom++;
        });
    }
    print(`${name}: ${total} layouts, ${gone} with a window under 10 px, ${bad} under ${G.minVisible} px, ${thin} under ${G.wellVisible} px, ` +
        `${inTileRoom} moved windows in the tile room`);
    print(`  under ${G.minVisible} px by window count: ${Object.keys(totalBy).map(n => `${n}: ${badBy[n] ?? 0}/${totalBy[n]}`).join(', ')}`);
    check(`${name}: moved windows stay out of the tile room`, inTileRoom === 0, `${inTileRoom}`);
    return bad;
}
const usual = [[1600, 1200], [1400, 1000], [1000, 800], [800, 600], [360, 616], [1800, 1300], [1200, 900]];
fuzz('large screen', big, bigRoom, usual, [[1400, 1200], [1000, 800], [360, 616], [1800, 1300]]);
const laptop = [[1200, 700], [1000, 700], [800, 600], [360, 616], [900, 650], [1100, 750]];
fuzz('small screen', small, smallRoom, laptop, [[900, 650], [800, 600], [360, 616], [1100, 750]]);

print(failures ? `${failures} FAILED` : 'all fixed cases ok');
