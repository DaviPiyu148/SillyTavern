import crypto from 'node:crypto';
import { generateDeterministicUuid } from '../authored/common.js';

export { generateDeterministicUuid };

/**
 * Exactly 14 character proposable action types.
 */
export const PROPOSABLE_ACTION_TYPES_14 = Object.freeze([
    'MOVE_CHARACTER',
    'UPDATE_CHARACTER_ACTIVITY',
    'UPDATE_PHYSICAL_CONDITION',
    'UPDATE_RUNTIME_STATE',
    'COMMUNICATE',
    'INTERACT_OBJECT',
    'EMOTE',
    'OBSERVE',
    'GENERAL_ACTION',
    'REST',
    'WORK',
    'CONSUME_ITEM',
    'TRANSFER_ITEM',
    'COMBAT_ACTION',
]);

/**
 * 9.1 getProposalTarget(proposal) — Single Canonical Resolver
 *
 * This function is the exclusive target-resolution authority for target entities (type and id).
 * Every subsystem (goal alignment, utility scoring, action classification, intention creation,
 * authority validation, tie-breaking, replay, travel time cost) MUST call this function and
 * MUST NOT independently derive target information.
 *
 * @param {object} proposal
 * @returns {{ type: 'character' | 'location' | 'object' | 'none', id: string | null }}
 */
export function getProposalTarget(proposal) {
    if (!proposal || typeof proposal !== 'object') {
        return { type: 'none', id: null };
    }

    const actionType = proposal.action_type || proposal.event_type;
    const payload = proposal.payload || {};

    switch (actionType) {
        case 'MOVE_CHARACTER': {
            const locId = proposal.location_id ?? payload.target_location_id ?? null;
            return {
                type: 'location',
                id: locId !== null && locId !== undefined ? String(locId) : null,
            };
        }

        case 'COMMUNICATE':
        case 'COMBAT_ACTION':
        case 'TRANSFER_ITEM': {
            const charId = proposal.target_character_id ?? payload.recipient_character_id ?? null;
            return {
                type: 'character',
                id: charId !== null && charId !== undefined ? String(charId) : null,
            };
        }

        case 'INTERACT_OBJECT': {
            const objId = payload.object_id ?? payload.target_object_id ?? proposal.target_entity_id ?? null;
            return {
                type: 'object',
                id: objId !== null && objId !== undefined ? String(objId) : null,
            };
        }

        case 'OBSERVE': {
            // Evaluated strictly in order: (1) target_object_id -> object; (2) target_character_id -> character; (3) location_id -> location; (4) none
            if (payload.target_object_id) {
                return { type: 'object', id: String(payload.target_object_id) };
            }
            if (proposal.target_character_id) {
                return { type: 'character', id: String(proposal.target_character_id) };
            }
            if (proposal.location_id) {
                return { type: 'location', id: String(proposal.location_id) };
            }
            return { type: 'none', id: null };
        }

        case 'CONSUME_ITEM': {
            const itemId = payload.item_id ?? payload.object_id ?? proposal.target_entity_id ?? null;
            return {
                type: 'object',
                id: itemId !== null && itemId !== undefined ? String(itemId) : null,
            };
        }

        case 'REST':
        case 'WORK':
        case 'EMOTE':
        case 'GENERAL_ACTION':
        case 'UPDATE_CHARACTER_ACTIVITY':
        case 'UPDATE_PHYSICAL_CONDITION':
        case 'UPDATE_RUNTIME_STATE':
        default:
            return { type: 'none', id: null };
    }
}

/**
 * Derives target type of a goal.
 * Exactly 0 or 1 target entity permitted per goal.
 *
 * @param {object} goal
 * @returns {'character' | 'location' | 'object' | 'none'}
 */
export function goalTargetType(goal) {
    if (!goal) return 'none';
    if (goal.target_character_id !== null && goal.target_character_id !== undefined) return 'character';
    if (goal.target_location_id !== null && goal.target_location_id !== undefined) return 'location';
    if (goal.target_object_id !== null && goal.target_object_id !== undefined) return 'object';
    return 'none';
}

/**
 * Checks if a goal's target matches a proposal's canonical target.
 *
 * @param {object} goal
 * @param {object} proposal
 * @returns {boolean}
 */
export function targetsMatch(goal, proposal) {
    const gType = goalTargetType(goal);
    if (gType === 'none') return true;

    const pTarget = getProposalTarget(proposal);
    if (pTarget.type !== gType) return false;

    if (gType === 'character') return String(goal.target_character_id) === String(pTarget.id);
    if (gType === 'location') return String(goal.target_location_id) === String(pTarget.id);
    if (gType === 'object') return String(goal.target_object_id) === String(pTarget.id);
    return false;
}

/**
 * 7.1 Authoritative Deception Predicate
 *
 * @param {object} proposal
 * @returns {boolean}
 */
export function isDeceptiveCommunication(proposal) {
    const actionType = proposal.action_type || proposal.event_type;
    return actionType === 'COMMUNICATE' && proposal.payload?.is_deceptive === true;
}

/**
 * Combat and threat state predicates.
 * Combat state is sourced from character.runtime_state.combat.
 */
export function isInCombat(char) {
    const runtimeState = typeof char?.runtime_state === 'string' ? JSON.parse(char.runtime_state || '{}') : (char?.runtime_state || {});
    return runtimeState.combat?.in_combat === true;
}

export function isUnderAttack(char) {
    const runtimeState = typeof char?.runtime_state === 'string' ? JSON.parse(char.runtime_state || '{}') : (char?.runtime_state || {});
    return runtimeState.combat?.under_attack === true;
}

export function isThreatened(char) {
    const runtimeState = typeof char?.runtime_state === 'string' ? JSON.parse(char.runtime_state || '{}') : (char?.runtime_state || {});
    return Boolean(runtimeState.combat?.threat_level && runtimeState.combat.threat_level !== 'none');
}

export function isFleeing(proposal) {
    return proposal?.payload?.is_fleeing === true || proposal?.payload?.reason === 'flee';
}

export function isSelfDefense(proposal) {
    return proposal?.payload?.is_self_defense === true;
}

/**
 * Calculates alignment score between a goal and a proposal in [0.0, 1.0].
 * - M_action = 0.70 on exact match; 0.30 if objective_action_type IS NULL; 0.00 on mismatch.
 * - M_target = 0.30 if goalTargetType(g) === 'none' OR targetsMatch(g, a); 0.00 on target mismatch.
 * - Alignment(g, a) = min(1.0, M_action + M_target).
 *
 * @param {object} goal
 * @param {object} proposal
 * @returns {number}
 */
export function calculateGoalAlignment(goal, proposal) {
    if (!goal || !proposal) return 0.0;

    const actionType = proposal.action_type || proposal.event_type;

    let mAction = 0.0;
    if (!goal.objective_action_type) {
        mAction = 0.30;
    } else if (goal.objective_action_type === actionType) {
        mAction = 0.70;
    } else {
        mAction = 0.0;
    }

    let mTarget = 0.0;
    const gType = goalTargetType(goal);
    if (gType === 'none' || targetsMatch(goal, proposal)) {
        mTarget = 0.30;
    } else {
        mTarget = 0.0;
    }

    return Math.min(1.0, mAction + mTarget);
}

/**
 * 7.3 Deterministic ActionClass Mapping
 *
 * @param {object} proposal
 * @param {object | null} contextGoal
 * @param {object} character
 * @returns {string} One of the 11 Action Classes
 */
export function getActionClass(proposal, contextGoal = null, character = {}) {
    const actionType = proposal.action_type || proposal.event_type;
    const payload = proposal.payload || {};

    const runtimeState = typeof character?.runtime_state === 'string'
        ? JSON.parse(character.runtime_state || '{}')
        : (character?.runtime_state || {});

    switch (actionType) {
        case 'COMMUNICATE':
            if (isDeceptiveCommunication(proposal)) {
                return 'DECEPTIVE_COMMUNICATION';
            }
            if (payload.intent === 'aid' || payload.intent === 'comfort') {
                return 'AID_COMFORT';
            }
            return 'TRUTHFUL_COMMUNICATION';

        case 'COMBAT_ACTION':
            return 'COMBAT_AGGRESSION';

        case 'MOVE_CHARACTER':
            if (isFleeing(proposal)) {
                return 'FLEEING';
            }
            if (contextGoal && calculateGoalAlignment(contextGoal, proposal) >= 0.70) {
                return 'AUTONOMOUS_GOAL_PURSUIT';
            }
            return 'IDLE_LEISURE';

        case 'TRANSFER_ITEM':
            return 'TRANSFER_ITEM';

        case 'WORK':
            return 'WORK';

        case 'OBSERVE':
            return 'OBSERVE';

        case 'INTERACT_OBJECT':
            return 'INTERACT_OBJECT';

        case 'REST': {
            const energySatisfaction = runtimeState.needs?.energy?.satisfaction ?? runtimeState.needs?.energy ?? 100;
            if (energySatisfaction < 40) {
                return 'AUTONOMOUS_GOAL_PURSUIT';
            }
            return 'IDLE_LEISURE';
        }

        case 'CONSUME_ITEM':
            return 'AUTONOMOUS_GOAL_PURSUIT';

        case 'EMOTE':
            if (payload.intent === 'aid' || payload.intent === 'comfort') {
                return 'AID_COMFORT';
            }
            return 'IDLE_LEISURE';

        case 'GENERAL_ACTION':
        case 'UPDATE_CHARACTER_ACTIVITY':
        case 'UPDATE_PHYSICAL_CONDITION':
        case 'UPDATE_RUNTIME_STATE':
        default:
            if (contextGoal && calculateGoalAlignment(contextGoal, proposal) >= 0.70) {
                return 'AUTONOMOUS_GOAL_PURSUIT';
            }
            return 'IDLE_LEISURE';
    }
}

/**
 * Computes deterministic tie-breaking hash string.
 * SHA-256(action_type + '|' + (target_entity_id ?? 'null') + '|' + actor_char_lws_id)
 *
 * @param {string} actionType
 * @param {string | null} targetEntityId
 * @param {string} actorCharLwsId
 * @returns {string}
 */
export function computeTieBreakHash(actionType, targetEntityId, actorCharLwsId) {
    const raw = `${actionType}|${targetEntityId ?? 'null'}|${actorCharLwsId}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}
