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
import { EVENT_TYPES } from '../events/taxonomy.js';
import { internalCommitEvent, commitEvent } from '../events/events.js';

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
 * Atomically emits system SIMULATION_START event (seq 1),
 * and instantiates scenario roster characters through sequential CHARACTER_JOIN events (seq 2..N).
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

            stmt.run(
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

            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(simLwsId);

            // 1. Emit system SIMULATION_START event (Sequence #1)
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.SIMULATION_START,
                fictional_time: initialFictionalTime,
                provenance: 'system',
                payload: {
                    scenario_id: scenario ? scenario.lws_id : null,
                    initial_fictional_time: initialFictionalTime,
                    settings,
                },
            }, { isInternalSystem: true });

            // 2. Populate simulation characters from scenario roster via sequential CHARACTER_JOIN events (Sequence #2..N)
            if (rosterCharacters.length > 0) {
                let startLocLwsId = null;
                if (scenario?.starting_location_id) {
                    const startLoc = db.prepare('SELECT lws_id FROM lws_locations WHERE id = ?').get(scenario.starting_location_id);
                    startLocLwsId = startLoc?.lws_id ?? null;
                }

                for (const char of rosterCharacters) {
                    internalCommitEvent(db, simRow, {
                        event_type: EVENT_TYPES.CHARACTER_JOIN,
                        fictional_time: initialFictionalTime,
                        provenance: 'system',
                        location_id: startLocLwsId,
                        payload: {
                            character_id: char.lws_id,
                            activity: 'idle',
                            physical_condition: 'normal',
                            runtime_state: { role: char.role || '', condition: 'normal' },
                        },
                    }, { isInternalSystem: true });
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
 *
 * @param {string} simLwsId
 * @returns {object} The Simulation
 */
export function getSimulationByLwsId(simLwsId) {
    if (!isValidUuid(simLwsId)) {
        throw new LwsValidationError('Invalid simulation UUID format', ['simLwsId']);
    }

    const db = getDb();
    const row = db.prepare(`
        SELECT s.*,
               w.lws_id AS world_lws_id,
               sc.lws_id AS scenario_lws_id
        FROM lws_simulations s
        JOIN lws_worlds w ON s.world_id = w.id
        LEFT JOIN lws_scenarios sc ON s.scenario_id = sc.id
        WHERE s.lws_id = ? AND s.deleted_at IS NULL AND w.deleted_at IS NULL
    `).get(simLwsId);

    if (!row) {
        throw new LwsNotFoundError('Simulation not found');
    }

    return formatSimulation(row);
}

/**
 * Lists non-deleted Simulations in a World.
 *
 * @param {string} worldLwsId
 * @param {object} [options]
 * @returns {object[]}
 */
export function listSimulations(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    let query = `
        SELECT s.*,
               w.lws_id AS world_lws_id,
               sc.lws_id AS scenario_lws_id
        FROM lws_simulations s
        JOIN lws_worlds w ON s.world_id = w.id
        LEFT JOIN lws_scenarios sc ON s.scenario_id = sc.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL
    `;
    const params = [world.id];

    if (options.status) {
        query += ' AND s.status = ?';
        params.push(options.status);
    }

    query += ' ORDER BY s.created_at ASC';

    const rows = db.prepare(query).all(...params);
    return rows.map(formatSimulation);
}

/**
 * Updates a Simulation.
 * Delegates lifecycle status transitions and operational settings updates through the event engine.
 * Directly updates display metadata (name) on lws_simulations.
 *
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

    // 1. Status transition via event engine
    if (patch.status !== undefined && patch.status !== current.status) {
        validateStatusTransition(current.status, patch.status);
        let eventType;
        if (patch.status === 'paused') eventType = EVENT_TYPES.SIMULATION_PAUSE;
        else if (patch.status === 'active') eventType = EVENT_TYPES.SIMULATION_RESUME;
        else if (patch.status === 'archived') eventType = EVENT_TYPES.SIMULATION_STOP;

        commitEvent(simLwsId, {
            event_type: eventType,
            provenance: 'user',
        });
    }

    // 2. Settings or extensions patch via event engine
    if (patch.settings !== undefined) {
        const validatedSettings = validateExtensions(patch.settings, 'settings');
        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            payload: {
                target: 'simulation',
                settings_patch: validatedSettings,
            },
            provenance: 'director',
        }, { isInternalSystem: true });
    }

    // 3. Display name update (pure presentation metadata)
    if (patch.name !== undefined) {
        const name = validateName(patch.name, 'name');
        try {
            db.prepare(`
                UPDATE lws_simulations
                SET name = ?, updated_at = ?
                WHERE lws_id = ? AND deleted_at IS NULL
            `).run(name, isoNow(), simLwsId);
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                throw new LwsConflictError(`Simulation with name '${name}' already exists in this world`);
            }
            throw err;
        }
    }

    return getSimulationByLwsId(simLwsId);
}

/**
 * Soft-deletes a Simulation via terminal SIMULATION_STOP event.
 * Operates across active, paused, and archived simulations.
 *
 * @param {string} simLwsId
 * @returns {boolean}
 */
export function deleteSimulation(simLwsId) {
    const db = getDb();
    ensureActiveSimulation(db, simLwsId);

    // Commit terminal SIMULATION_STOP { action: 'delete' }
    commitEvent(simLwsId, {
        event_type: EVENT_TYPES.SIMULATION_STOP,
        payload: { action: 'delete' },
        provenance: 'user',
    }, { isInternalSystem: true });

    return true;
}
