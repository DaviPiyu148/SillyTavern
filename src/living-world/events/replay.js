import { getDb } from '../db.js';
import { safeJsonParse, ensureActiveSimulation } from '../simulations/common.js';
import { deepMerge, EVENT_TYPES } from './taxonomy.js';
import { listEvents } from './events.js';

/**
 * Pure, deterministic in-memory simulation reducer.
 * Folds a single SimulationEvent into the accumulating state.
 * Performs zero database queries and zero external lookups.
 *
 * @param {object} state
 * @param {object} event
 * @returns {object} Mutated state
 */
export function simulationReducer(state, event) {
    const payload = event.payload ?? {};

    switch (event.event_type) {
        case EVENT_TYPES.SIMULATION_START:
            state.simulation.status = 'active';
            state.simulation.current_fictional_time = event.fictional_time;
            state.simulation.settings = payload.settings ?? {};
            break;

        case EVENT_TYPES.SIMULATION_PAUSE:
            state.simulation.status = 'paused';
            break;

        case EVENT_TYPES.SIMULATION_RESUME:
            state.simulation.status = 'active';
            break;

        case EVENT_TYPES.SIMULATION_STOP:
            state.simulation.status = 'archived';
            if (payload.action === 'delete') {
                state.simulation.deleted_at = event.created_at;
            }
            break;

        case EVENT_TYPES.CHARACTER_JOIN: {
            const charLwsId = event.actor_character_id;
            state.characters[charLwsId] = {
                lws_id: charLwsId,
                character_id: payload.character_id,
                current_location_id: event.location_id ?? null,
                activity: payload.activity ?? 'idle',
                physical_condition: payload.physical_condition ?? 'normal',
                runtime_state: payload.runtime_state ?? {},
                authored_snapshot: payload.authored_snapshot ?? {},
                deleted_at: null,
            };
            break;
        }

        case EVENT_TYPES.MOVE_CHARACTER:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].current_location_id = event.location_id;
            }
            break;

        case EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = payload.activity;
            }
            break;

        case EVENT_TYPES.UPDATE_PHYSICAL_CONDITION:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].physical_condition = payload.physical_condition;
            }
            break;

        case EVENT_TYPES.UPDATE_RUNTIME_STATE:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].runtime_state = deepMerge(
                    state.characters[event.actor_character_id].runtime_state,
                    payload.patch ?? {},
                );
            }
            break;

        case EVENT_TYPES.CHARACTER_LEAVE:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].deleted_at = event.created_at;
            }
            break;

        case EVENT_TYPES.DIRECTOR_MODIFY_STATE:
            if (payload.target === 'simulation') {
                state.simulation.settings = deepMerge(state.simulation.settings, payload.settings_patch ?? {});
            } else if (state.characters[event.actor_character_id]) {
                const char = state.characters[event.actor_character_id];
                if (event.location_id !== null && event.location_id !== undefined) char.current_location_id = event.location_id;
                if (payload.activity !== undefined) char.activity = payload.activity;
                if (payload.physical_condition !== undefined) char.physical_condition = payload.physical_condition;
                if (payload.runtime_state !== undefined) {
                    char.runtime_state = deepMerge(char.runtime_state, payload.runtime_state);
                }
            }
            break;

        case EVENT_TYPES.REST:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'resting';
            }
            break;

        case EVENT_TYPES.WORK:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'working';
            }
            break;

        // Event-only facts do not mutate canonical character coordinates
        default:
            break;
    }

    return state;
}

/**
 * Replays an ordered sequence of events from sequence 1 through N in pure memory.
 * Zero database queries are performed.
 *
 * @param {object[]} events
 * @returns {object} Final replayed state
 */
export function replaySimulation(events) {
    const initialState = {
        simulation: {
            status: 'unknown',
            current_fictional_time: null,
            settings: {},
            deleted_at: null,
        },
        characters: {},
    };

    return events.reduce(simulationReducer, initialState);
}

/**
 * Verifies 100% canonical replay parity between pure in-memory event folding
 * and the projected SQLite database rows.
 *
 * @param {string} simLwsId
 * @returns {{ verified: boolean, event_count: number, character_count: number, drift_detected: boolean }}
 */
export function verifySimulationParity(simLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    // 1. Fetch events from database
    const events = listEvents(simLwsId, { limit: 100000 });

    // 2. Pure in-memory replay
    const replayed = replaySimulation(events);

    // 3. Compare Simulation canonical fields
    const dbSim = db.prepare('SELECT * FROM lws_simulations WHERE id = ?').get(sim.id);
    const dbSimSettings = safeJsonParse(dbSim.settings, {});

    if (replayed.simulation.status !== dbSim.status) {
        throw new Error(`Simulation status drift: replayed=${replayed.simulation.status}, db=${dbSim.status}`);
    }
    if (replayed.simulation.current_fictional_time !== dbSim.current_fictional_time) {
        throw new Error(`Simulation clock drift: replayed=${replayed.simulation.current_fictional_time}, db=${dbSim.current_fictional_time}`);
    }
    if (JSON.stringify(replayed.simulation.settings) !== JSON.stringify(dbSimSettings)) {
        throw new Error(`Simulation settings drift: replayed=${JSON.stringify(replayed.simulation.settings)}, db=${JSON.stringify(dbSimSettings)}`);
    }
    if (replayed.simulation.deleted_at !== dbSim.deleted_at) {
        throw new Error(`Simulation deleted_at drift: replayed=${replayed.simulation.deleted_at}, db=${dbSim.deleted_at}`);
    }

    // 4. Compare SimulationCharacter canonical fields
    const dbChars = db.prepare(`
        SELECT sc.*, loc.lws_id AS location_lws_id, c.lws_id AS char_lws_id
        FROM lws_simulation_characters sc
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        LEFT JOIN lws_characters c ON sc.character_id = c.id
        WHERE sc.simulation_id = ?
    `).all(sim.id);

    const charCount = Object.keys(replayed.characters).length;
    if (charCount !== dbChars.length) {
        throw new Error(`Character count drift: replayed=${charCount}, db=${dbChars.length}`);
    }

    for (const dbChar of dbChars) {
        const repChar = replayed.characters[dbChar.lws_id];
        if (!repChar) {
            throw new Error(`Character ${dbChar.lws_id} missing in replayed state`);
        }

        if (repChar.character_id !== dbChar.char_lws_id) {
            throw new Error(`Character ${dbChar.lws_id} authored character_id drift`);
        }
        if (repChar.current_location_id !== dbChar.location_lws_id) {
            throw new Error(`Character ${dbChar.lws_id} location drift: replayed=${repChar.current_location_id}, db=${dbChar.location_lws_id}`);
        }
        if (repChar.activity !== dbChar.activity) {
            throw new Error(`Character ${dbChar.lws_id} activity drift: replayed=${repChar.activity}, db=${dbChar.activity}`);
        }
        if (repChar.physical_condition !== dbChar.physical_condition) {
            throw new Error(`Character ${dbChar.lws_id} condition drift: replayed=${repChar.physical_condition}, db=${dbChar.physical_condition}`);
        }

        const dbRuntimeState = safeJsonParse(dbChar.runtime_state, {});
        if (JSON.stringify(repChar.runtime_state) !== JSON.stringify(dbRuntimeState)) {
            throw new Error(`Character ${dbChar.lws_id} runtime_state drift`);
        }

        const dbAuthoredSnapshot = safeJsonParse(dbChar.authored_snapshot, {});
        if (JSON.stringify(repChar.authored_snapshot) !== JSON.stringify(dbAuthoredSnapshot)) {
            throw new Error(`Character ${dbChar.lws_id} authored_snapshot drift`);
        }

        if (repChar.deleted_at !== dbChar.deleted_at) {
            throw new Error(`Character ${dbChar.lws_id} deleted_at drift: replayed=${repChar.deleted_at}, db=${dbChar.deleted_at}`);
        }
    }

    return {
        verified: true,
        event_count: events.length,
        character_count: charCount,
        drift_detected: false,
    };
}
