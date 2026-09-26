import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    RELATIONSHIP_DIMENSIONS,
    RELATIONSHIP_BOUNDS,
    clamp,
    calculateFamiliarityDecay,
    formatRelationship,
    generateDeterministicUuid,
    isValidUuid,
} from './common.js';
import { createRelationshipEvidence } from './evidence.js';

/**
 * Retrieves a single directional relationship by UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} relLwsId
 * @returns {object}
 */
export function getRelationship(db, simId, relLwsId) {
    if (!isValidUuid(relLwsId)) {
        throw new LwsValidationError('Invalid relationship UUID format', ['relLwsId']);
    }

    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const row = db.prepare(`
        SELECT r.*,
               s.lws_id AS simulation_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulations s ON r.simulation_id = s.id
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.lws_id = ? AND r.simulation_id = ? AND r.deleted_at IS NULL
    `).get(relLwsId, resolvedSimId);

    if (!row) {
        throw new LwsNotFoundError('Relationship not found');
    }

    return formatRelationship(row);
}

/**
 * Retrieves a directional relationship from source to target character.
 * Returns null if not yet established.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} srcChar
 * @param {number | string} tgtChar
 * @returns {object | null}
 */
export function getRelationshipByCharacters(db, simId, srcChar, tgtChar) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return null;
        resolvedSimId = s.id;
    }

    const srcRow = typeof srcChar === 'string'
        ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(srcChar, srcChar, resolvedSimId)
        : db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(srcChar, resolvedSimId);

    const tgtRow = typeof tgtChar === 'string'
        ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(tgtChar, tgtChar, resolvedSimId)
        : db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(tgtChar, resolvedSimId);

    if (!srcRow || !tgtRow) return null;

    const row = db.prepare(`
        SELECT r.*,
               s.lws_id AS simulation_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulations s ON r.simulation_id = s.id
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ? AND r.source_character_id = ? AND r.target_character_id = ? AND r.deleted_at IS NULL
    `).get(resolvedSimId, srcRow.id, tgtRow.id);

    return row ? formatRelationship(row) : null;
}

/**
 * Lists all directional relationships originating from a source character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} srcChar
 * @param {object} [options]
 * @returns {object[]}
 */
export function listCharacterRelationships(db, simId, srcChar, options = {}) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    const srcRow = typeof srcChar === 'string'
        ? db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(srcChar, srcChar, resolvedSimId)
        : db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(srcChar, resolvedSimId);

    if (!srcRow) return [];

    let sql = `
        SELECT r.*,
               s.lws_id AS simulation_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulations s ON r.simulation_id = s.id
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ? AND r.source_character_id = ? AND r.deleted_at IS NULL
    `;
    const params = [resolvedSimId, srcRow.id];

    if (options.min_familiarity !== undefined) {
        sql += ' AND r.familiarity >= ?';
        params.push(Number(options.min_familiarity));
    }

    sql += ' ORDER BY sc2.id ASC';

    if (options.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(Number(options.limit));
        if (options.offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(Number(options.offset));
        }
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatRelationship);
}

/**
 * Lists all relationships across the entire simulation (for privileged observer).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @returns {object[]}
 */
export function listSimulationRelationships(db, simId) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    const rows = db.prepare(`
        SELECT r.*,
               s.lws_id AS simulation_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulations s ON r.simulation_id = s.id
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ? AND r.deleted_at IS NULL
        ORDER BY sc1.id ASC, sc2.id ASC
    `).all(resolvedSimId);

    return rows.map(formatRelationship);
}

/**
 * Exports complete relationship graph between characters in a simulation (for privileged observer).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @returns {{ characters: object[], edges: object[] }}
 */
export function exportSocialGraph(db, simId) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return { characters: [], edges: [] };
        resolvedSimId = s.id;
    }

    const characters = db.prepare(`
        SELECT sc.id, sc.lws_id, c.name, sc.activity, sc.physical_condition
        FROM lws_simulation_characters sc
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
        ORDER BY sc.id ASC
    `).all(resolvedSimId);

    const relationships = listSimulationRelationships(db, resolvedSimId);

    return {
        characters: characters.map(c => ({
            id: c.lws_id,
            name: c.name,
            activity: c.activity,
            condition: c.physical_condition,
        })),
        edges: relationships.map(r => ({
            id: r.lws_id,
            source_character_id: r.source_character_id,
            target_character_id: r.target_character_id,
            trust: r.trust,
            affection: r.affection,
            familiarity: r.familiarity,
            respect: r.respect,
            loyalty: r.loyalty,
            last_interaction_fictional_time: r.last_interaction_fictional_time,
        })),
    };
}


/**
 * Applies a directional relationship delta from source to target character,
 * updates the relationship row (or inserts if absent), and logs an evidence record.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} simLwsId
 * @param {number} srcCharId
 * @param {string} srcCharLwsId
 * @param {number} tgtCharId
 * @param {string} tgtCharLwsId
 * @param {object} delta
 * @param {number} causalEventId
 * @param {string} causalEventLwsId
 * @param {string} fictionalTime
 * @param {string} interactionType
 * @param {string} narrativeRationale
 * @param {string} createdAt
 * @returns {object} Updated relationship
 */
export function applyRelationshipDelta(
    db,
    simId,
    simLwsId,
    srcCharId,
    srcCharLwsId,
    tgtCharId,
    tgtCharLwsId,
    delta = {},
    causalEventId,
    causalEventLwsId,
    fictionalTime,
    interactionType = 'interaction',
    narrativeRationale = '',
    createdAt,
) {
    if (srcCharId === tgtCharId) {
        return null;
    }

    let existing = db.prepare(`
        SELECT * FROM lws_character_relationships
        WHERE simulation_id = ? AND source_character_id = ? AND target_character_id = ? AND deleted_at IS NULL
    `).get(simId, srcCharId, tgtCharId);

    let relId;
    let relLwsId;
    let currentTrust = existing?.trust ?? 0;
    let currentAffection = existing?.affection ?? 0;
    let currentFamiliarity = existing?.familiarity ?? 0;
    let currentRespect = existing?.respect ?? 0;
    let currentLoyalty = existing?.loyalty ?? 0;

    const dTrust = delta.delta_trust ?? delta.trust ?? 0;
    const dAffection = delta.delta_affection ?? delta.affection ?? 0;
    const dFamiliarity = delta.delta_familiarity ?? delta.familiarity ?? 0;
    const dRespect = delta.delta_respect ?? delta.respect ?? 0;
    const dLoyalty = delta.delta_loyalty ?? delta.loyalty ?? 0;

    const nextTrust = clamp(currentTrust + dTrust, -100, 100);
    const nextAffection = clamp(currentAffection + dAffection, -100, 100);
    const nextFamiliarity = clamp(currentFamiliarity + dFamiliarity, 0, 100);
    const nextRespect = clamp(currentRespect + dRespect, -100, 100);
    const nextLoyalty = clamp(currentLoyalty + dLoyalty, -100, 100);

    const actualDeltaTrust = nextTrust - currentTrust;
    const actualDeltaAffection = nextAffection - currentAffection;
    const actualDeltaFamiliarity = nextFamiliarity - currentFamiliarity;
    const actualDeltaRespect = nextRespect - currentRespect;
    const actualDeltaLoyalty = nextLoyalty - currentLoyalty;

    if (!existing) {
        relLwsId = generateDeterministicUuid('relationship', simLwsId, srcCharLwsId, tgtCharLwsId);
        const res = db.prepare(`
            INSERT INTO lws_character_relationships (
                lws_id, simulation_id, source_character_id, target_character_id,
                trust, affection, familiarity, respect, loyalty,
                last_interaction_fictional_time, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            relLwsId,
            simId,
            srcCharId,
            tgtCharId,
            nextTrust,
            nextAffection,
            nextFamiliarity,
            nextRespect,
            nextLoyalty,
            fictionalTime,
            createdAt,
            createdAt,
        );
        relId = res.lastInsertRowid;
    } else {
        relId = existing.id;
        relLwsId = existing.lws_id;
        db.prepare(`
            UPDATE lws_character_relationships
            SET trust = ?, affection = ?, familiarity = ?, respect = ?, loyalty = ?,
                last_interaction_fictional_time = ?, updated_at = ?
            WHERE id = ?
        `).run(
            nextTrust,
            nextAffection,
            nextFamiliarity,
            nextRespect,
            nextLoyalty,
            fictionalTime,
            createdAt,
            relId,
        );
    }

    // Insert relationship evidence
    createRelationshipEvidence(db, {
        simulation_id: simId,
        sim_lws_id: simLwsId,
        relationship_id: relId,
        rel_lws_id: relLwsId,
        source_character_id: srcCharId,
        source_char_lws_id: srcCharLwsId,
        target_character_id: tgtCharId,
        target_char_lws_id: tgtCharLwsId,
        causal_event_id: causalEventId,
        causal_event_lws_id: causalEventLwsId,
        fictional_time: fictionalTime,
        delta_trust: actualDeltaTrust,
        delta_affection: actualDeltaAffection,
        delta_familiarity: actualDeltaFamiliarity,
        delta_respect: actualDeltaRespect,
        delta_loyalty: actualDeltaLoyalty,
        interaction_type: interactionType,
        narrative_rationale: narrativeRationale || `Relationship shift via ${interactionType}`,
        created_at: createdAt,
    });

    return getRelationship(db, simId, relLwsId);
}

/**
 * Evaluates familiarity decay across all active relationships in a simulation.
 * Called during TIME_ADVANCE.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} simLwsId
 * @param {string} currentFictionalTime
 * @param {number} causalEventId
 * @param {string} causalEventLwsId
 * @param {string} createdAt
 */
export function evaluateFamiliarityDecay(
    db,
    simId,
    simLwsId,
    currentFictionalTime,
    causalEventId,
    causalEventLwsId,
    createdAt,
) {
    const relationships = db.prepare(`
        SELECT r.*,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ? AND r.deleted_at IS NULL AND r.familiarity > 0
    `).all(simId);

    const currentTimeMs = new Date(currentFictionalTime).getTime();

    for (const rel of relationships) {
        if (!rel.last_interaction_fictional_time) continue;
        const lastTimeMs = new Date(rel.last_interaction_fictional_time).getTime();
        const deltaSeconds = Math.floor((currentTimeMs - lastTimeMs) / 1000);

        if (deltaSeconds > 604800) {
            const nextFam = calculateFamiliarityDecay(rel.familiarity, deltaSeconds);
            const deltaFam = nextFam - rel.familiarity;

            if (deltaFam <= -1) {
                db.prepare(`
                    UPDATE lws_character_relationships
                    SET familiarity = ?, updated_at = ?
                    WHERE id = ?
                `).run(nextFam, createdAt, rel.id);

                createRelationshipEvidence(db, {
                    simulation_id: simId,
                    sim_lws_id: simLwsId,
                    relationship_id: rel.id,
                    rel_lws_id: rel.lws_id,
                    source_character_id: rel.source_character_id,
                    source_char_lws_id: rel.source_character_lws_id,
                    target_character_id: rel.target_character_id,
                    target_char_lws_id: rel.target_character_lws_id,
                    causal_event_id: causalEventId,
                    causal_event_lws_id: causalEventLwsId,
                    fictional_time: currentFictionalTime,
                    delta_trust: 0,
                    delta_affection: 0,
                    delta_familiarity: deltaFam,
                    delta_respect: 0,
                    delta_loyalty: 0,
                    interaction_type: 'temporal_decay',
                    narrative_rationale: 'Familiarity decayed due to elapsed fictional time without interaction (> 7 days)',
                    created_at: createdAt,
                });
            }
        }
    }
}
