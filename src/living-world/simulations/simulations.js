import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError, LwsConflictError } from '../errors.js';
import {
    generateUuid,
    isValidUuid,
    isoNow,
    validateName,
    validateExtensions,
    safeJsonParse,
    ensureActiveWorld,
    ensureActiveSimulation,
    validateFictionalTimestamp,
    validateStatusTransition,
} from './common.js';

/**
 * Formats a database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatSimulation(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        world_id: row.world_lws_id,
        scenario_id: row.scenario_lws_id || null,
        name: row.name,
        status: row.status,
        current_fictional_time: row.current_fictional_time,
        settings: safeJsonParse(row.settings, {}),
        extensions: safeJsonParse(row.extensions, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Creates and persists a Simulation in a World.
 * If scenario_id is supplied, atomically instantiates active roster characters.
 *
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object} The created Simulation
 */
export function createSimulation(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const name = validateName(input.name, 'name');
    const initialFictionalTime = validateFictionalTimestamp(
        input.initial_fictional_time ?? input.current_fictional_time,
        'initial_fictional_time',
    );
    const settings = validateExtensions(input.settings, 'settings');
    const extensions = validateExtensions(input.extensions, 'extensions');

    let scenario = null;
    let rosterCharacters = [];

    if (input.scenario_id !== undefined && input.scenario_id !== null) {
        if (!isValidUuid(input.scenario_id)) {
            throw new LwsValidationError('Invalid scenario UUID format', ['scenario_id']);
        }

        scenario = db.prepare(`
            SELECT * FROM lws_scenarios
            WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
        `).get(input.scenario_id, world.id);

        if (!scenario) {
            throw new LwsNotFoundError('Scenario not found');
        }

        // Verify starting location is active if specified
        if (scenario.starting_location_id !== null) {
            const loc = db.prepare(`
                SELECT id, deleted_at FROM lws_locations
                WHERE id = ? AND world_id = ?
            `).get(scenario.starting_location_id, world.id);

            if (!loc || loc.deleted_at !== null) {
                throw new LwsValidationError('Scenario starting location is soft-deleted', ['scenario_id']);
            }
        }

        // Fetch active roster characters
        rosterCharacters = db.prepare(`
            SELECT c.*, sc.role
            FROM lws_scenario_characters sc
            JOIN lws_characters c ON sc.character_id = c.id
            WHERE sc.scenario_id = ? AND c.deleted_at IS NULL
            ORDER BY c.name ASC
        `).all(scenario.id);
    }

    const simLwsId = generateUuid();
    const now = isoNow();

    try {
        const createTx = db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO lws_simulations (
                    lws_id, world_id, scenario_id, name, status,
                    current_fictional_time, settings, extensions, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
            `);

            const result = stmt.run(
                simLwsId,
                world.id,
                scenario ? scenario.id : null,
                name,
                initialFictionalTime,
                JSON.stringify(settings),
                JSON.stringify(extensions),
                now,
                now,
            );

            const simInternalId = Number(result.lastInsertRowid);

            // Populate simulation characters from scenario roster
            if (rosterCharacters.length > 0) {
                const insertCharStmt = db.prepare(`
                    INSERT INTO lws_simulation_characters (
                        lws_id, simulation_id, character_id, current_location_id,
                        activity, physical_condition, runtime_state, authored_snapshot,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'idle', 'normal', ?, ?, ?, ?)
                `);

                for (const char of rosterCharacters) {
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

                    const initialRuntimeState = {
                        role: char.role || '',
                        condition: 'normal',
                    };

                    insertCharStmt.run(
                        generateUuid(),
                        simInternalId,
                        char.id,
                        scenario.starting_location_id,
                        JSON.stringify(initialRuntimeState),
                        JSON.stringify(charSnapshot),
                        now,
                        now,
                    );
                }
            }
        });

        createTx();
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            throw new LwsConflictError(`Simulation with name '${name}' already exists in this world`);
        }
        if (err.message && err.message.includes('RAISE(ABORT')) {
            throw new LwsValidationError(err.message.replace(/^.*?RAISE\(ABORT,\s*'(.*?)'\).*$/, '$1'));
        }
        throw err;
    }

    return getSimulationByLwsId(simLwsId);
}

/**
 * Retrieves an active Simulation by UUID.
 * @param {string} simLwsId
 * @returns {object}
 */
export function getSimulationByLwsId(simLwsId) {
    const db = getDb();
    ensureActiveSimulation(db, simLwsId);

    const row = db.prepare(`
        SELECT s.*, w.lws_id AS world_lws_id, sc.lws_id AS scenario_lws_id
        FROM lws_simulations s
        JOIN lws_worlds w ON s.world_id = w.id
        LEFT JOIN lws_scenarios sc ON s.scenario_id = sc.id
        WHERE s.lws_id = ? AND s.deleted_at IS NULL
    `).get(simLwsId);

    if (!row) {
        throw new LwsNotFoundError('Simulation not found');
    }

    return formatSimulation(row);
}

/**
 * Lists active Simulations in a World.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {string} [options.status] Optional status filter ('active', 'paused', 'archived')
 * @returns {object[]}
 */
export function listSimulations(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    let sql = `
        SELECT s.*, w.lws_id AS world_lws_id, sc.lws_id AS scenario_lws_id
        FROM lws_simulations s
        JOIN lws_worlds w ON s.world_id = w.id
        LEFT JOIN lws_scenarios sc ON s.scenario_id = sc.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL
    `;
    const params = [world.id];

    if (options.status) {
        if (!['active', 'paused', 'archived'].includes(options.status)) {
            throw new LwsValidationError(`Invalid status filter '${options.status}'`, ['status']);
        }
        sql += ' AND s.status = ?';
        params.push(options.status);
    }

    sql += ' ORDER BY s.created_at DESC';

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatSimulation);
}

/**
 * Updates an active Simulation.
 * @param {string} simLwsId
 * @param {object} patch
 * @returns {object}
 */
export function updateSimulation(simLwsId, patch = {}) {
    const db = getDb();
    const current = ensureActiveSimulation(db, simLwsId);

    if (patch.world_id !== undefined) {
        throw new LwsValidationError('world_id is immutable', ['world_id']);
    }

    if (patch.scenario_id !== undefined) {
        throw new LwsValidationError('scenario_id is immutable', ['scenario_id']);
    }

    if (patch.current_fictional_time !== undefined) {
        throw new LwsValidationError('current_fictional_time cannot be modified via PATCH', ['current_fictional_time']);
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const status = patch.status !== undefined
        ? validateStatusTransition(current.status, patch.status)
        : current.status;
    const settings = patch.settings !== undefined
        ? validateExtensions(patch.settings, 'settings')
        : safeJsonParse(current.settings, {});
    const extensions = patch.extensions !== undefined
        ? validateExtensions(patch.extensions, 'extensions')
        : safeJsonParse(current.extensions, {});

    const now = isoNow();

    try {
        const stmt = db.prepare(`
            UPDATE lws_simulations
            SET name = ?, status = ?, settings = ?, extensions = ?, updated_at = ?
            WHERE lws_id = ? AND deleted_at IS NULL
        `);

        stmt.run(name, status, JSON.stringify(settings), JSON.stringify(extensions), now, simLwsId);
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            throw new LwsConflictError(`Simulation with name '${name}' already exists in this world`);
        }
        if (err.message && err.message.includes('RAISE(ABORT')) {
            throw new LwsValidationError(err.message.replace(/^.*?RAISE\(ABORT,\s*'(.*?)'\).*$/, '$1'));
        }
        throw err;
    }

    return getSimulationByLwsId(simLwsId);
}

/**
 * Soft-deletes a Simulation.
 * @param {string} simLwsId
 * @returns {boolean}
 */
export function deleteSimulation(simLwsId) {
    const db = getDb();
    const current = ensureActiveSimulation(db, simLwsId);

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_simulations
        SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, current.id);

    return result.changes > 0;
}
