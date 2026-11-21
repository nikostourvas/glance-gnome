// The user's settings (edited in prefs.js), read where they are used, so
// changes apply at once.

import * as G from './geometry.js';

const EDGE_KEYS = [
    [G.Edge.LEFT, 'park-left'],
    [G.Edge.RIGHT, 'park-right'],
    [G.Edge.TOP, 'park-top'],
    [G.Edge.BOTTOM, 'park-bottom'],
];

export const EDGE_SETTINGS = EDGE_KEYS.map(([, key]) => key);

// The screen edges windows may park at.
export function enabledEdges(settings) {
    return EDGE_KEYS.filter(([, key]) => settings.get_boolean(key)).map(([edge]) => edge);
}

// The edge zones' width, as a fraction of the screen width.
export function zoneFraction(settings) {
    return settings.get_double('zone-percent') / 100;
}

// Whether windows are dragged as in Glance for KDE: shrinking once their
// edge comes near a screen edge, and stashed where dropped short of it (see
// drag.js).
export function glanceDragging(settings) {
    return settings.get_boolean('glance-dragging');
}

// With Glance-style dragging: where shrinking starts, as a fraction of the
// screen's width (its height for the top and bottom) from an edge, and the
// smallest a window gets before the edge zone, as a fraction of full size.
export function glanceZoneFraction(settings) {
    return settings.get_double('glance-zone-percent') / 100;
}

export function glanceSmallest(settings) {
    return settings.get_double('glance-smallest-percent') / 100;
}
