import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    isValidUuid,
    safeJsonParse,
    ensureActiveSimulation,
} from './common.js';
import { EVENT_TYPES } from '../events/taxonomy.js';
import { commitEvent } from '../events/events.js';

/**
 * Formats a database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatSimulationCharacter(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id,
        character_id: row.character_lws_id,
        current_location_id: row.location_lws_id || null,
        activity: row.activity,
        physical_condition: row.physical_condition,
        runtime_state: safeJsonParse(row.runtime_state, {}),
        authored_snapshot: safeJsonParse(row.authored_snapshot, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Adds an authored Character to an active Simulation as a SimulationCharacter.
 * Delegates to the Phase 4 event authority engine via CHARACTER_JOIN.
 *
 * @param {string} simLwsId
 * @param {object} input
 * @returns {object} The created SimulationCharacter
 */
export function addSimulationCharacter(simLwsId, input = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    if (sim.status === 'archived') {
        throw new LwsValidationError('Cannot add character to archived simulation', ['status']);
    }

    if (input.character_id === undefined || input.character_id === null) {
        throw new LwsValidationError('character_id is required', ['character_id']);
    }
    if (!isValidUuid(input.character_id)) {
        throw new LwsValidationError('Invalid character UUID format', ['character_id']);
    }

    const locLwsId = input.initial_location_id ?? input.current_location_id ?? null;
    if (locLwsId !== null && locLwsId !== undefined) {
        if (!isValidUuid(locLwsId)) {
            throw new LwsValidationError('Invalid location UUID format', ['initial_location_id']);
        }
        const loc = db.prepare('SELECT id, deleted_at FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(locLwsId, sim.world_id);
        if (!loc || loc.deleted_at !== null) {
            throw new LwsValidationError('Cannot newly assign a soft-deleted location', ['initial_location_id']);
        }
    }

    const event = commitEvent(simLwsId, {
        event_type: EVENT_TYPES.CHARACTER_JOIN,
        location_id: locLwsId,
        payload: {
            character_id: input.character_id,
            activity: input.activity,
            physical_condition: input.physical_condition,
            runtime_state: input.runtime_state,
        },
        provenance: 'user',
    });

    return getSimulationCharacterByLwsId(simLwsId, event.actor_character_id);
}

/**
 * Retrieves a single active SimulationCharacter by UUID.
 *
 * @param {string} simLwsId
 * @param {string} simCharLwsId
 * @returns {object}
 */
export function getSimulationCharacterByLwsId(simLwsId, simCharLwsId) {
    if (!isValidUuid(simCharLwsId)) {
        throw new LwsValidationError('Invalid simulation character UUID format', ['simCharLwsId']);
    }

    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const row = db.prepare(`
        SELECT sc.*,
               s.lws_id AS simulation_lws_id,
               c.lws_id AS character_lws_id,
               loc.lws_id AS location_lws_id
        FROM lws_simulation_characters sc
        JOIN lws_simulations s ON sc.simulation_id = s.id
        JOIN lws_characters c ON sc.character_id = c.id
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        WHERE sc.lws_id = ? AND sc.simulation_id = ? AND sc.deleted_at IS NULL
    `).get(simCharLwsId, sim.id);

    if (!row) {
        throw new LwsNotFoundError('SimulationCharacter not found');
    }

    return formatSimulationCharacter(row);
}

/**
 * Lists all active SimulationCharacters in a Simulation.
 *
 * @param {string} simLwsId
 * @returns {object[]}
 */
export function listSimulationCharacters(simLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const rows = db.prepare(`
        SELECT sc.*,
               s.lws_id AS simulation_lws_id,
               c.lws_id AS character_lws_id,
               loc.lws_id AS location_lws_id
        FROM lws_simulation_characters sc
        JOIN lws_simulations s ON sc.simulation_id = s.id
        JOIN lws_characters c ON sc.character_id = c.id
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
        ORDER BY sc.created_at ASC
    `).all(sim.id);

    return rows.map(formatSimulationCharacter);
}

/**
 * Updates a SimulationCharacter's runtime state.
 * Delegates mutations to the Phase 4 event authority engine.
 *
 * @param {string} simLwsId
 * @param {string} simCharLwsId
 * @param {object} patch
 * @returns {object}
 */
export function updateSimulationCharacter(simLwsId, simCharLwsId, patch = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    if (sim.status === 'paused') {
        throw new LwsValidationError('Simulation is paused', ['status']);
    }
    if (sim.status === 'archived') {
        throw new LwsValidationError('Simulation is archived', ['status']);
    }

    if (!isValidUuid(simCharLwsId)) {
        throw new LwsValidationError('Invalid simulation character UUID format', ['simCharLwsId']);
    }

    if (patch.character_id !== undefined) {
        throw new LwsValidationError('character_id is immutable', ['character_id']);
    }
    if (patch.simulation_id !== undefined) {
        throw new LwsValidationError('simulation_id is immutable', ['simulation_id']);
    }
    if (patch.authored_snapshot !== undefined) {
        throw new LwsValidationError('authored_snapshot is immutable', ['authored_snapshot']);
    }

    // Verify character exists and is active
    getSimulationCharacterByLwsId(simLwsId, simCharLwsId);

    if (patch.current_location_id !== undefined && patch.current_location_id !== null) {
        if (!isValidUuid(patch.current_location_id)) {
            throw new LwsValidationError('Invalid location UUID format', ['current_location_id']);
        }
        const loc = db.prepare('SELECT id, deleted_at FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(patch.current_location_id, sim.world_id);
        if (!loc || loc.deleted_at !== null) {
            throw new LwsValidationError('Cannot newly assign a soft-deleted location', ['current_location_id']);
        }
    }

    const patchedKeys = Object.keys(patch).filter(k => patch[k] !== undefined);

    if (patchedKeys.length === 1 && patch.current_location_id !== undefined) {
        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simCharLwsId,
            location_id: patch.current_location_id,
            provenance: 'user',
        });
    } else if (patchedKeys.length === 1 && patch.activity !== undefined) {
        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
            actor_character_id: simCharLwsId,
            payload: { activity: patch.activity },
            provenance: 'user',
        });
    } else if (patchedKeys.length === 1 && patch.physical_condition !== undefined) {
        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
            actor_character_id: simCharLwsId,
            payload: { physical_condition: patch.physical_condition },
            provenance: 'user',
        });
    } else if (patchedKeys.length === 1 && patch.runtime_state !== undefined) {
        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: simCharLwsId,
            payload: { patch: patch.runtime_state },
            provenance: 'user',
        });
    } else if (patchedKeys.length > 0) {
        // Multi-field update executed atomically via DIRECTOR_MODIFY_STATE
        const proposal = {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simCharLwsId,
            payload: {
                activity: patch.activity,
                physical_condition: patch.physical_condition,
                runtime_state: patch.runtime_state,
            },
            provenance: 'director',
        };
        if (patch.current_location_id !== undefined) {
            proposal.location_id = patch.current_location_id;
        }
        commitEvent(simLwsId, proposal, { isInternalSystem: true });
    }

    return getSimulationCharacterByLwsId(simLwsId, simCharLwsId);
}

/**
 * Soft-deletes a SimulationCharacter from an active simulation via CHARACTER_LEAVE.
 *
 * @param {string} simLwsId
 * @param {string} simCharLwsId
 * @returns {boolean}
 */
export function deleteSimulationCharacter(simLwsId, simCharLwsId) {
    commitEvent(simLwsId, {
        event_type: EVENT_TYPES.CHARACTER_LEAVE,
        actor_character_id: simCharLwsId,
        provenance: 'user',
    });
    return true;
}
