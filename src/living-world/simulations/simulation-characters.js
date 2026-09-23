import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError, LwsConflictError } from '../errors.js';
import {
    generateUuid,
    isValidUuid,
    isoNow,
    validateTextField,
    validateExtensions,
    safeJsonParse,
    ensureActiveSimulation,
} from './common.js';

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

    if (!input.character_id) {
        throw new LwsValidationError('character_id is required', ['character_id']);
    }

    if (!isValidUuid(input.character_id)) {
        throw new LwsValidationError('Invalid character UUID format', ['character_id']);
    }

    const char = db.prepare(`
        SELECT * FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(input.character_id, sim.world_id);

    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    let locationInternalId = null;
    const locInput = input.initial_location_id ?? input.current_location_id;
    if (locInput !== undefined && locInput !== null) {
        if (!isValidUuid(locInput)) {
            throw new LwsValidationError('Invalid location UUID format', ['initial_location_id']);
        }

        const loc = db.prepare(`
            SELECT * FROM lws_locations
            WHERE lws_id = ? AND world_id = ?
        `).get(locInput, sim.world_id);

        if (!loc) {
            throw new LwsNotFoundError('Location not found');
        }

        if (loc.deleted_at !== null) {
            throw new LwsValidationError('Cannot newly assign a soft-deleted location', ['initial_location_id']);
        }

        locationInternalId = loc.id;
    }

    const activity = validateTextField(input.activity || 'idle', 'activity');
    const physicalCondition = validateTextField(input.physical_condition || 'normal', 'physical_condition');
    const runtimeState = validateExtensions(input.runtime_state, 'runtime_state');

    const charSnapshot = {
        name: char.name,
        description: char.description,
        personality: char.personality,
        scenario_context: char.scenario_context,
        mes_example: char.mes_example,
        author_notes: char.author_notes,
        system_prompt_override: char.system_prompt_override,
        source_version: char.source_version,
        tags: safeJsonParse(char.tags, []),
        extensions: safeJsonParse(char.extensions, {}),
    };

    const simCharLwsId = generateUuid();
    const now = isoNow();

    try {
        const stmt = db.prepare(`
            INSERT INTO lws_simulation_characters (
                lws_id, simulation_id, character_id, current_location_id,
                activity, physical_condition, runtime_state, authored_snapshot,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            simCharLwsId,
            sim.id,
            char.id,
            locationInternalId,
            activity,
            physicalCondition,
            JSON.stringify(runtimeState),
            JSON.stringify(charSnapshot),
            now,
            now,
        );
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            throw new LwsConflictError('Character already exists in this simulation');
        }
        if (err.message && err.message.includes('RAISE(ABORT')) {
            throw new LwsValidationError(err.message.replace(/^.*?RAISE\(ABORT,\s*'(.*?)'\).*$/, '$1'));
        }
        throw err;
    }

    return getSimulationCharacterByLwsId(simLwsId, simCharLwsId);
}

/**
 * Retrieves a SimulationCharacter by UUID within an active Simulation.
 * @param {string} simLwsId
 * @param {string} simCharLwsId
 * @returns {object}
 */
export function getSimulationCharacterByLwsId(simLwsId, simCharLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    if (!isValidUuid(simCharLwsId)) {
        throw new LwsValidationError('Invalid simulation character UUID format', ['simCharLwsId']);
    }

    const row = db.prepare(`
        SELECT sc.*, s.lws_id AS simulation_lws_id, c.lws_id AS character_lws_id,
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
 * @param {string} simLwsId
 * @returns {object[]}
 */
export function listSimulationCharacters(simLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const rows = db.prepare(`
        SELECT sc.*, s.lws_id AS simulation_lws_id, c.lws_id AS character_lws_id,
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
 * Rejects modifications if the simulation is paused or archived.
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

    const current = db.prepare(`
        SELECT sc.* FROM lws_simulation_characters sc
        WHERE sc.lws_id = ? AND sc.simulation_id = ? AND sc.deleted_at IS NULL
    `).get(simCharLwsId, sim.id);

    if (!current) {
        throw new LwsNotFoundError('SimulationCharacter not found');
    }

    let locationInternalId = current.current_location_id;
    if (patch.current_location_id !== undefined) {
        if (patch.current_location_id === null) {
            locationInternalId = null;
        } else {
            if (!isValidUuid(patch.current_location_id)) {
                throw new LwsValidationError('Invalid location UUID format', ['current_location_id']);
            }

            const loc = db.prepare(`
                SELECT id, deleted_at FROM lws_locations
                WHERE lws_id = ? AND world_id = ?
            `).get(patch.current_location_id, sim.world_id);

            if (!loc) {
                throw new LwsNotFoundError('Location not found');
            }

            // Only check soft-delete if assigning to a NEW location
            if (current.current_location_id !== loc.id && loc.deleted_at !== null) {
                throw new LwsValidationError('Cannot newly assign a soft-deleted location', ['current_location_id']);
            }

            locationInternalId = loc.id;
        }
    }

    const activity = patch.activity !== undefined
        ? validateTextField(patch.activity, 'activity')
        : current.activity;

    const physicalCondition = patch.physical_condition !== undefined
        ? validateTextField(patch.physical_condition, 'physical_condition')
        : current.physical_condition;

    const runtimeState = patch.runtime_state !== undefined
        ? validateExtensions(patch.runtime_state, 'runtime_state')
        : safeJsonParse(current.runtime_state, {});

    const now = isoNow();

    try {
        const stmt = db.prepare(`
            UPDATE lws_simulation_characters
            SET current_location_id = ?, activity = ?, physical_condition = ?,
                runtime_state = ?, updated_at = ?
            WHERE lws_id = ? AND simulation_id = ? AND deleted_at IS NULL
        `);

        stmt.run(
            locationInternalId,
            activity,
            physicalCondition,
            JSON.stringify(runtimeState),
            now,
            simCharLwsId,
            sim.id,
        );
    } catch (err) {
        if (err.message && err.message.includes('RAISE(ABORT')) {
            throw new LwsValidationError(err.message.replace(/^.*?RAISE\(ABORT,\s*'(.*?)'\).*$/, '$1'));
        }
        throw err;
    }

    return getSimulationCharacterByLwsId(simLwsId, simCharLwsId);
}

/**
 * Soft-deletes a SimulationCharacter.
 * @param {string} simLwsId
 * @param {string} simCharLwsId
 * @returns {boolean}
 */
export function deleteSimulationCharacter(simLwsId, simCharLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    if (!isValidUuid(simCharLwsId)) {
        throw new LwsValidationError('Invalid simulation character UUID format', ['simCharLwsId']);
    }

    const current = db.prepare(`
        SELECT id FROM lws_simulation_characters
        WHERE lws_id = ? AND simulation_id = ? AND deleted_at IS NULL
    `).get(simCharLwsId, sim.id);

    if (!current) {
        throw new LwsNotFoundError('SimulationCharacter not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_simulation_characters
        SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, current.id);

    return result.changes > 0;
}
