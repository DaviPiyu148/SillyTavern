/**
 * Living World Simulator (LWS) - Simulation Character Tiers & Cognitive Budgeting
 */

import { generateUuid } from '../authored/common.js';
import { LwsValidationError, LwsConflictError } from '../errors.js';
import { POPULATION_TIERS, COGNITIVE_BUDGETS } from './common.js';

/**
 * Retrieves character tier for a simulation character.
 * Defaults to 'core' / 'full' if no explicit tier record exists.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} simulationCharacterId
 * @returns {{ id?: number, lws_id?: string, simulation_id: number, simulation_character_id: number, tier: string, cognitive_budget: string, is_promoted: number }}
 */
export function getCharacterTier(db, simulationId, simulationCharacterId) {
    const row = db.prepare(`
        SELECT * FROM lws_simulation_character_tiers
        WHERE simulation_id = ? AND simulation_character_id = ?
    `).get(simulationId, simulationCharacterId);

    if (row) {
        return {
            id: row.id,
            lws_id: row.lws_id,
            simulation_id: row.simulation_id,
            simulation_character_id: row.simulation_character_id,
            tier: row.tier,
            cognitive_budget: row.cognitive_budget,
            is_promoted: row.is_promoted,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }

    return {
        simulation_id: simulationId,
        simulation_character_id: simulationCharacterId,
        tier: POPULATION_TIERS.CORE,
        cognitive_budget: COGNITIVE_BUDGETS.FULL,
        is_promoted: 0,
    };
}

/**
 * Sets character tier for a simulation character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} simulationCharacterId
 * @param {'core'|'supporting'} tier
 * @param {number} [isPromoted=0]
 * @returns {object}
 */
export function setCharacterTier(db, simulationId, simulationCharacterId, tier, isPromoted = 0) {
    if (tier !== POPULATION_TIERS.CORE && tier !== POPULATION_TIERS.SUPPORTING) {
        throw new LwsValidationError(`Invalid character tier: ${tier}`, ['tier']);
    }

    const cognitiveBudget = tier === POPULATION_TIERS.CORE ? COGNITIVE_BUDGETS.FULL : COGNITIVE_BUDGETS.LIGHTWEIGHT;
    const now = new Date().toISOString();

    const existing = db.prepare(`
        SELECT * FROM lws_simulation_character_tiers
        WHERE simulation_id = ? AND simulation_character_id = ?
    `).get(simulationId, simulationCharacterId);

    if (existing) {
        db.prepare(`
            UPDATE lws_simulation_character_tiers
            SET tier = ?,
                cognitive_budget = ?,
                is_promoted = ?,
                updated_at = ?
            WHERE id = ?
        `).run(tier, cognitiveBudget, isPromoted ? 1 : 0, now, existing.id);

        return db.prepare('SELECT * FROM lws_simulation_character_tiers WHERE id = ?').get(existing.id);
    }

    const lwsId = generateUuid();
    db.prepare(`
        INSERT INTO lws_simulation_character_tiers (
            lws_id, simulation_id, simulation_character_id,
            tier, cognitive_budget, is_promoted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        lwsId,
        simulationId,
        simulationCharacterId,
        tier,
        cognitiveBudget,
        isPromoted ? 1 : 0,
        now,
        now,
    );

    return db.prepare('SELECT * FROM lws_simulation_character_tiers WHERE lws_id = ?').get(lwsId);
}

/**
 * Elevates a supporting character to Core tier. Demotion from Core to Supporting is prohibited.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} simulationCharacterId
 * @param {'core'|'supporting'} targetTier
 * @returns {object}
 */
export function elevateCharacterTier(db, simulationId, simulationCharacterId, targetTier) {
    const current = getCharacterTier(db, simulationId, simulationCharacterId);

    if (current.tier === POPULATION_TIERS.CORE && targetTier === POPULATION_TIERS.SUPPORTING) {
        throw new LwsConflictError('Demoting a Core character to Supporting is prohibited in Phase 9');
    }

    return setCharacterTier(db, simulationId, simulationCharacterId, targetTier, current.is_promoted);
}

/**
 * Lists all simulation character tiers in a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @returns {object[]}
 */
export function listCharacterTiers(db, simulationId) {
    return db.prepare(`
        SELECT * FROM lws_simulation_character_tiers
        WHERE simulation_id = ?
        ORDER BY id ASC
    `).all(simulationId);
}
