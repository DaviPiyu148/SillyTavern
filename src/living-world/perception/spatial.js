import { safeJsonParse, generateDeterministicUuid, isoNow } from '../authored/common.js';
import { isSeverePhysicalCondition } from '../time/routines.js';

/**
 * Computes location path and depth within the location tree hierarchy.
 * Resolves parent links from column or extensions (parent_location_id / parent_id).
 *
 * @param {Map<number, object>} locationsById
 * @param {number} locId
 * @returns {{ depth: number, path: Array<number> }}
 */
export function getLocationPath(locationsById, locId) {
    const path = [];
    let curr = locationsById.get(locId);
    const visited = new Set();

    while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        path.unshift(curr.id);

        const ext = typeof curr.extensions === 'string'
            ? safeJsonParse(curr.extensions, {})
            : (curr.extensions || {});

        const parentRef = curr.parent_location_id ?? ext.parent_location_id ?? ext.parent_id ?? null;
        if (parentRef === null || parentRef === undefined) {
            break;
        }

        if (typeof parentRef === 'string') {
            curr = [...locationsById.values()].find(l => l.lws_id === parentRef);
        } else {
            curr = locationsById.get(parentRef);
        }
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
export function calculateSpatialDistance(locationsById, loc1Id, loc2Id) {
    if (!loc1Id || !loc2Id) return 999;
    if (loc1Id === loc2Id) return 0;

    const path1 = getLocationPath(locationsById, loc1Id);
    const path2 = getLocationPath(locationsById, loc2Id);

    if (path1.path.length === 0 || path2.path.length === 0) {
        return 999;
    }

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
 * Checks whether a character has the sensory ability to perceive via a given modality.
 * Returns false if character is under severe physical condition (unconscious, comatose, etc.)
 * or has sensory disability flags in runtime_state.
 *
 * @param {object} character
 * @param {'tactile' | 'visual' | 'auditory' | 'olfactory'} [sensoryModality='visual']
 * @returns {boolean}
 */
export function canCharacterPerceive(character, sensoryModality = 'visual') {
    if (!character) return false;

    if (isSeverePhysicalCondition(character)) {
        return false;
    }

    const runtimeState = typeof character.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character.runtime_state || {});

    if (runtimeState.sensory && runtimeState.sensory[sensoryModality] === false) {
        return false;
    }

    return true;
}

/**
 * Checks if a soundproof barrier is present between two locations.
 *
 * @param {Map<number, object>} locationsById
 * @param {number} loc1Id
 * @param {number} loc2Id
 * @returns {boolean}
 */
function hasSoundproofBarrier(locationsById, loc1Id, loc2Id) {
    const loc1 = locationsById.get(loc1Id);
    const loc2 = locationsById.get(loc2Id);
    if (!loc1 || !loc2) return false;

    const ext1 = typeof loc1.extensions === 'string' ? safeJsonParse(loc1.extensions, {}) : (loc1.extensions || {});
    const ext2 = typeof loc2.extensions === 'string' ? safeJsonParse(loc2.extensions, {}) : (loc2.extensions || {});

    if (ext1.barriers?.soundproof || ext2.barriers?.soundproof) {
        return true;
    }
    return false;
}

/**
 * Determines the single canonical perception modality for a character witnessing an event.
 * Follows Option A precedence: tactile > visual > auditory > olfactory.
 *
 * @param {object} event
 * @param {object} character
 * @param {Map<number, object>} locationsById
 * @returns {'tactile' | 'visual' | 'auditory' | 'olfactory' | null}
 */
export function determineCanonicalModality(event, character, locationsById) {
    if (!event || !character) return null;

    const charLocId = character.current_location_id;
    const eventLocId = event.location_id;

    // Disallow director/meta events from physical character perception
    if (['DIRECTOR_NOTE', 'DIRECTOR_INSPECT', 'SIMULATION_START', 'SIMULATION_PAUSE', 'SIMULATION_RESUME', 'SIMULATION_STOP'].includes(event.event_type)) {
        return null;
    }

    // Characters in transit cannot perceive fixed room events unless co-located
    const payload = typeof event.payload === 'string' ? safeJsonParse(event.payload, {}) : (event.payload || {});

    const isActor = character.id === event.actor_character_id;
    const isTarget = character.id === event.target_character_id;
    const isDirectParticipant = isActor || isTarget;

    const distance = (charLocId && eventLocId)
        ? calculateSpatialDistance(locationsById, charLocId, eventLocId)
        : (isDirectParticipant ? 0 : 999);

    // 1. TACTILE Check (Precedence 1)
    const isTactileEvent = ['COMBAT_ACTION', 'TRANSFER_ITEM', 'INTERACT_OBJECT', 'CONSUME_ITEM'].includes(event.event_type) ||
        payload.modality === 'tactile' ||
        payload.is_tactile === true;

    if (isDirectParticipant && isTactileEvent && canCharacterPerceive(character, 'tactile')) {
        return 'tactile';
    }

    // 2. VISUAL Check (Precedence 2)
    // Co-located (dist === 0) or direct line-of-sight
    if (distance === 0 && canCharacterPerceive(character, 'visual')) {
        return 'visual';
    }

    // 3. AUDITORY Check (Precedence 3)
    const isLoud = payload.volume === 'loud' ||
        payload.is_loud === true ||
        ['COMBAT_ACTION', 'EXPLOSION'].includes(event.event_type) ||
        payload.sound_intensity === 'high';

    if (canCharacterPerceive(character, 'auditory')) {
        // Co-located auditory (e.g. if character was visually blinded or spoken words)
        if (distance === 0) {
            return 'auditory';
        }
        // Sibling room auditory (dist <= 2) for loud events without soundproof barrier
        if (distance <= 2 && isLoud && !hasSoundproofBarrier(locationsById, charLocId, eventLocId)) {
            return 'auditory';
        }
    }

    // 4. OLFACTORY Check (Precedence 4)
    if ((payload.has_scent === true || payload.modality === 'olfactory') && distance <= 1 && canCharacterPerceive(character, 'olfactory')) {
        return 'olfactory';
    }

    return null;
}

/**
 * Evaluates perceptions for all simulation characters for a committed event.
 * Returns an array of perception records ready for database insertion.
 *
 * @param {object} event
 * @param {Array<object>} characters
 * @param {Map<number, object>} locationsById
 * @returns {Array<object>}
 */
export function evaluateEventPerceptions(event, characters, locationsById) {
    const perceptions = [];
    const eventLwsId = event.lws_id;
    const fictionalTime = event.fictional_time;
    const createdAt = event.created_at || isoNow();

    for (const char of characters) {
        if (char.deleted_at !== null && char.deleted_at !== undefined) continue;

        const modality = determineCanonicalModality(event, char, locationsById);
        if (modality) {
            const perceptionLwsId = generateDeterministicUuid('perception', eventLwsId, char.lws_id);
            perceptions.push({
                lws_id: perceptionLwsId,
                simulation_id: event.simulation_id,
                event_id: event.id,
                simulation_character_id: char.id,
                sensory_modality: modality,
                perceived_at_fictional_time: fictionalTime,
                created_at: createdAt,
            });
        }
    }

    return perceptions;
}
