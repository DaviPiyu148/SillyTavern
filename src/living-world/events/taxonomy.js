import { LwsValidationError, LwsAuthorityError } from '../errors.js';
import { isValidUuid } from '../authored/common.js';

/**
 * Closed 29-Event Taxonomy (ADR-010)
 */
export const EVENT_TYPES = Object.freeze({
    // Lifecycle (5)
    SIMULATION_START: 'SIMULATION_START',
    SIMULATION_PAUSE: 'SIMULATION_PAUSE',
    SIMULATION_RESUME: 'SIMULATION_RESUME',
    SIMULATION_STOP: 'SIMULATION_STOP',
    TRIGGER_SCHEDULED_EVENT: 'TRIGGER_SCHEDULED_EVENT', // Deferred Phase 5

    // Management (4)
    SCHEDULE_WORLD_EVENT: 'SCHEDULE_WORLD_EVENT',       // Deferred Phase 5
    CANCEL_SCHEDULED_EVENT: 'CANCEL_SCHEDULED_EVENT',   // Deferred Phase 5
    SUPERSEDE_SCHEDULED_EVENT: 'SUPERSEDE_SCHEDULED_EVENT', // Deferred Phase 5
    UPDATE_CHARACTER_ROUTINE: 'UPDATE_CHARACTER_ROUTINE',   // Deferred Phase 5

    // Proposable (20)
    MOVE_CHARACTER: 'MOVE_CHARACTER',
    UPDATE_CHARACTER_ACTIVITY: 'UPDATE_CHARACTER_ACTIVITY',
    UPDATE_PHYSICAL_CONDITION: 'UPDATE_PHYSICAL_CONDITION',
    UPDATE_RUNTIME_STATE: 'UPDATE_RUNTIME_STATE',
    CHARACTER_JOIN: 'CHARACTER_JOIN',
    CHARACTER_LEAVE: 'CHARACTER_LEAVE',
    DIRECTOR_MODIFY_STATE: 'DIRECTOR_MODIFY_STATE',
    DIRECTOR_NOTE: 'DIRECTOR_NOTE',
    DIRECTOR_INSPECT: 'DIRECTOR_INSPECT',
    COMMUNICATE: 'COMMUNICATE',
    INTERACT_OBJECT: 'INTERACT_OBJECT',
    EMOTE: 'EMOTE',
    OBSERVE: 'OBSERVE',
    GENERAL_ACTION: 'GENERAL_ACTION',
    REST: 'REST',
    WORK: 'WORK',
    CONSUME_ITEM: 'CONSUME_ITEM',
    TRANSFER_ITEM: 'TRANSFER_ITEM',
    COMBAT_ACTION: 'COMBAT_ACTION',
    TIME_ADVANCE: 'TIME_ADVANCE',                       // Deferred Phase 5
});

export const ALL_EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPES));

export const ACTIVE_PHASE_4_EVENTS = Object.freeze(new Set([
    EVENT_TYPES.SIMULATION_START,
    EVENT_TYPES.SIMULATION_PAUSE,
    EVENT_TYPES.SIMULATION_RESUME,
    EVENT_TYPES.SIMULATION_STOP,
    EVENT_TYPES.MOVE_CHARACTER,
    EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
    EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
    EVENT_TYPES.UPDATE_RUNTIME_STATE,
    EVENT_TYPES.CHARACTER_JOIN,
    EVENT_TYPES.CHARACTER_LEAVE,
    EVENT_TYPES.DIRECTOR_MODIFY_STATE,
    EVENT_TYPES.DIRECTOR_NOTE,
    EVENT_TYPES.DIRECTOR_INSPECT,
    EVENT_TYPES.COMMUNICATE,
    EVENT_TYPES.INTERACT_OBJECT,
    EVENT_TYPES.EMOTE,
    EVENT_TYPES.OBSERVE,
    EVENT_TYPES.GENERAL_ACTION,
    EVENT_TYPES.REST,
    EVENT_TYPES.WORK,
    EVENT_TYPES.CONSUME_ITEM,
    EVENT_TYPES.TRANSFER_ITEM,
    EVENT_TYPES.COMBAT_ACTION,
]));

export const DEFERRED_PHASE_5_EVENTS = Object.freeze(new Set([]));

export const ACTIVE_PHASE_5_EVENTS = Object.freeze(new Set(ALL_EVENT_TYPES));

export const STATEFUL_EVENTS = Object.freeze(new Set([
    EVENT_TYPES.SIMULATION_START,
    EVENT_TYPES.SIMULATION_PAUSE,
    EVENT_TYPES.SIMULATION_RESUME,
    EVENT_TYPES.SIMULATION_STOP,
    EVENT_TYPES.MOVE_CHARACTER,
    EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
    EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
    EVENT_TYPES.UPDATE_RUNTIME_STATE,
    EVENT_TYPES.CHARACTER_JOIN,
    EVENT_TYPES.CHARACTER_LEAVE,
    EVENT_TYPES.DIRECTOR_MODIFY_STATE,
    EVENT_TYPES.REST,
    EVENT_TYPES.WORK,
    EVENT_TYPES.TIME_ADVANCE,
    EVENT_TYPES.SCHEDULE_WORLD_EVENT,
    EVENT_TYPES.CANCEL_SCHEDULED_EVENT,
    EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT,
    EVENT_TYPES.TRIGGER_SCHEDULED_EVENT,
    EVENT_TYPES.UPDATE_CHARACTER_ROUTINE,
]));

export const PROVENANCE_TYPES = Object.freeze([
    'user',
    'director',
    'simulation_engine',
    'llm_proposal',
    'system',
]);

/**
 * Deterministic recursive deep merge algorithm.
 * Used identically by state transition handlers and the replay reducer.
 *
 * @param {any} target
 * @param {any} source
 * @returns {any}
 */
export function deepMerge(target, source) {
    if (typeof target !== 'object' || target === null || typeof source !== 'object' || source === null) {
        return source;
    }
    const output = Array.isArray(target) ? [...target] : { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            output[key] = deepMerge(output[key] || {}, value);
        } else {
            output[key] = value;
        }
    }
    return output;
}

/**
 * Validates the event type and structural payload fields for Stage 1 Schema Validation.
 *
 * @param {object} proposal
 */
export function validateProposalSchema(proposal) {
    if (!proposal || typeof proposal !== 'object') {
        throw new LwsValidationError('Proposal must be a valid object');
    }

    if (!proposal.event_type || typeof proposal.event_type !== 'string') {
        throw new LwsValidationError('event_type is required and must be a string', ['event_type']);
    }

    if (!ALL_EVENT_TYPES.includes(proposal.event_type)) {
        throw new LwsValidationError(`Unknown event_type: ${proposal.event_type}`, ['event_type']);
    }

    if (DEFERRED_PHASE_5_EVENTS.has(proposal.event_type)) {
        throw new LwsAuthorityError(
            `Event type ${proposal.event_type} is deferred to Phase 5`,
            'EVENT_TYPE_DEFERRED',
            ['event_type'],
        );
    }

    // Validate UUID parameters when present
    if (proposal.actor_character_id !== undefined && proposal.actor_character_id !== null) {
        if (!isValidUuid(proposal.actor_character_id)) {
            throw new LwsValidationError('Invalid actor_character_id UUID format', ['actor_character_id']);
        }
    }

    if (proposal.target_character_id !== undefined && proposal.target_character_id !== null) {
        if (!isValidUuid(proposal.target_character_id)) {
            throw new LwsValidationError('Invalid target_character_id UUID format', ['target_character_id']);
        }
    }

    if (proposal.location_id !== undefined && proposal.location_id !== null) {
        if (!isValidUuid(proposal.location_id)) {
            throw new LwsValidationError('Invalid location_id UUID format', ['location_id']);
        }
    }

    if (proposal.causal_event_id !== undefined && proposal.causal_event_id !== null) {
        if (!isValidUuid(proposal.causal_event_id)) {
            throw new LwsValidationError('Invalid causal_event_id UUID format', ['causal_event_id']);
        }
    }

    const payload = proposal.payload ?? {};
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new LwsValidationError('payload must be an object', ['payload']);
    }

    // Type-specific payload and structure checks
    switch (proposal.event_type) {
        case EVENT_TYPES.SIMULATION_START:
            if (proposal.actor_character_id || proposal.target_character_id) {
                throw new LwsValidationError('SIMULATION_START cannot have actor or target character');
            }
            break;

        case EVENT_TYPES.MOVE_CHARACTER:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for MOVE_CHARACTER', ['actor_character_id']);
            }
            if (!proposal.location_id && !payload.target_location_id) {
                throw new LwsValidationError('location_id or payload.target_location_id is required for MOVE_CHARACTER', ['location_id']);
            }
            break;

        case EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for UPDATE_CHARACTER_ACTIVITY', ['actor_character_id']);
            }
            if (typeof payload.activity !== 'string' || !payload.activity.trim()) {
                throw new LwsValidationError('payload.activity must be a non-empty string', ['payload.activity']);
            }
            break;

        case EVENT_TYPES.UPDATE_PHYSICAL_CONDITION:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for UPDATE_PHYSICAL_CONDITION', ['actor_character_id']);
            }
            if (typeof payload.physical_condition !== 'string' || !payload.physical_condition.trim()) {
                throw new LwsValidationError('payload.physical_condition must be a non-empty string', ['payload.physical_condition']);
            }
            break;

        case EVENT_TYPES.UPDATE_RUNTIME_STATE:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for UPDATE_RUNTIME_STATE', ['actor_character_id']);
            }
            if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
                throw new LwsValidationError('payload.patch must be an object', ['payload.patch']);
            }
            break;

        case EVENT_TYPES.CHARACTER_JOIN: {
            const charId = payload.character_id ?? proposal.authored_character_id;
            if (!charId || !isValidUuid(charId)) {
                throw new LwsValidationError('payload.character_id must be a valid authored character UUID for CHARACTER_JOIN', ['character_id']);
            }
            break;
        }

        case EVENT_TYPES.CHARACTER_LEAVE:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for CHARACTER_LEAVE', ['actor_character_id']);
            }
            break;

        case EVENT_TYPES.REST:
        case EVENT_TYPES.WORK:
        case EVENT_TYPES.CONSUME_ITEM:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError(`actor_character_id is required for ${proposal.event_type}`, ['actor_character_id']);
            }
            break;

        case EVENT_TYPES.COMMUNICATE:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for COMMUNICATE', ['actor_character_id']);
            }
            if (!proposal.location_id) {
                throw new LwsValidationError('location_id is required for COMMUNICATE', ['location_id']);
            }
            break;

        case EVENT_TYPES.TRANSFER_ITEM:
        case EVENT_TYPES.COMBAT_ACTION:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError(`actor_character_id is required for ${proposal.event_type}`, ['actor_character_id']);
            }
            if (!proposal.target_character_id) {
                throw new LwsValidationError(`target_character_id is required for ${proposal.event_type}`, ['target_character_id']);
            }
            if (!proposal.location_id) {
                throw new LwsValidationError(`location_id is required for ${proposal.event_type}`, ['location_id']);
            }
            break;

        case EVENT_TYPES.INTERACT_OBJECT:
        case EVENT_TYPES.OBSERVE:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError(`actor_character_id is required for ${proposal.event_type}`, ['actor_character_id']);
            }
            if (!proposal.location_id) {
                throw new LwsValidationError(`location_id is required for ${proposal.event_type}`, ['location_id']);
            }
            break;

        case EVENT_TYPES.EMOTE:
        case EVENT_TYPES.GENERAL_ACTION:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError(`actor_character_id is required for ${proposal.event_type}`, ['actor_character_id']);
            }
            break;

        case EVENT_TYPES.TIME_ADVANCE:
            if (!payload.target_fictional_time && payload.duration_seconds === undefined) {
                throw new LwsValidationError('target_fictional_time or duration_seconds is required for TIME_ADVANCE', ['target_fictional_time']);
            }
            break;

        case EVENT_TYPES.SCHEDULE_WORLD_EVENT:
            if (typeof payload.title !== 'string' || !payload.title.trim()) {
                throw new LwsValidationError('payload.title is required for SCHEDULE_WORLD_EVENT', ['payload.title']);
            }
            if (!payload.scheduled_fictional_time) {
                throw new LwsValidationError('payload.scheduled_fictional_time is required for SCHEDULE_WORLD_EVENT', ['payload.scheduled_fictional_time']);
            }
            break;

        case EVENT_TYPES.CANCEL_SCHEDULED_EVENT:
            if (!payload.scheduled_event_id || !isValidUuid(payload.scheduled_event_id)) {
                throw new LwsValidationError('payload.scheduled_event_id must be a valid UUID for CANCEL_SCHEDULED_EVENT', ['payload.scheduled_event_id']);
            }
            break;

        case EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT:
            if (!payload.predecessor_id || !isValidUuid(payload.predecessor_id)) {
                throw new LwsValidationError('payload.predecessor_id must be a valid UUID for SUPERSEDE_SCHEDULED_EVENT', ['payload.predecessor_id']);
            }
            if (typeof payload.title !== 'string' || !payload.title.trim()) {
                throw new LwsValidationError('payload.title is required for SUPERSEDE_SCHEDULED_EVENT', ['payload.title']);
            }
            if (!payload.scheduled_fictional_time) {
                throw new LwsValidationError('payload.scheduled_fictional_time is required for SUPERSEDE_SCHEDULED_EVENT', ['payload.scheduled_fictional_time']);
            }
            break;

        case EVENT_TYPES.TRIGGER_SCHEDULED_EVENT:
            if (!payload.scheduled_event_id || !isValidUuid(payload.scheduled_event_id)) {
                throw new LwsValidationError('payload.scheduled_event_id must be a valid UUID for TRIGGER_SCHEDULED_EVENT', ['payload.scheduled_event_id']);
            }
            break;

        case EVENT_TYPES.UPDATE_CHARACTER_ROUTINE:
            if (!proposal.actor_character_id) {
                throw new LwsValidationError('actor_character_id is required for UPDATE_CHARACTER_ROUTINE', ['actor_character_id']);
            }
            if (payload.action !== 'replace_all') {
                throw new LwsValidationError('payload.action must be \'replace_all\'', ['payload.action']);
            }
            if (!Array.isArray(payload.routines)) {
                throw new LwsValidationError('payload.routines must be an array', ['payload.routines']);
            }
            break;

        default:
            break;
    }
}
