import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    formatRelationshipEvidence,
    generateDeterministicUuid,
    isValidUuid,
} from './common.js';

/**
 * Inserts a relationship evidence record into SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @returns {object}
 */
export function createRelationshipEvidence(db, data) {
    const simId = data.simulation_id;
    const simLwsId = data.sim_lws_id;
    const relId = data.relationship_id;
    const relLwsId = data.rel_lws_id;
    const srcCharId = data.source_character_id;
    const srcCharLwsId = data.source_char_lws_id;
    const tgtCharId = data.target_character_id;
    const tgtCharLwsId = data.target_char_lws_id;
    const causalEventId = data.causal_event_id;
    const causalEventLwsId = data.causal_event_lws_id;
    const fictionalTime = data.fictional_time;
    const deltaTrust = data.delta_trust ?? 0;
    const deltaAffection = data.delta_affection ?? 0;
    const deltaFamiliarity = data.delta_familiarity ?? 0;
    const deltaRespect = data.delta_respect ?? 0;
    const deltaLoyalty = data.delta_loyalty ?? 0;
    const interactionType = data.interaction_type || 'interaction';
    const narrativeRationale = data.narrative_rationale || '';
    const createdAt = data.created_at;

    const lwsId = data.lws_id || generateDeterministicUuid(
        'rel_evidence',
        causalEventLwsId || String(causalEventId),
        srcCharLwsId || String(srcCharId),
        tgtCharLwsId || String(tgtCharId),
        String(deltaFamiliarity),
    );

    const stmt = db.prepare(`
        INSERT INTO lws_relationship_evidence (
            lws_id, simulation_id, relationship_id, source_character_id, target_character_id,
            causal_event_id, fictional_time, delta_trust, delta_affection, delta_familiarity,
            delta_respect, delta_loyalty, interaction_type, narrative_rationale, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        lwsId,
        simId,
        relId,
        srcCharId,
        tgtCharId,
        causalEventId,
        fictionalTime,
        deltaTrust,
        deltaAffection,
        deltaFamiliarity,
        deltaRespect,
        deltaLoyalty,
        interactionType,
        narrativeRationale,
        createdAt,
    );

    return getEvidenceByLwsId(db, simId, lwsId);
}

/**
 * Retrieves a single relationship evidence row by UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} evidenceLwsId
 * @returns {object}
 */
export function getEvidenceByLwsId(db, simId, evidenceLwsId) {
    if (!isValidUuid(evidenceLwsId)) {
        throw new LwsValidationError('Invalid evidence UUID format', ['evidenceLwsId']);
    }

    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const row = db.prepare(`
        SELECT e.*,
               s.lws_id AS simulation_lws_id,
               r.lws_id AS relationship_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id,
               ev.lws_id AS causal_event_lws_id
        FROM lws_relationship_evidence e
        JOIN lws_simulations s ON e.simulation_id = s.id
        JOIN lws_character_relationships r ON e.relationship_id = r.id
        JOIN lws_simulation_characters sc1 ON e.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON e.target_character_id = sc2.id
        JOIN lws_events ev ON e.causal_event_id = ev.id
        WHERE e.lws_id = ? AND e.simulation_id = ?
    `).get(evidenceLwsId, resolvedSimId);

    if (!row) {
        throw new LwsNotFoundError('Relationship evidence not found');
    }

    return formatRelationshipEvidence(row);
}

/**
 * Lists relationship evidence records for a specific relationship.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} relLwsId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {object[]}
 */
export function listRelationshipEvidence(db, simId, relLwsId, options = {}) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    let rel;
    if (typeof relLwsId === 'number') {
        rel = db.prepare('SELECT id FROM lws_character_relationships WHERE id = ? AND simulation_id = ?').get(relLwsId, resolvedSimId);
    } else {
        if (!isValidUuid(relLwsId)) {
            throw new LwsValidationError('Invalid relationship UUID format', ['relLwsId']);
        }
        rel = db.prepare('SELECT id FROM lws_character_relationships WHERE lws_id = ? AND simulation_id = ?').get(relLwsId, resolvedSimId);
    }
    if (!rel) {
        throw new LwsNotFoundError('Relationship not found');
    }

    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);

    const rows = db.prepare(`
        SELECT e.*,
               s.lws_id AS simulation_lws_id,
               r.lws_id AS relationship_lws_id,
               sc1.lws_id AS source_character_lws_id,
               sc2.lws_id AS target_character_lws_id,
               ev.lws_id AS causal_event_lws_id
        FROM lws_relationship_evidence e
        JOIN lws_simulations s ON e.simulation_id = s.id
        JOIN lws_character_relationships r ON e.relationship_id = r.id
        JOIN lws_simulation_characters sc1 ON e.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON e.target_character_id = sc2.id
        JOIN lws_events ev ON e.causal_event_id = ev.id
        WHERE e.relationship_id = ? AND e.simulation_id = ?
        ORDER BY e.fictional_time DESC, e.id DESC
        LIMIT ? OFFSET ?
    `).all(rel.id, resolvedSimId, limit, offset);

    return rows.map(formatRelationshipEvidence);
}
