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
                routines: [],
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

        case EVENT_TYPES.TIME_ADVANCE:
            state.simulation.current_fictional_time = event.fictional_time;
            break;

        case EVENT_TYPES.SCHEDULE_WORLD_EVENT:
            state.scheduled_events[payload.scheduled_event_id] = {
                lws_id: payload.scheduled_event_id,
                scheduled_fictional_time: payload.scheduled_fictional_time,
                title: payload.title,
                description: payload.description || '',
                target_location_id: payload.target_location_id || null,
                payload: payload.payload || {},
                status: 'pending',
                supersedes_event_id: payload.supersedes_event_id || null,
                superseded_by_event_id: null,
                trigger_event_id: null,
                cancel_event_id: null,
            };
            break;

        case EVENT_TYPES.CANCEL_SCHEDULED_EVENT:
            if (state.scheduled_events[payload.scheduled_event_id]) {
                state.scheduled_events[payload.scheduled_event_id].status = 'cancelled';
                state.scheduled_events[payload.scheduled_event_id].cancel_event_id = event.lws_id;
            }
            break;

        case EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT:
            if (state.scheduled_events[payload.predecessor_id]) {
                state.scheduled_events[payload.predecessor_id].status = 'superseded';
                state.scheduled_events[payload.predecessor_id].superseded_by_event_id = payload.successor_id;
            }
            state.scheduled_events[payload.successor_id] = {
                lws_id: payload.successor_id,
                scheduled_fictional_time: payload.scheduled_fictional_time,
                title: payload.title,
                description: payload.description || '',
                target_location_id: payload.target_location_id || null,
                payload: payload.payload || {},
                status: 'pending',
                supersedes_event_id: payload.predecessor_id,
                superseded_by_event_id: null,
                trigger_event_id: null,
                cancel_event_id: null,
            };
            break;

        case EVENT_TYPES.TRIGGER_SCHEDULED_EVENT:
            if (state.scheduled_events[payload.scheduled_event_id]) {
                state.scheduled_events[payload.scheduled_event_id].status = 'triggered';
                state.scheduled_events[payload.scheduled_event_id].trigger_event_id = event.lws_id;
            }
            break;

        case EVENT_TYPES.UPDATE_CHARACTER_ROUTINE:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].routines = payload.routines || [];
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
        scheduled_events: {},
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

    // 4. Compare SimulationCharacter canonical fields and routines
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

        // Compare routines
        const dbRoutines = db.prepare(`
            SELECT r.*, loc.lws_id AS target_location_lws_id
            FROM lws_simulation_character_routines r
            LEFT JOIN lws_locations loc ON r.target_location_id = loc.id
            WHERE r.simulation_character_id = ? AND r.deleted_at IS NULL
            ORDER BY r.block_id ASC, r.day_of_week ASC
        `).all(dbChar.id);

        const repRoutines = [...(repChar.routines || [])].sort((a, b) => {
            const cmp = a.block_id.localeCompare(b.block_id);
            return cmp !== 0 ? cmp : a.day_of_week.localeCompare(b.day_of_week);
        });

        if (dbRoutines.length !== repRoutines.length) {
            throw new Error(`Character ${dbChar.lws_id} routine count drift: replayed=${repRoutines.length}, db=${dbRoutines.length}`);
        }

        for (let i = 0; i < dbRoutines.length; i++) {
            const dr = dbRoutines[i];
            const rr = repRoutines[i];
            if (dr.block_id !== rr.block_id || dr.day_of_week !== rr.day_of_week) {
                throw new Error(`Character ${dbChar.lws_id} routine key mismatch: replayed=${rr.block_id}:${rr.day_of_week}, db=${dr.block_id}:${dr.day_of_week}`);
            }
            if (dr.start_time !== rr.start_time || dr.end_time !== rr.end_time || dr.activity !== rr.activity) {
                throw new Error(`Character ${dbChar.lws_id} routine boundary/activity drift for ${dr.block_id}`);
            }
            if ((dr.target_location_lws_id || null) !== (rr.target_location_id || null)) {
                throw new Error(`Character ${dbChar.lws_id} routine location drift for ${dr.block_id}: replayed=${rr.target_location_id}, db=${dr.target_location_lws_id}`);
            }
        }
    }

    // 5. Compare Scheduled Events
    const dbSchedEvents = db.prepare(`
        SELECT se.*,
               loc.lws_id AS target_location_lws_id,
               pred.lws_id AS supersedes_event_lws_id,
               succ.lws_id AS superseded_by_event_lws_id,
               trg_ev.lws_id AS trigger_event_lws_id,
               can_ev.lws_id AS cancel_event_lws_id
        FROM lws_scheduled_events se
        LEFT JOIN lws_locations loc ON se.target_location_id = loc.id
        LEFT JOIN lws_scheduled_events pred ON se.supersedes_event_id = pred.id
        LEFT JOIN lws_scheduled_events succ ON se.superseded_by_event_id = succ.id
        LEFT JOIN lws_events trg_ev ON se.trigger_event_id = trg_ev.id
        LEFT JOIN lws_events can_ev ON se.cancel_event_id = can_ev.id
        WHERE se.simulation_id = ?
    `).all(sim.id);

    const replayedSchedCount = Object.keys(replayed.scheduled_events).length;
    if (replayedSchedCount !== dbSchedEvents.length) {
        throw new Error(`Scheduled event count drift: replayed=${replayedSchedCount}, db=${dbSchedEvents.length}`);
    }

    for (const dse of dbSchedEvents) {
        const rse = replayed.scheduled_events[dse.lws_id];
        if (!rse) {
            throw new Error(`Scheduled event ${dse.lws_id} missing in replayed state`);
        }
        if (rse.status !== dse.status) {
            throw new Error(`Scheduled event ${dse.lws_id} status drift: replayed=${rse.status}, db=${dse.status}`);
        }
        if (rse.scheduled_fictional_time !== dse.scheduled_fictional_time) {
            throw new Error(`Scheduled event ${dse.lws_id} scheduled_fictional_time drift`);
        }
        if (rse.title !== dse.title) {
            throw new Error(`Scheduled event ${dse.lws_id} title drift`);
        }
        if (rse.target_location_id !== (dse.target_location_lws_id || null)) {
            throw new Error(`Scheduled event ${dse.lws_id} location drift`);
        }
        if (rse.supersedes_event_id !== (dse.supersedes_event_lws_id || null)) {
            throw new Error(`Scheduled event ${dse.lws_id} supersedes_event_id drift`);
        }
        if (rse.superseded_by_event_id !== (dse.superseded_by_event_lws_id || null)) {
            throw new Error(`Scheduled event ${dse.lws_id} superseded_by_event_id drift`);
        }
        if (rse.trigger_event_id !== (dse.trigger_event_lws_id || null)) {
            throw new Error(`Scheduled event ${dse.lws_id} trigger_event_id drift`);
        }
        if (rse.cancel_event_id !== (dse.cancel_event_lws_id || null)) {
            throw new Error(`Scheduled event ${dse.lws_id} cancel_event_id drift`);
        }
    }

    return {
        verified: true,
        event_count: events.length,
        character_count: charCount,
        scheduled_event_count: replayedSchedCount,
        drift_detected: false,
    };
}
