import { safeJsonParse } from '../authored/common.js';

/**
 * Computes location depth and ancestor path in the location tree.
 *
 * @param {Map<number, object>} locationsById
 * @param {number} locId
 * @returns {{ depth: number, path: Array<number> }}
 */
function getLocationPath(locationsById, locId) {
    const path = [];
    let curr = locationsById.get(locId);
    while (curr) {
        path.unshift(curr.id);
        if (curr.parent_location_id === null || curr.parent_location_id === undefined) {
            break;
        }
        curr = locationsById.get(curr.parent_location_id);
    }
    return {
        depth: path.length > 0 ? path.length - 1 : 0,
        path,
    };
}

/**
 * Calculates tree distance between two locations in the location hierarchy:
 * dist(L1, L2) = depth(L1) + depth(L2) - 2 * depth(LCA(L1, L2))
 *
 * @param {Map<number, object>} locationsById
 * @param {number} loc1Id
 * @param {number} loc2Id
 * @returns {number}
 */
export function calculateTreeDistance(locationsById, loc1Id, loc2Id) {
    if (loc1Id === loc2Id) return 0;

    const path1 = getLocationPath(locationsById, loc1Id);
    const path2 = getLocationPath(locationsById, loc2Id);

    // Find Lowest Common Ancestor (LCA)
    let lcaDepth = -1;
    const minLen = Math.min(path1.path.length, path2.path.length);
    for (let i = 0; i < minLen; i++) {
        if (path1.path[i] === path2.path[i]) {
            lcaDepth = i;
        } else {
            break;
        }
    }

    if (lcaDepth === -1) {
        // Disjoint trees (roots without common ancestor)
        return path1.depth + path2.depth + 2;
    }

    return path1.depth + path2.depth - (2 * lcaDepth);
}

/**
 * Computes travel duration in seconds between two locations.
 * Checks for route connection overrides in location extensions before falling back to tree distance.
 *
 * @param {Map<number, object>} locationsById
 * @param {number} originLocId
 * @param {number} destLocId
 * @returns {number} Duration in seconds
 */
export function computeTravelDuration(locationsById, originLocId, destLocId) {
    if (originLocId === destLocId) return 0;

    const origin = locationsById.get(originLocId);
    const dest = locationsById.get(destLocId);

    if (origin && dest) {
        const extensions = typeof origin.extensions === 'string'
            ? safeJsonParse(origin.extensions, {})
            : (origin.extensions || {});

        const connections = extensions.connections || extensions.routes || {};
        const destLwsId = dest.lws_id;

        if (connections[destLwsId] && typeof connections[destLwsId].duration_seconds === 'number') {
            return connections[destLwsId].duration_seconds;
        }
        if (connections[destLwsId] && typeof connections[destLwsId].travel_time_seconds === 'number') {
            return connections[destLwsId].travel_time_seconds;
        }
    }

    const dist = calculateTreeDistance(locationsById, originLocId, destLocId);
    if (dist <= 0) return 0;
    if (dist <= 2) {
        // Adjacent rooms / sibling locations (e.g. within same district/building)
        return 300; // 5 minutes
    }
    // Cross-district / cross-region
    return dist * 600; // 10 minutes per distance unit
}

/**
 * Calculates planned departure ISO timestamp given routine start time and travel duration.
 * planned_departure_time = start_time - duration_seconds
 *
 * @param {string} startTimeIso
 * @param {number} durationSeconds
 * @returns {string} ISO timestamp
 */
export function computePlannedDepartureTime(startTimeIso, durationSeconds) {
    if (durationSeconds <= 0) return startTimeIso;
    const ms = new Date(startTimeIso).getTime() - (durationSeconds * 1000);
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Calculates arrival ETA ISO timestamp given departure time and travel duration.
 * eta_time = departure_time + duration_seconds
 *
 * @param {string} departureTimeIso
 * @param {number} durationSeconds
 * @returns {string} ISO timestamp
 */
export function computeArrivalTime(departureTimeIso, durationSeconds) {
    if (durationSeconds <= 0) return departureTimeIso;
    const ms = new Date(departureTimeIso).getTime() + (durationSeconds * 1000);
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
