/**
 * Living World Simulator (LWS) - Population Tiers and Collision-Proof Transient ID Common Helpers
 */

import { LwsValidationError } from '../errors.js';

export const POPULATION_TIERS = Object.freeze({
    CORE: 'core',
    SUPPORTING: 'supporting',
    AMBIENT: 'ambient',
});

export const COGNITIVE_BUDGETS = Object.freeze({
    FULL: 'full',
    LIGHTWEIGHT: 'lightweight',
});

export const PROMOTION_REASONS = Object.freeze([
    'direct_interaction',
    'causal_event_witness',
    'director_intervention',
]);

export const ENTITY_KINDS = Object.freeze([
    'person',
    'vehicle',
    'creature',
    'crowd',
]);

/**
 * Calculates discrete 1-hour time bucket from fictional ISO timestamp string.
 *
 * @param {string} fictionalTime
 * @returns {number} Integer bucket (floor(epoch_seconds / 3600))
 */
export function getTimeBucket(fictionalTime) {
    if (!fictionalTime) {
        throw new LwsValidationError('fictionalTime is required to compute time bucket');
    }
    const date = new Date(fictionalTime);
    if (isNaN(date.getTime())) {
        throw new LwsValidationError(`Invalid fictional timestamp: ${fictionalTime}`);
    }
    const epochSec = Math.floor(date.getTime() / 1000);
    return Math.floor(epochSec / 3600);
}

/**
 * Constructs collision-proof transient ID for an ambient entity.
 * Format: amb:<simLwsId>:<locLwsId>:<timeBucket>:<slotIndex>
 *
 * @param {string} simLwsId
 * @param {string} locLwsId
 * @param {number} timeBucket
 * @param {number} slotIndex
 * @returns {string}
 */
export function buildTransientId(simLwsId, locLwsId, timeBucket, slotIndexOrArchetype, maybeSlotIndex) {
    if (maybeSlotIndex !== undefined) {
        return `amb:${simLwsId}:${locLwsId}:${timeBucket}:${slotIndexOrArchetype}:${maybeSlotIndex}`;
    }
    return `amb:${simLwsId}:${locLwsId}:${timeBucket}:${slotIndexOrArchetype}`;
}

/**
 * Parses a compound transient ID.
 *
 * @param {string} transientId
 * @returns {{ prefix: string, simLwsId: string, locLwsId: string, timeBucket: number|string, slotIndex: number, archetypeKey?: string }}
 */
export function parseTransientId(transientId) {
    if (typeof transientId !== 'string' || !transientId.startsWith('amb:')) {
        throw new LwsValidationError(`Invalid transient ID format: ${transientId}`, ['transient_id']);
    }

    const parts = transientId.split(':');
    if (parts.length === 6) {
        const [prefix, simLwsId, locLwsId, timeBucketStr, archetypeKey, slotIndexStr] = parts;
        const timeBucketNum = parseInt(timeBucketStr, 10);
        const timeBucket = Number.isNaN(timeBucketNum) ? timeBucketStr : timeBucketNum;
        const slotIndex = parseInt(slotIndexStr, 10);

        if (Number.isNaN(slotIndex) || slotIndex < 0) {
            throw new LwsValidationError(`Invalid numeric fields in transient ID: ${transientId}`, ['transient_id']);
        }

        return {
            prefix,
            simLwsId,
            locLwsId,
            timeBucket,
            archetypeKey,
            slotIndex,
        };
    }

    if (parts.length === 5) {
        const [prefix, simLwsId, locLwsId, timeBucketStr, slotIndexStr] = parts;
        const timeBucketNum = parseInt(timeBucketStr, 10);
        const timeBucket = Number.isNaN(timeBucketNum) ? timeBucketStr : timeBucketNum;
        const slotIndex = parseInt(slotIndexStr, 10);

        if (Number.isNaN(slotIndex) || slotIndex < 0) {
            throw new LwsValidationError(`Invalid numeric fields in transient ID: ${transientId}`, ['transient_id']);
        }

        return {
            prefix,
            simLwsId,
            locLwsId,
            timeBucket,
            slotIndex,
        };
    }

    throw new LwsValidationError(`Invalid transient ID structure: ${transientId}`, ['transient_id']);
}
