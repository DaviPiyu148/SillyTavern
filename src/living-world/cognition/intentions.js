import { generateDeterministicUuid, getProposalTarget, PROPOSABLE_ACTION_TYPES_14 } from './common.js';
import { LwsValidationError, LwsNotFoundError, LwsConflictError } from '../errors.js';
import { isoNow } from '../simulations/common.js';

export const INTENTION_STATUSES = Object.freeze([
    'active',
    'executing',
    'completed',
    'failed',
    'cancelled',
]);

export const CANCELLATION_REASONS = Object.freeze([
    'goal_completed',
    'goal_suspended',
    'goal_abandoned',
    'goal_deleted',
    'interrupted_by_acute_need',
    'preempted_by_higher_priority',
    'director_cancelled',
]);

/**
 * Formats a database row from lws_character_intentions for public presentation.
 *
 * @param {object} row
 * @returns {object | null}
 */
export function formatIntention(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        character_id: row.character_lws_id || row.simulation_character_id,
        goal_id: row.goal_lws_id ?? null,
        action_type: row.action_type,
        target_entity_type: row.target_entity_type,
        target_entity_id: row.target_entity_id ?? null,
        rationale: row.rationale || '',
        status: row.status,
        cancellation_reason: row.cancellation_reason ?? null,
        failure_reason: row.failure_reason ?? null,
        priority: row.priority,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Allocates attemptIndex for a character in a specific causal context.
 * Formula: 1 + max(0, attempts recorded in committed events for same sim, char, causalContext).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number} simCharId
 * @param {string} causalContext
 * @returns {number}
 */
export function allocateAttemptIndex(db, simId, simCharId, causalContext) {
    const events = db.prepare(`
        SELECT payload FROM lws_events
        WHERE simulation_id = ? AND actor_character_id = ?
        ORDER BY id DESC
    `).all(simId, simCharId);

    let maxAttempt = 0;
    for (const ev of events) {
        try {
            const p = typeof ev.payload === 'string' ? JSON.parse(ev.payload || '{}') : ev.payload;
            const intention = p.intention || p.cognition?.failed_intention;
            if (intention && intention.causal_context === causalContext) {
                if (typeof intention.attempt_index === 'number') {
                    maxAttempt = Math.max(maxAttempt, intention.attempt_index);
                }
            }
        } catch (_) {
            // Ignore malformed payload entries
        }
    }

    return maxAttempt + 1;
}

/**
 * Helper to resolve simulation and character rows.
 * @param {import('better-sqlite3').Database} db
 * @param {any} simIdOrObj
 * @param {any} charIdOrObj
 */
function resolveSimAndChar(db, simIdOrObj, charIdOrObj) {
    let sim = simIdOrObj;
    if (typeof simIdOrObj === 'number') {
        sim = db.prepare('SELECT * FROM lws_simulations WHERE id = ?').get(simIdOrObj);
    } else if (typeof simIdOrObj === 'string') {
        sim = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(simIdOrObj);
    }

    let char = charIdOrObj;
    if (typeof charIdOrObj === 'number') {
        char = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = ?').get(charIdOrObj);
    } else if (typeof charIdOrObj === 'string') {
        char = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(charIdOrObj);
    }

    return { sim, character: char };
}

/**
 * Creates a new intention in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} sim Simulation row or ID
 * @param {any} character SimulationCharacter row or ID
 * @param {object} intentionData
 * @param {object} [options]
 * @returns {object} Formatted intention
 */
export function createIntention(db, sim, character, intentionData, options = {}) {
    const resolved = resolveSimAndChar(db, sim, character);
    sim = resolved.sim;
    character = resolved.character;

    if (!sim) throw new LwsNotFoundError('Simulation not found');
    if (!character) throw new LwsNotFoundError('Character not found');

    if (!PROPOSABLE_ACTION_TYPES_14.includes(intentionData.action_type)) {
        throw new LwsValidationError(`Invalid action_type: ${intentionData.action_type}`, ['action_type']);
    }

    const target = getProposalTarget(intentionData);

    let goalInternalId = null;
    let parentGoal = null;
    if (intentionData.goal_id) {
        let g = null;
        if (typeof intentionData.goal_id === 'number') {
            g = db.prepare('SELECT * FROM lws_character_goals WHERE id = ?').get(intentionData.goal_id);
        } else {
            g = db.prepare('SELECT * FROM lws_character_goals WHERE lws_id = ?').get(intentionData.goal_id);
        }
        if (g) {
            goalInternalId = g.id;
            parentGoal = g;
        }
    }

    const causalContext = intentionData.causal_context || options.causalContext || 'authored';
    const attemptIndex = intentionData.attempt_index !== undefined
        ? intentionData.attempt_index
        : allocateAttemptIndex(db, sim.id, character.id, causalContext);

    // Intention UUID derivation (§10.1):
    // generateDeterministicUuid('intention', simLwsId, charLwsId, causalContext, String(attemptIndex), actionType)
    const intentionLwsId = intentionData.lws_id || generateDeterministicUuid(
        'intention',
        sim.lws_id,
        character.lws_id,
        causalContext,
        String(attemptIndex),
        intentionData.action_type,
    );

    const createdAt = options.createdAt || isoNow();
    const status = intentionData.status || 'active';
    const priority = intentionData.priority !== undefined
        ? Math.round(intentionData.priority)
        : (parentGoal ? parentGoal.priority : 50);

    db.prepare(`
        INSERT INTO lws_character_intentions (
            lws_id, simulation_id, simulation_character_id, goal_id,
            action_type, target_entity_type, target_entity_id, rationale,
            status, cancellation_reason, failure_reason, priority,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        intentionLwsId,
        sim.id,
        character.id,
        goalInternalId,
        intentionData.action_type,
        target.type,
        target.id,
        intentionData.rationale || '',
        status,
        intentionData.cancellation_reason || null,
        intentionData.failure_reason || null,
        priority,
        createdAt,
        createdAt,
    );

    return getIntentionByLwsId(db, intentionLwsId);
}

export const createCharacterIntention = createIntention;

/**
 * Retrieves a single intention by its UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} intentionLwsId
 * @returns {object | null}
 */
export function getIntentionByLwsId(db, intentionLwsId) {
    const row = db.prepare(`
        SELECT i.*,
               sim.lws_id AS simulation_lws_id,
               sc.lws_id AS character_lws_id,
               g.lws_id AS goal_lws_id
        FROM lws_character_intentions i
        JOIN lws_simulations sim ON i.simulation_id = sim.id
        JOIN lws_simulation_characters sc ON i.simulation_character_id = sc.id
        LEFT JOIN lws_character_goals g ON i.goal_id = g.id
        WHERE i.lws_id = ?
    `).get(intentionLwsId);

    return formatIntention(row);
}

export function getCharacterIntentionByLwsId(db, simId, simCharId, intentionLwsId) {
    return getIntentionByLwsId(db, intentionLwsId);
}

/**
 * Lists intentions for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} charIdOrLwsId
 * @param {object} [options]
 * @returns {object[]}
 */
export function listCharacterIntentions(db, charIdOrLwsId, options = {}) {
    let simCharId = charIdOrLwsId;
    if (typeof charIdOrLwsId === 'string') {
        const c = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(charIdOrLwsId);
        if (!c) return [];
        simCharId = c.id;
    }

    let sql = `
        SELECT i.*,
               sim.lws_id AS simulation_lws_id,
               sc.lws_id AS character_lws_id,
               g.lws_id AS goal_lws_id
        FROM lws_character_intentions i
        JOIN lws_simulations sim ON i.simulation_id = sim.id
        JOIN lws_simulation_characters sc ON i.simulation_character_id = sc.id
        LEFT JOIN lws_character_goals g ON i.goal_id = g.id
        WHERE i.simulation_character_id = ?
    `;

    const params = [simCharId];

    if (!options.include_terminal) {
        sql += ' AND i.status IN (\'active\', \'executing\')';
    }

    if (options.status) {
        sql += ' AND i.status = ?';
        params.push(options.status);
    }

    if (options.goal_id) {
        sql += ' AND (g.lws_id = ? OR i.goal_id = ?)';
        params.push(options.goal_id, options.goal_id);
    }

    sql += ' ORDER BY i.priority DESC, i.id ASC';

    if (options.limit && Number.isInteger(Number(options.limit))) {
        sql += ` LIMIT ${Number(options.limit)}`;
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatIntention);
}

export const getCharacterIntentions = listCharacterIntentions;

/**
 * Returns currently active/executing intention for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} charIdOrLwsId
 * @returns {object | null}
 */
export function getActiveIntention(db, charIdOrLwsId) {
    const list = listCharacterIntentions(db, charIdOrLwsId, { include_terminal: false });
    return list.length > 0 ? list[0] : null;
}

/**
 * Updates status of an intention.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} intentionLwsId
 * @param {string} status
 * @param {object} [details] { cancellation_reason, failure_reason, updatedAt }
 */
export function updateIntentionStatus(db, intentionLwsId, status, details = {}) {
    if (!INTENTION_STATUSES.includes(status)) {
        throw new LwsValidationError(`Invalid intention status: ${status}`, ['status']);
    }

    const updatedAt = details.updatedAt || isoNow();
    const cancellationReason = status === 'cancelled' ? (details.cancellation_reason || 'director_cancelled') : null;
    const failureReason = status === 'failed' ? (details.failure_reason || 'EXECUTION_FAILED') : null;

    db.prepare(`
        UPDATE lws_character_intentions
        SET status = ?, cancellation_reason = ?, failure_reason = ?, updated_at = ?
        WHERE lws_id = ?
    `).run(status, cancellationReason, failureReason, updatedAt, intentionLwsId);
}

export const updateCharacterIntentionStatus = updateIntentionStatus;
