import { generateDeterministicUuid, goalTargetType, targetsMatch } from './common.js';
import { LwsValidationError, LwsNotFoundError, LwsConflictError, LwsInvalidStateTransitionError } from '../errors.js';
import { isValidUuid, isoNow } from '../simulations/common.js';
import { EVENT_TYPES } from '../events/taxonomy.js';
import { internalCommitEvent } from '../events/events.js';
import { getCharacterTier } from '../population/character-tiers.js';

export const GOAL_TYPES = Object.freeze([
    'short_term',
    'long_term',
    'routine_override',
    'acute_need',
]);

export const GOAL_STATUSES = Object.freeze([
    'active',
    'completed',
    'suspended',
    'abandoned',
]);

export const IMMUTABLE_GOAL_FIELDS = Object.freeze([
    'id',
    'lws_id',
    'simulation_id',
    'simulation_character_id',
    'causal_event_id',
    'goal_type',
    'client_goal_key',
]);

/**
 * Formats a database row from lws_character_goals for public presentation.
 *
 * @param {object} row
 * @returns {object | null}
 */
export function formatGoal(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id || row.simulation_id,
        character_id: row.character_lws_id || row.simulation_character_id,
        client_goal_key: row.client_goal_key ?? null,
        title: row.title,
        description: row.description || '',
        goal_type: row.goal_type,
        status: row.status,
        priority: row.priority,
        urgency: row.urgency,
        progress: row.progress,
        objective_action_type: row.objective_action_type ?? null,
        target_location_id: row.target_location_lws_id ?? null,
        target_character_id: row.target_character_lws_id ?? null,
        target_object_id: row.target_object_id ?? null,
        deadline_fictional_time: row.deadline_fictional_time ?? null,
        causal_event_id: row.causal_event_lws_id ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at ?? null,
    };
}

/**
 * Allocates the 1-based goalIndex for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @returns {number}
 */
export function allocateGoalIndex(db, simCharId) {
    const row = db.prepare(`
        SELECT COUNT(*) AS cnt
        FROM lws_character_goals
        WHERE simulation_character_id = ?
    `).get(simCharId);
    return (row?.cnt || 0) + 1;
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
 * Creates a new character goal in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} sim Simulation row or ID
 * @param {any} character SimulationCharacter row or ID
 * @param {object} input Goal creation payload
 * @param {object} [options]
 * @returns {object} Formatted goal
 */
export function createGoal(db, sim, character, input, options = {}) {
    const resolved = resolveSimAndChar(db, sim, character);
    sim = resolved.sim;
    character = resolved.character;

    if (!sim) throw new LwsNotFoundError('Simulation not found');
    if (!character) throw new LwsNotFoundError('Character not found');

    const charTier = getCharacterTier(db, sim.id, character.id);
    if (charTier.tier === 'supporting') {
        throw new LwsInvalidStateTransitionError('Supporting tier characters cannot have explicit persistent goals', 'SUPPORTING_COGNITION_BLOCKED');
    }

    if (!input || typeof input !== 'object') {
        throw new LwsValidationError('Goal input must be an object');
    }

    if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
        throw new LwsValidationError('title is required and must be a non-empty string', ['title']);
    }

    const goalType = input.goal_type || 'short_term';
    if (!GOAL_TYPES.includes(goalType)) {
        throw new LwsValidationError(`Invalid goal_type: ${goalType}`, ['goal_type']);
    }

    let priority = input.priority !== undefined ? Math.round(input.priority) : 50;
    if (goalType === 'acute_need') {
        if (priority < 80 || priority > 100) {
            throw new LwsValidationError('acute_need priority must be between 80 and 100', ['priority']);
        }
    } else {
        if (priority < 1 || priority > 79) {
            throw new LwsValidationError('goal priority must be between 1 and 79', ['priority']);
        }
    }

    const urgency = input.urgency !== undefined ? Math.max(1, Math.min(100, Math.round(input.urgency))) : 50;
    const progress = input.progress !== undefined ? Math.max(0, Math.min(100, Math.round(input.progress))) : 0;

    // Validate client_goal_key uniqueness
    const clientGoalKey = input.client_goal_key !== undefined && input.client_goal_key !== null
        ? String(input.client_goal_key).trim()
        : null;

    if (clientGoalKey !== null && clientGoalKey.length > 0) {
        const existingKey = db.prepare(`
            SELECT id FROM lws_character_goals
            WHERE simulation_character_id = ? AND client_goal_key = ?
        `).get(character.id, clientGoalKey);
        if (existingKey) {
            throw new LwsConflictError(`client_goal_key '${clientGoalKey}' already exists for this character`, 'GOAL_KEY_CONFLICT', ['client_goal_key']);
        }
    }

    // Resolve target IDs (cardinality: exactly 0 or 1)
    let targetLocInternalId = null;
    let targetCharInternalId = null;
    let targetObjectId = null;

    let targetCount = 0;
    if (input.target_location_id) {
        targetCount++;
        const loc = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(input.target_location_id, sim.world_id);
        if (!loc) {
            throw new LwsValidationError('Target location does not exist in this world', ['target_location_id']);
        }
        targetLocInternalId = loc.id;
    }

    if (input.target_character_id) {
        targetCount++;
        const targetChar = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND simulation_id = ?').get(input.target_character_id, sim.id);
        if (!targetChar) {
            throw new LwsValidationError('Target character does not exist in this simulation', ['target_character_id']);
        }
        targetCharInternalId = targetChar.id;
    }

    if (input.target_object_id) {
        targetCount++;
        targetObjectId = String(input.target_object_id);
    }

    if (targetCount > 1) {
        throw new LwsValidationError('A goal cannot have multiple targets; select at most one target entity', ['target']);
    }

    let causalEventInternalId = null;
    let causalEventLwsId = null;
    if (input.causal_event_id) {
        const ev = db.prepare('SELECT id, lws_id FROM lws_events WHERE lws_id = ? AND simulation_id = ?').get(input.causal_event_id, sim.id);
        if (!ev) {
            throw new LwsValidationError('Causal event does not exist in this simulation', ['causal_event_id']);
        }
        causalEventInternalId = ev.id;
        causalEventLwsId = ev.lws_id;
    }

    // Deterministic UUID derivation (§10.1)
    let goalLwsId = null;
    if (clientGoalKey !== null && clientGoalKey.length > 0) {
        goalLwsId = generateDeterministicUuid('goal', sim.lws_id, character.lws_id, clientGoalKey);
    } else {
        const goalIndex = allocateGoalIndex(db, character.id);
        goalLwsId = generateDeterministicUuid('goal', sim.lws_id, character.lws_id, causalEventLwsId || 'authored', String(goalIndex));
    }

    internalCommitEvent(db, sim, {
        event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
        actor_character_id: character.lws_id,
        fictional_time: sim.current_fictional_time,
        provenance: options.provenance || 'user',
        payload: {
            cognition: {
                create_goal: {
                    lws_id: goalLwsId,
                    client_goal_key: clientGoalKey,
                    title: input.title.trim(),
                    description: input.description || '',
                    goal_type: goalType,
                    priority,
                    urgency,
                    progress,
                    objective_action_type: input.objective_action_type || null,
                    target_location_id: input.target_location_id || null,
                    target_character_id: input.target_character_id || null,
                    target_object_id: targetObjectId,
                    deadline_fictional_time: input.deadline_fictional_time || null,
                    causal_event_id: causalEventLwsId,
                }
            }
        }
    }, { isDedicatedRoute: true, isAdmin: true });

    return getGoalByLwsId(db, goalLwsId);
}

export const createCharacterGoal = createGoal;

/**
 * Retrieves a single goal by its UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} goalLwsId
 * @returns {object | null}
 */
export function getGoalByLwsId(db, goalLwsId) {
    const row = db.prepare(`
        SELECT g.*,
               sim.lws_id AS simulation_lws_id,
               sc.lws_id AS character_lws_id,
               loc.lws_id AS target_location_lws_id,
               sc_target.lws_id AS target_character_lws_id,
               ev.lws_id AS causal_event_lws_id
        FROM lws_character_goals g
        JOIN lws_simulations sim ON g.simulation_id = sim.id
        JOIN lws_simulation_characters sc ON g.simulation_character_id = sc.id
        LEFT JOIN lws_locations loc ON g.target_location_id = loc.id
        LEFT JOIN lws_simulation_characters sc_target ON g.target_character_id = sc_target.id
        LEFT JOIN lws_events ev ON g.causal_event_id = ev.id
        WHERE g.lws_id = ?
    `).get(goalLwsId);

    return formatGoal(row);
}

export function getCharacterGoalByLwsId(db, simId, simCharId, goalLwsId) {
    return getGoalByLwsId(db, goalLwsId);
}

/**
 * Lists all goals for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} charIdOrLwsId
 * @param {object} [options] { include_deleted: boolean, status: string, goal_type: string }
 * @returns {object[]}
 */
export function listCharacterGoals(db, charIdOrLwsId, options = {}) {
    let simCharId = charIdOrLwsId;
    if (typeof charIdOrLwsId === 'string') {
        const c = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(charIdOrLwsId);
        if (!c) return [];
        simCharId = c.id;
    }

    let sql = `
        SELECT g.*,
               sim.lws_id AS simulation_lws_id,
               sc.lws_id AS character_lws_id,
               loc.lws_id AS target_location_lws_id,
               sc_target.lws_id AS target_character_lws_id,
               ev.lws_id AS causal_event_lws_id
        FROM lws_character_goals g
        JOIN lws_simulations sim ON g.simulation_id = sim.id
        JOIN lws_simulation_characters sc ON g.simulation_character_id = sc.id
        LEFT JOIN lws_locations loc ON g.target_location_id = loc.id
        LEFT JOIN lws_simulation_characters sc_target ON g.target_character_id = sc_target.id
        LEFT JOIN lws_events ev ON g.causal_event_id = ev.id
        WHERE g.simulation_character_id = ?
    `;

    const params = [simCharId];

    if (!options.include_deleted) {
        sql += ' AND g.deleted_at IS NULL';
    }

    if (options.status) {
        sql += ' AND g.status = ?';
        params.push(options.status);
    }

    if (options.goal_type) {
        sql += ' AND g.goal_type = ?';
        params.push(options.goal_type);
    }

    sql += ' ORDER BY g.priority DESC, g.urgency DESC, g.id ASC';

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatGoal);
}

export const getCharacterGoals = listCharacterGoals;

/**
 * Returns active acute goals for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} charIdOrLwsId
 * @returns {object[]}
 */
export function getActiveAcuteGoals(db, charIdOrLwsId) {
    return listCharacterGoals(db, charIdOrLwsId, {
        status: 'active',
        goal_type: 'acute_need',
        include_deleted: false,
    });
}

/**
 * Updates an existing goal (PATCH).
 * Enforces immutability, legal state transitions, and acute goal restrictions.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} goalLwsId
 * @param {object} patch
 * @param {object} [options]
 * @returns {object} Updated formatted goal
 */
export function updateGoal(db, goalLwsId, patch = {}, options = {}) {
    const existing = db.prepare(`
        SELECT * FROM lws_character_goals
        WHERE lws_id = ?
    `).get(goalLwsId);

    if (!existing) {
        throw new LwsNotFoundError(`Goal with lws_id '${goalLwsId}' not found`, 'GOAL_NOT_FOUND', ['goalLwsId']);
    }

    // Check immutable fields
    for (const field of IMMUTABLE_GOAL_FIELDS) {
        if (patch[field] !== undefined) {
            const currentVal = existing[field];
            const newVal = patch[field];
            if (currentVal !== newVal) {
                throw new LwsInvalidStateTransitionError(`Field '${field}' is immutable on goals`, 'IMMUTABLE_FIELD', [field]);
            }
        }
    }

    // Terminal goal immutability (§9.6)
    if (existing.status === 'completed' || existing.status === 'abandoned') {
        throw new LwsInvalidStateTransitionError(
            `Goal is in terminal state '${existing.status}' and cannot be modified`,
            'INVALID_STATE_TRANSITION',
            ['status'],
        );
    }

    // Acute goal restrictions (§9.6, §14.1)
    if (existing.goal_type === 'acute_need') {
        if (patch.status !== undefined && patch.status !== existing.status) {
            throw new LwsInvalidStateTransitionError('acute_need status cannot be manually patched; it is engine-managed', 'ACUTE_GOAL_IMMUTABLE', ['status']);
        }
        if (patch.priority !== undefined && patch.priority !== existing.priority) {
            throw new LwsInvalidStateTransitionError('acute_need priority cannot be manually patched; it is engine-managed', 'ACUTE_GOAL_IMMUTABLE', ['priority']);
        }
    }

    let newStatus = existing.status;
    if (patch.status !== undefined) {
        if (!GOAL_STATUSES.includes(patch.status)) {
            throw new LwsValidationError(`Invalid goal status: ${patch.status}`, ['status']);
        }

        // Validate state transitions (§9.6):
        // active -> suspended | completed | abandoned
        // suspended -> active | abandoned
        if (existing.status === 'active') {
            if (!['suspended', 'completed', 'abandoned', 'active'].includes(patch.status)) {
                throw new LwsInvalidStateTransitionError(`Cannot transition goal from 'active' to '${patch.status}'`, 'INVALID_STATE_TRANSITION', ['status']);
            }
        } else if (existing.status === 'suspended') {
            if (!['active', 'abandoned', 'suspended'].includes(patch.status)) {
                throw new LwsInvalidStateTransitionError(`Cannot transition goal from 'suspended' to '${patch.status}'`, 'INVALID_STATE_TRANSITION', ['status']);
            }
        }
        newStatus = patch.status;
    }

    let newPriority = existing.priority;
    if (patch.priority !== undefined) {
        const p = Math.round(patch.priority);
        if (existing.goal_type === 'acute_need') {
            if (p < 80 || p > 100) throw new LwsValidationError('acute_need priority must be in [80, 100]', ['priority']);
        } else {
            if (p < 1 || p > 79) throw new LwsValidationError('goal priority must be in [1, 79]', ['priority']);
        }
        newPriority = p;
    }

    const sim = db.prepare('SELECT * FROM lws_simulations WHERE id = ?').get(existing.simulation_id);
    const char = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = ?').get(existing.simulation_character_id);

    internalCommitEvent(db, sim, {
        event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
        actor_character_id: char.lws_id,
        fictional_time: sim.current_fictional_time,
        provenance: options.provenance || 'user',
        payload: {
            cognition: {
                update_goal: {
                    goal_lws_id: goalLwsId,
                    lws_id: goalLwsId,
                    title: patch.title !== undefined ? String(patch.title).trim() : undefined,
                    description: patch.description !== undefined ? String(patch.description) : undefined,
                    status: patch.status !== undefined ? newStatus : undefined,
                    priority: patch.priority !== undefined ? newPriority : undefined,
                    urgency: patch.urgency !== undefined ? Math.max(1, Math.min(100, Math.round(patch.urgency))) : undefined,
                    progress: patch.progress !== undefined ? Math.max(0, Math.min(100, Math.round(patch.progress))) : undefined,
                    deadline_fictional_time: patch.deadline_fictional_time !== undefined ? patch.deadline_fictional_time : undefined,
                    deleted_at: patch.deleted_at ?? (patch.is_deleted === true ? true : undefined),
                    is_deleted: patch.is_deleted,
                }
            }
        }
    }, { isDedicatedRoute: true, isAdmin: true });

    return getGoalByLwsId(db, goalLwsId);
}

export function updateCharacterGoal(db, sim, character, goalLwsId, patch, options) {
    return updateGoal(db, goalLwsId, patch, options);
}

/**
 * Soft-deletes a goal.
 * Sets deleted_at, marks status = 'abandoned' (if not completed), and cancels child intentions.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} goalLwsId
 * @param {object} [options]
 * @returns {object} Formatted goal
 */
export function deleteGoal(db, goalLwsId, options = {}) {
    return updateGoal(db, goalLwsId, { is_deleted: true }, options);
}

export function softDeleteCharacterGoal(db, sim, character, goalLwsId, options) {
    return deleteGoal(db, goalLwsId, options);
}
