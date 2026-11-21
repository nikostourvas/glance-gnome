// How large windows are drawn near the screen edges and where parked
// windows go. Pure functions on plain rectangles ({x, y, width, height},
// global logical pixels) and sizes ({width, height}), ported from Glance's
// kwin/geometry.cpp and kwin/tuning.h (https://github.com/scottjenson/Glance).

// The edge zones' width, as a fraction of the screen width, is a setting
// (see config.js; the top and bottom zones are as thick). (Glance: 0.25,
// and only the side edges.)
// Scale at the very edge of the screen.
export const minScale = 0.15;
// But parking icons are at least this on their longer side.
export const parkingMinSize = 180;
// Dropped at this scale or larger, a window goes back to full size.
export const parkBelow = 0.99;
// Parking tiles are drawn this large on their longer side. (Glance: 140.)
export const parkingTile = 180;
// Vertical gap between windows in a parking column.
export const arrangeGap = 8;
// Glides into place, in milliseconds.
export const animationTime = 180;
// Hover previews: a parking tile grows to its app's real size (but no
// wider than previewMaxWidth of the screen) after previewDelay (ms) over
// it, and shrinks back previewGrace after the pointer leaves.
export const previewMaxWidth = 0.6;
export const previewDelay = 300;
export const previewGrace = 300;
// Shaking a dragged window: this many changes of horizontal direction
// within shakeTime (ms), each stroke at least shakeStroke px.
export const shakeTurns = 3;
export const shakeStroke = 30;
export const shakeTime = 500;

// Windows pushed aside for a centered one (placeAround): with less than
// minVisible showing, a window counts as hidden, and with wellVisible as
// well shown.
export const minVisible = 32;
export const wellVisible = 120;

// The screen edges windows park at: a column at each side, a row at the
// top and at the bottom.
export const Edge = {LEFT: 0, RIGHT: 1, TOP: 2, BOTTOM: 3};

export function isRow(edge) {
    return edge === Edge.TOP || edge === Edge.BOTTOM;
}

// Along an edge, tiles line up across `pos` (x or y) and `size` (width or
// height): a column at a side, a row at the top or bottom.
export function lineAxis(edge) {
    return isRow(edge) ? {pos: 'x', size: 'width'} : {pos: 'y', size: 'height'};
}

// The span a line of tiles at `edge` may use: the work area's height for a
// column, the screen's width for a row.
export function lineBounds(edge, screen, area) {
    return isRow(edge) ? {start: screen.x, length: screen.width} : {start: area.y, length: area.height};
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function rect(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

export function near(a, b) {
    return Math.abs(a - b) < 0.5;
}

// Glance-style dragging: the scale at which a window, scaled around the
// pointer, has its edge on one side at the point of the curve: full size
// until that edge enters the edge zone, then falling linearly to minScale
// at the screen edge. The drawn edge is at d = pointerToScreenEdge -
// pointerToWindowEdge * s from the screen edge (the latter measured at full
// size), and s = minScale + (1 - minScale) * d / zoneWidth; solved for s
// (above 1: still full size). `floor` replaces minScale.
export function edgeScale(pointerToScreenEdge, pointerToWindowEdge, zoneWidth, floor = minScale) {
    const k = (1 - floor) / zoneWidth;
    return (floor + k * pointerToScreenEdge) / (1 + k * pointerToWindowEdge);
}

// Glance-style dragging with settings: by the window's edge (edgeScale)
// within `zoneWidth`, but no smaller than `floor`; then, with the pointer
// within `strip` of the screen edge, on down to minScale at the edge (from
// wherever it was as it entered, so nothing jumps).
export function glanceScale(pointerToScreenEdge, pointerToWindowEdge, zoneWidth, floor, strip) {
    const outer = clamp(edgeScale(pointerToScreenEdge, pointerToWindowEdge, zoneWidth, floor), floor, 1);
    if (pointerToScreenEdge >= strip)
        return outer;
    return minScale + (outer - minScale) * Math.max(0, pointerToScreenEdge) / strip;
}

// Scale of a dragged window whose pointer is `pointerToEdge` from a screen
// edge: full size until the pointer is within the edge zone (`zoneWidth`),
// then falling linearly to minScale at the edge. (Glance goes by the
// window's edge instead, so a large window shrinks wherever it is moved
// near an edge.)
export function pointerScale(pointerToEdge, zoneWidth) {
    if (pointerToEdge >= zoneWidth)
        return 1;
    return minScale + (1 - minScale) * Math.max(0, pointerToEdge) / zoneWidth;
}

// How far a span [x, x + width) must move to lie within [start, start +
// length). A span longer than that keeps its start visible.
export function shiftInto(x, width, start, length) {
    const minShift = start - x;
    const maxShift = start + length - (x + width);
    if (minShift > maxShift)
        return minShift;
    return clamp(0, minShift, maxShift);
}

export function shiftOntoScreen(x, width, screen) {
    return shiftInto(x, width, screen.x, screen.width);
}

// The scale of a window of full size `original` in parking: minScale, or
// more if its longer side would be shorter than parkingMinSize.
export function parkingScale(original) {
    return clamp(parkingMinSize / Math.max(original.width, original.height), minScale, 1);
}

// A parking tile: a window of full size `original` drawn parkingTile on its
// longer side (less for a window smaller than that at parking size),
// against `edge` (for the top and bottom, the work area `area`'s: below the
// top bar, above any bottom panel), centered at `center` along it (y at a
// side, x at the top or bottom), kept on screen.
export function parkingTileRect(edge, original, center, screen, area) {
    const longer = Math.max(original.width, original.height);
    const factor = Math.min(parkingTile, longer * parkingScale(original)) / longer;
    const width = original.width * factor;
    const height = original.height * factor;
    if (isRow(edge)) {
        const x = clamp(center - width / 2, screen.x, Math.max(screen.x, screen.x + screen.width - width));
        const y = edge === Edge.TOP ? area.y : area.y + area.height - height;
        return {x, y, width, height};
    }
    const x = edge === Edge.LEFT ? screen.x : screen.x + screen.width - width;
    const y = clamp(center - height / 2, area.y, Math.max(area.y, area.y + area.height - height));
    return {x, y, width, height};
}

// The center of `r` along a line of tiles at `edge`.
export function lineCenter(edge, r) {
    const {pos, size} = lineAxis(edge);
    return r[pos] + r[size] / 2;
}

// The part of the work area `area` clear of the lines of tiles at `edges`
// (a tile's thickness and a gap in from each, whether tiles are there or
// not), where declutter pushes windows aside to.
export function clearOfTiles(screen, area, edges) {
    const thickness = parkingTile + arrangeGap;
    let left = area.x, right = area.x + area.width;
    let top = area.y, bottom = area.y + area.height;
    if (edges.includes(Edge.LEFT))
        left = Math.max(left, screen.x + thickness);
    if (edges.includes(Edge.RIGHT))
        right = Math.min(right, screen.x + screen.width - thickness);
    if (edges.includes(Edge.TOP))
        top += thickness;
    if (edges.includes(Edge.BOTTOM))
        bottom -= thickness;
    return {x: left, y: top, width: right - left, height: bottom - top};
}

// A stash column (Glance's declutter): windows of full sizes `sizes`, top
// to bottom, at one common scale that fits them into the width of `band`
// (the stash zone beside the tiles) and, arrangeGap apart, into the work
// area's height (no larger than full size, no smaller than minScale),
// centered in both.
export function stashColumn(sizes, band, area) {
    const gaps = arrangeGap * (sizes.length - 1);
    const total = sizes.reduce((sum, size) => sum + size.height, 0);
    const widest = Math.max(...sizes.map(size => size.width));
    const scale = clamp(Math.min(band.width / widest, (area.height - gaps) / total), minScale, 1);
    let y = area.y + Math.max(0, (area.height - total * scale - gaps) / 2);
    return sizes.map(size => {
        const r = {
            x: band.x + (band.width - size.width * scale) / 2, y,
            width: size.width * scale, height: size.height * scale,
        };
        y += r.height + arrangeGap;
        return r;
    });
}

function overlaps(a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// What is left of `r` with `cover` taken out, as rectangles.
function subtract(r, cover) {
    if (!overlaps(r, cover))
        return [r];
    const [right, bottom] = [r.x + r.width, r.y + r.height];
    const [coverRight, coverBottom] = [cover.x + cover.width, cover.y + cover.height];
    const y = Math.max(r.y, cover.y);
    const height = Math.min(bottom, coverBottom) - y;
    const pieces = [];
    if (r.y < cover.y)
        pieces.push({...r, height: cover.y - r.y});
    if (coverBottom < bottom)
        pieces.push({...r, y: coverBottom, height: bottom - coverBottom});
    if (r.x < cover.x)
        pieces.push({x: r.x, y, width: cover.x - r.x, height});
    if (coverRight < right)
        pieces.push({x: coverRight, y, width: right - coverRight, height});
    return pieces;
}

// How much of `r` shows inside `area` under `covers`: the shorter side of
// its largest visible piece.
export function visibleSize(r, covers, area) {
    const x = Math.max(r.x, area.x);
    const y = Math.max(r.y, area.y);
    const width = Math.min(r.x + r.width, area.x + area.width) - x;
    const height = Math.min(r.y + r.height, area.y + area.height) - y;
    if (width <= 0 || height <= 0)
        return 0;
    let pieces = [{x, y, width, height}];
    for (const cover of covers)
        pieces = pieces.flatMap(piece => subtract(piece, cover));
    return Math.max(0, ...pieces.map(piece => Math.min(piece.width, piece.height)));
}

// How much of `length` each of `widths` gets: equal shares, but none more
// than its own width.
function strips(widths, length) {
    const shares = new Array(widths.length);
    let rest = length;
    [...widths.keys()].sort((a, b) => widths[a] - widths[b]).forEach((i, done) => {
        shares[i] = Math.min(widths[i], rest / (widths.length - done));
        rest -= shares[i];
    });
    return shares;
}

// `windows` (bottom to top of the stack) with those at the indices `moving`
// aside of `center`, inside `room` (smaller if they don't fit): the first
// `split` of them from the left to its left, the rest to its right. On each
// side, the higher in the stack the nearer to `center`, so that each shows a
// strip beyond the ones above it, on the side away from `center`. One so wide
// it would pass the room's far end stops there, and those below it go beyond
// it.
function layoutAside(center, room, windows, moving, split) {
    const placed = [...windows];
    const fitted = i => ({
        ...windows[i],
        width: Math.min(windows[i].width, room.width),
        height: Math.min(windows[i].height, room.height),
    });
    const place = (indices, atLeft) => {
        const [start, end] = atLeft
            ? [room.x, center.x]
            : [center.x + center.width, room.x + room.width];
        const topFirst = [...indices].sort((a, b) => b - a);
        let reach = atLeft ? end : start;
        topFirst.forEach((i, n) => {
            const r = fitted(i);
            const below = topFirst.slice(n).map(j => fitted(j).width);
            const share = strips(below, Math.max(0, atLeft ? reach - start : end - reach))[0];
            const x = clamp(atLeft ? reach - share : reach + share - r.width,
                room.x, room.x + room.width - r.width);
            reach = atLeft ? x : x + r.width;
            placed[i] = {
                ...r,
                x: Math.round(x),
                y: r.y + shiftInto(r.y, r.height, room.y, room.height),
            };
        });
    };
    const fromLeft = [...moving].sort((a, b) =>
        windows[a].x + windows[a].width / 2 - (windows[b].x + windows[b].width / 2));
    place(fromLeft.slice(0, split), true);
    place(fromLeft.slice(split), false);
    return placed;
}

// Where to put `windows` (rectangles, bottom to top of the stack) around
// `center`, which is on top of them: those in its way go aside into `room`
// (see layoutAside), to whichever sides leave them all showing, well if
// possible, moving them the least. One out of its way stays unless it is
// hidden or hides another that can't show otherwise. Staying in `room`, not
// all can always show: a window that fills it leaves no room beside it.
export function placeAround(center, room, area, windows) {
    const all = [...windows.keys()];
    const moving = new Set(all.filter(i => overlaps(windows[i], center)));
    for (;;) {
        let best = null;
        for (let split = 0; split <= moving.size; split++) {
            const placed = layoutAside(center, room, windows, moving, split);
            const shown = placed.map((r, i) => visibleSize(r, [center, ...placed.slice(i + 1)], area));
            const tried = {
                placed, shown,
                hidden: shown.filter(size => size < minVisible).length,
                worst: Math.min(wellVisible, ...shown),
                moved: placed.reduce((sum, r, i) => sum + Math.abs(r.x - windows[i].x) + Math.abs(r.y - windows[i].y), 0),
            };
            if (!best || (tried.hidden - best.hidden || best.worst - tried.worst || tried.moved - best.moved) < 0)
                best = tried;
        }
        const hidden = all.filter(i => best.shown[i] < minVisible);
        let more = hidden.filter(i => !moving.has(i));
        if (!more.length) {
            more = hidden.flatMap(i => all.filter(j => j > i && !moving.has(j) &&
                overlaps(best.placed[i], windows[j])));
        }
        if (!more.length)
            return best.placed;
        more.forEach(i => moving.add(i));
    }
}

// `box` moved as little as needed to lie within `area` (a bigger box keeps
// its top-left corner in).
export function keptIn(box, area) {
    return {
        ...box,
        x: box.x + shiftInto(box.x, box.width, area.x, area.width),
        y: box.y + shiftInto(box.y, box.height, area.y, area.height),
    };
}

export function lerpRect(a, b, e) {
    return {
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
        width: a.width + (b.width - a.width) * e,
        height: a.height + (b.height - a.height) * e,
    };
}

export function easeOut(t) {
    return 1 - (1 - t) ** 3;
}
