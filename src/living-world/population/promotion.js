/**
 * Living World Simulator (LWS) - Emergent Entity Promotion Service
 */

import { generateUuid } from '../authored/common.js';
import { LwsNotFoundError, LwsValidationError, LwsConflictError } from '../errors.js';
import { parseTransientId, getTimeBucket, POPULATION_TIERS, PROMOTION_REASONS } from './common.js';
import { generateAmbientPopulation } from './ambient-generator.js';
import { getLocationEnvironment, formatEnvironmentRow } from '../environment/environment.js';
import { getLocationOperationalState } from '../environment/operational-states.js';
import { listAmbientArchetypes, formatArchetypeRow } from './archetypes.js';

/**
 * Formats a raw database row from lws_promoted_entity_records.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatPromotionRecordRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        lws_id: row.lws_id,
        simulation_id: row.simulation_id,
        simulation_character_id: row.simulation_character_id,
        source_archetype_key: row.source_archetype_key,
        source_transient_id: row.source_transient_id,
        origin_location_id: row.origin_location_id,
        promotion_reason: row.promotion_reason,
        causal_event_id: row.causal_event_id,
        promoted_to_tier: row.promoted_to_tier,
        fictional_time: row.fictional_time,
        created_at: row.created_at,
    };
}

/**
 * Validates and proves the existence of a transient ambient entity, returning a validation status object.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} simulationId
 * @param {number|string} locationIdOrTransientId
 * @param {string} fictionalTimeOrTransientId
 * @param {string} [maybeTransientId]
 * @returns {{ valid: boolean, archetype_key?: string, archetype?: object, location_lws_id?: string, entity?: object, reason?: string }}
 */
export function validateTransientIdExistence(db, simulationId, locationIdOrTransientId, fictionalTimeOrTransientId, maybeTransientId) {
    try {
        let transientId;
        let fictionalTime;
        let locationId;

        if (maybeTransientId !== undefined) {
            // (db, simulationId, locationId, fictionalTime, transientId)
            locationId = locationIdOrTransientId;
            fictionalTime = fictionalTimeOrTransientId;
            transientId = maybeTransientId;
        } else {
            // (db, simulationId, transientId, fictionalTime)
            transientId = locationIdOrTransientId;
            fictionalTime = fictionalTimeOrTransientId;
        }

        if (!transientId || typeof transientId !== 'string') {
            return { valid: false, reason: 'transient_id must be a non-empty string' };
        }

        const parsed = parseTransientId(transientId);

        // 1. Verify simulation identity
        let numericSimId = simulationId;
        let sim = typeof simulationId === 'number'
            ? db.prepare('SELECT * FROM lws_simulations WHERE id = ?').get(simulationId)
            : db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(simulationId);

        if (!sim) {
            return { valid: false, reason: `Simulation '${simulationId}' not found` };
        }
        numericSimId = sim.id;

        if (sim.lws_id !== parsed.simLwsId) {
            return { valid: false, reason: `Transient ID simulation '${parsed.simLwsId}' does not match active simulation '${sim.lws_id}'` };
        }

        // 2. Verify location identity
        let loc;
        if (locationId !== undefined && typeof locationId === 'number') {
            loc = db.prepare('SELECT * FROM lws_locations WHERE id = ? AND world_id = ?').get(locationId, sim.world_id);
        } else {
            loc = db.prepare('SELECT * FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(parsed.locLwsId, sim.world_id);
        }

        if (!loc || loc.lws_id !== parsed.locLwsId) {
            return { valid: false, reason: `Transient ID location '${parsed.locLwsId}' does not match location in world` };
        }

        // 3. Verify time bucket
        const expectedBucket = getTimeBucket(fictionalTime);
        if (parsed.timeBucket !== expectedBucket) {
            return { valid: false, reason: `Transient ID time bucket '${parsed.timeBucket}' does not match event time bucket '${expectedBucket}'` };
        }

        // 4. Check if already promoted in this simulation
        const alreadyPromoted = db.prepare(`
            SELECT id FROM lws_promoted_entity_records
            WHERE simulation_id = ? AND source_transient_id = ?
        `).get(numericSimId, transientId);

        if (alreadyPromoted) {
            return { valid: false, reason: `Ambient entity '${transientId}' has already been promoted` };
        }

        // 5. Run deterministic generator with full canonical signature
        const env = getLocationEnvironment(db, numericSimId, loc.id, fictionalTime);
        const ops = getLocationOperationalState(db, numericSimId, loc.id, fictionalTime);
        const archetypes = listAmbientArchetypes(db, sim.world_id);
        const activeSimChars = db.prepare(`
            SELECT sc.*, c.name FROM lws_simulation_characters sc
            JOIN lws_characters c ON sc.character_id = c.id
            WHERE sc.simulation_id = ? AND sc.current_location_id = ? AND sc.deleted_at IS NULL
        `).all(numericSimId, loc.id);

        const generated = generateAmbientPopulation(
            sim.lws_id,
            loc.lws_id,
            parsed.timeBucket,
            sim.world_id,
            env,
            ops,
            archetypes,
            activeSimChars,
            loc,
        );

        const matched = generated.find(e => e.slot_index === parsed.slotIndex);
        if (!matched) {
            return { valid: false, reason: `Ambient entity '${transientId}' not found at slot ${parsed.slotIndex}` };
        }

        if (parsed.archetypeKey && matched.archetype_key !== parsed.archetypeKey) {
            return { valid: false, reason: `Ambient entity '${transientId}' not found: archetype key '${parsed.archetypeKey}' does not match '${matched.archetype_key}'` };
        }

        return {
            valid: true,
            archetype_key: matched.archetype_key,
            archetype: matched,
            location_lws_id: loc.lws_id,
            entity: matched,
        };
    } catch (err) {
        return { valid: false, reason: `Ambient entity not found: ${err.message}` };
    }
}

/**
 * Validates and proves the existence of a transient ambient entity, throwing on failure.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} simulationId
 * @param {number|string} locationIdOrTransientId
 * @param {string} fictionalTimeOrTransientId
 * @param {string} [maybeTransientId]
 * @returns {object} The matched ambient entity
 */
export function validateTransientId(db, simulationId, locationIdOrTransientId, fictionalTimeOrTransientId, maybeTransientId) {
    const result = validateTransientIdExistence(db, simulationId, locationIdOrTransientId, fictionalTimeOrTransientId, maybeTransientId);
    if (!result.valid) {
        if (result.reason?.includes('already been promoted')) {
            throw new LwsConflictError(result.reason);
        }
        throw new LwsValidationError(result.reason || 'Ambient entity validation failed', ['transient_id']);
    }
    return result.entity;
}

/**
 * Lists all promoted entity records for a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @returns {object[]}
 */
export function listPromotedEntities(db, simulationId) {
    const rows = db.prepare(`
        SELECT * FROM lws_promoted_entity_records
        WHERE simulation_id = ?
        ORDER BY id ASC
    `).all(simulationId);

    return rows.map(formatPromotionRecordRow);
}

/**
 * Retrieves a promoted entity record by transient ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {string} transientId
 * @returns {object|null}
 */
export function getPromotedEntityByTransientId(db, simulationId, transientId) {
    const row = db.prepare(`
        SELECT * FROM lws_promoted_entity_records
        WHERE simulation_id = ? AND source_transient_id = ?
    `).get(simulationId, transientId);

    return formatPromotionRecordRow(row);
}
