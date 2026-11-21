// The user's settings (edited in prefs.js), read where they are used, so
// changes apply at once.

import * as G from './geometry.js';

const EDGE_KEYS = [
    [G.Edge.LEFT, 'park-left', 'stash-left'],
    [G.Edge.RIGHT, 'park-right', 'stash-right'],
    [G.Edge.TOP, 'park-top', 'stash-top'],
    [G.Edge.BOTTOM, 'park-bottom', 'stash-bottom'],
];

export const EDGE_SETTINGS = EDGE_KEYS.map(([, key]) => key);
export const STASH_SETTINGS = EDGE_KEYS.map(([,, key]) => key);

// The screen edges windows may park at.
export function enabledEdges(settings) {
    return EDGE_KEYS.filter(([, key]) => settings.get_boolean(key)).map(([edge]) => edge);
}

// The screen edges windows may be stashed at: dragged toward one, a window
// shrinks once its own edge comes near it, as in Glance for KDE, and stays
// as small as it is where it is dropped (see drag.js).
export function stashEdges(settings) {
    return EDGE_KEYS.filter(([,, key]) => settings.get_boolean(key)).map(([edge]) => edge);
}

// The old single switch for stashing (glance-dragging), once: stashing at
// each edge parking is on at.
export function migrateSettings(settings) {
    if (!settings.get_boolean('glance-dragging'))
        return;
    for (const [, park, stash] of EDGE_KEYS)
        settings.set_boolean(stash, settings.get_boolean(park));
    settings.set_boolean('glance-dragging', false);
}

// The edge zones' width, as a fraction of the screen width.
export function zoneFraction(settings) {
    return settings.get_double('zone-percent') / 100;
}

// Stashing: where shrinking starts, as a fraction of the screen's width
// (its height for the top and bottom) from an edge, and the smallest a
// window gets before the edge zone, as a fraction of full size.
export function glanceZoneFraction(settings) {
    return settings.get_double('glance-zone-percent') / 100;
}

export function glanceSmallest(settings) {
    return settings.get_double('glance-smallest-percent') / 100;
}

// The side edges that shaking (and Super+double-clicking the desktop)
// stashes the other windows at, as in Glance, instead of parking them: those
// stashing is on at, with the setting, or if no edge parks.
export function scatterStashEdges(settings) {
    const sides = stashEdges(settings).filter(e => !G.isRow(e));
    if (!sides.length)
        return [];
    return settings.get_boolean('scatter-stashes') || !enabledEdges(settings).length ? sides : [];
}
