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
