// Tests G.crowdedLine without a shell: lines of tiles that fit, that shrink
// to fit, and that overlap once at crowdedScale.
// Run: gjs -m dev/tests/crowded-line.js
import * as G from '../../extension/geometry.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (!ok)
        failures++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
}
const end = (r, lengths) => r.starts.at(-1) + lengths.at(-1) * r.scale;

{
    const lengths = [180, 120, 180];
    const r = G.crowdedLine(lengths, 1000);
    check('a line that fits keeps its size, centered', r.scale === 1 &&
        Math.abs(r.starts[0] - (1000 - end(r, lengths) + r.starts[0]) / 2 * 1) < 1 &&
        Math.abs(r.starts[1] - (r.starts[0] + 188)) < 0.01, JSON.stringify(r));
}
{
    const lengths = Array(10).fill(180);
    const r = G.crowdedLine(lengths, 1588);
    check('a line a bit too long shrinks to fill it exactly',
        r.scale < 1 && r.scale > G.crowdedScale && Math.abs(end(r, lengths) - 1588) < 0.5 && r.starts[0] === 0,
        JSON.stringify(r));
}
{
    const lengths = Array(30).fill(180);
    const r = G.crowdedLine(lengths, 1588);
    const step = r.starts[1] - r.starts[0];
    check('a very long line overlaps at crowdedScale, filling it exactly',
        r.scale === G.crowdedScale && Math.abs(end(r, lengths) - 1588) < 0.5 && step > 0 && step < 180 * r.scale,
        JSON.stringify([r.scale, step]));
}
{
    const lengths = [120, 180, 60, 180, 120, 180, 180, 180, 180, 180, 180, 180, 180];
    const r = G.crowdedLine(lengths, 1000);
    check('mixed sizes stay in order and in bounds',
        r.starts.every((s, i) => i === 0 || s > r.starts[i - 1]) && r.starts[0] >= 0 && end(r, lengths) <= 1000.5,
        JSON.stringify(r.starts.map(Math.round)));
}
print(failures ? `${failures} failed` : 'all ok');
