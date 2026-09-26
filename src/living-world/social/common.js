import { generateDeterministicUuid, isValidUuid } from '../authored/common.js';
import { safeJsonParse } from '../simulations/common.js';

export { generateDeterministicUuid, isValidUuid, safeJsonParse };

/**
 * 5 Canonical relationship dimensions.
 */
export const RELATIONSHIP_DIMENSIONS = Object.freeze([
    'trust',
    'affection',
    'familiarity',
    'respect',
    'loyalty',
]);

/**
 * Bounds for each relationship dimension.
 */
export const RELATIONSHIP_BOUNDS = Object.freeze({
    trust: { min: -100, max: 100 },
    affection: { min: -100, max: 100 },
    familiarity: { min: 0, max: 100 },
    respect: { min: -100, max: 100 },
    loyalty: { min: -100, max: 100 },
});

export const FACTION_MEMBERSHIP_STATUSES = Object.freeze([
    'active',
    'probation',
    'suspended',
    'exiled',
    'defected',
]);

export const DEVELOPMENT_CATEGORIES = Object.freeze([
    'value_shift',
    'disposition_shift',
    'habit_shift',
    'baseline_need_shift',
]);

export const TRIGGER_CATEGORIES = Object.freeze([
    'acute_trauma',
    'sustained_experience',
    'social_reinforcement',
    'cognitive_dissonance',
    'director_override',
]);

export const VERACITY_TYPES = Object.freeze([
    'true',
    'distorted',
    'false',
    'unknown',
]);

export const FAMILIARITY_GRACE_PERIOD_SECONDS = 604800; // 7 days
export const FAMILIARITY_TAU_SECONDS = 2592000; // 30 days

/**
 * Clamps a number between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
    if (typeof val !== 'number' || Number.isNaN(val)) return min;
    return Math.max(min, Math.min(max, val));
}

/**
 * Calculates decayed familiarity after elapsed time in seconds.
 * Formula: For deltaSeconds > 604800s:
 * Familiarity(T_now) = max(0, round(F0 * exp(-(deltaSeconds - 604800) / 2592000)))
 *
 * @param {number} initialFamiliarity
 * @param {number} deltaSeconds
 * @returns {number}
 */
export function calculateFamiliarityDecay(initialFamiliarity, deltaSeconds) {
    if (initialFamiliarity <= 0) return 0;
    if (deltaSeconds <= FAMILIARITY_GRACE_PERIOD_SECONDS) return initialFamiliarity;

    const elapsedAfterGrace = deltaSeconds - FAMILIARITY_GRACE_PERIOD_SECONDS;
    const decayed = initialFamiliarity * Math.exp(-elapsedAfterGrace / FAMILIARITY_TAU_SECONDS);
    return Math.max(0, Math.min(100, Math.round(decayed)));
}

/**
 * Formats a relationship database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatRelationship(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        source_character_id: row.source_character_lws_id || row.source_character_id,
        target_character_id: row.target_character_lws_id || row.target_character_id,
        trust: row.trust,
        affection: row.affection,
        familiarity: row.familiarity,
        respect: row.respect,
        loyalty: row.loyalty,
        last_interaction_fictional_time: row.last_interaction_fictional_time || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at || null,
    };
}

/**
 * Formats a relationship evidence database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatRelationshipEvidence(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        relationship_id: row.relationship_lws_id || row.relationship_id,
        source_character_id: row.source_character_lws_id || row.source_character_id,
        target_character_id: row.target_character_lws_id || row.target_character_id,
        causal_event_id: row.causal_event_lws_id || row.causal_event_id,
        fictional_time: row.fictional_time,
        delta_trust: row.delta_trust,
        delta_affection: row.delta_affection,
        delta_familiarity: row.delta_familiarity,
        delta_respect: row.delta_respect,
        delta_loyalty: row.delta_loyalty,
        interaction_type: row.interaction_type,
        narrative_rationale: row.narrative_rationale,
        created_at: row.created_at,
    };
}

/**
 * Formats a social information database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatSocialInformation(row) {
    if (!row) return null;
    const lwsId = row.lws_id;
    const isRoot = row.transmission_depth === 0;
    return {
        lws_id: lwsId,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        parent_social_information_id: row.parent_social_info_lws_id || row.parent_social_information_id || null,
        root_social_information_id: row.root_social_info_lws_id || row.root_social_information_id || (isRoot ? lwsId : null),
        originator_character_id: row.originator_character_lws_id || row.originator_character_id || null,
        transmitter_character_id: row.transmitter_character_lws_id || row.transmitter_character_id || null,
        recipient_character_id: row.recipient_character_lws_id || row.recipient_character_id || null,
        causal_event_id: row.causal_event_lws_id || row.causal_event_id || null,
        subject_key: row.subject_key,
        topic: row.topic,
        claim_statement: row.claim_statement,
        veracity: row.veracity,
        ground_truth_event_id: row.ground_truth_event_lws_id || row.ground_truth_event_id || null,
        distortion_level: row.distortion_level,
        transmission_depth: row.transmission_depth,
        confidence_score: row.confidence_score,
        fictional_time: row.fictional_time,
        created_at: row.created_at,
    };
}

/**
 * Formats a faction membership database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatFactionMembership(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        simulation_character_id: row.simulation_character_lws_id || row.simulation_character_id,
        faction_id: row.faction_lws_id || row.faction_id,
        faction_name: row.faction_name || undefined,
        rank_role: row.rank_role,
        standing: row.standing,
        loyalty_score: row.loyalty_score,
        membership_status: row.membership_status,
        joined_fictional_time: row.joined_fictional_time || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at || null,
    };
}

/**
 * Formats a development record database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatDevelopmentRecord(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        simulation_character_id: row.simulation_character_lws_id || row.simulation_character_id,
        dimension_category: row.dimension_category,
        dimension_key: row.dimension_key,
        previous_value: row.previous_value,
        new_value: row.new_value,
        delta: row.delta,
        trigger_category: row.trigger_category,
        causal_event_ids: safeJsonParse(row.causal_event_ids, []),
        stability: row.stability,
        fictional_time: row.fictional_time,
        created_at: row.created_at,
    };
}
