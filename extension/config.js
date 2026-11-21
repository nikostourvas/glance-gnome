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
// edge is within glanceZone of a screen edge, and stashed where dropped
// short of parking size (see drag.js).
export function glanceDragging(settings) {
    return settings.get_boolean('glance-dragging');
}
