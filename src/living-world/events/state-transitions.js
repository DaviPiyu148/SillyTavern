import { EVENT_TYPES, deepMerge } from './taxonomy.js';
import { safeJsonParse } from '../simulations/common.js';
import { generateUuid } from '../authored/common.js';

/**
 * Table-driven state transition handlers for all 13 stateful Phase 4 events.
 * Executes within the SQLite transaction alongside the event insertion.
 *
 * @type {Record<string, (db: import('better-sqlite3').Database, sim: object, evaluated: object, eventCreatedAt: string) => void>}
 */
export const STATE_TRANSITIONS = {
    [EVENT_TYPES.SIMULATION_START]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulations
            SET status = 'active', updated_at = ?
            WHERE id = ?
        `).run(eventCreatedAt, sim.id);
    },

    [EVENT_TYPES.SIMULATION_PAUSE]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulations
            SET status = 'paused', updated_at = ?
            WHERE id = ?
        `).run(eventCreatedAt, sim.id);
    },

    [EVENT_TYPES.SIMULATION_RESUME]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulations
            SET status = 'active', updated_at = ?
            WHERE id = ?
        `).run(eventCreatedAt, sim.id);
    },

    [EVENT_TYPES.SIMULATION_STOP]: (db, sim, evaluated, eventCreatedAt) => {
        if (evaluated.payload?.action === 'delete') {
            db.prepare(`
                UPDATE lws_simulations
                SET status = 'archived', deleted_at = ?, updated_at = ?
                WHERE id = ?
            `).run(eventCreatedAt, eventCreatedAt, sim.id);
        } else {
            db.prepare(`
                UPDATE lws_simulations
                SET status = 'archived', updated_at = ?
                WHERE id = ?
            `).run(eventCreatedAt, sim.id);
        }
    },

    [EVENT_TYPES.MOVE_CHARACTER]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET current_location_id = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(evaluated.location_internal_id, eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET activity = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(evaluated.payload.activity, eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.UPDATE_PHYSICAL_CONDITION]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET physical_condition = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(evaluated.payload.physical_condition, eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.UPDATE_RUNTIME_STATE]: (db, sim, evaluated, eventCreatedAt) => {
        const row = db.prepare(`
            SELECT runtime_state FROM lws_simulation_characters
            WHERE id = ? AND simulation_id = ?
        `).get(evaluated.actor_internal_id, sim.id);

        const currentJson = safeJsonParse(row?.runtime_state, {});
        const mergedJson = deepMerge(currentJson, evaluated.payload.patch ?? {});

        db.prepare(`
            UPDATE lws_simulation_characters
            SET runtime_state = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(JSON.stringify(mergedJson), eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.CHARACTER_JOIN]: () => {
        // CHARACTER_JOIN row creation is executed during the join pipeline immediately prior to event commit.
    },

    [EVENT_TYPES.CHARACTER_LEAVE]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET deleted_at = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(eventCreatedAt, eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.DIRECTOR_MODIFY_STATE]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        if (p.target === 'simulation') {
            const row = db.prepare('SELECT settings FROM lws_simulations WHERE id = ?').get(sim.id);
            const currentSettings = safeJsonParse(row?.settings, {});
            const mergedSettings = deepMerge(currentSettings, p.settings_patch ?? {});

            db.prepare(`
                UPDATE lws_simulations
                SET settings = ?, updated_at = ?
                WHERE id = ?
            `).run(JSON.stringify(mergedSettings), eventCreatedAt, sim.id);
        } else if (evaluated.actor_internal_id) {
            const row = db.prepare(`
                SELECT current_location_id, activity, physical_condition, runtime_state
                FROM lws_simulation_characters
                WHERE id = ? AND simulation_id = ?
            `).get(evaluated.actor_internal_id, sim.id);

            const nextLocation = evaluated.has_explicit_location
                ? evaluated.location_internal_id
                : row.current_location_id;
            const nextActivity = p.activity !== undefined ? p.activity : row.activity;
            const nextCondition = p.physical_condition !== undefined ? p.physical_condition : row.physical_condition;
            const currentRuntimeState = safeJsonParse(row.runtime_state, {});
            const nextRuntimeState = p.runtime_state !== undefined
                ? deepMerge(currentRuntimeState, p.runtime_state)
                : currentRuntimeState;

            db.prepare(`
                UPDATE lws_simulation_characters
                SET current_location_id = ?, activity = ?, physical_condition = ?,
                    runtime_state = ?, updated_at = ?
                WHERE id = ? AND simulation_id = ?
            `).run(
                nextLocation, nextActivity, nextCondition,
                JSON.stringify(nextRuntimeState), eventCreatedAt,
                evaluated.actor_internal_id, sim.id,
            );
        }
    },

    [EVENT_TYPES.REST]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET activity = 'resting', updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.WORK]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulation_characters
            SET activity = 'working', updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(eventCreatedAt, evaluated.actor_internal_id, sim.id);
    },

    [EVENT_TYPES.TIME_ADVANCE]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulations
            SET current_fictional_time = ?, updated_at = ?
            WHERE id = ?
        `).run(evaluated.fictional_time, eventCreatedAt, sim.id);
    },

    [EVENT_TYPES.SCHEDULE_WORLD_EVENT]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload;
        let locId = null;
        if (p.target_location_id) {
            const loc = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(p.target_location_id, sim.world_id);
            if (loc) locId = loc.id;
        }
        db.prepare(`
            INSERT INTO lws_scheduled_events (
                lws_id, simulation_id, scheduled_fictional_time, title, description,
                target_location_id, payload, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(
            p.scheduled_event_id,
            sim.id,
            p.scheduled_fictional_time,
            p.title,
            p.description || '',
            locId,
            JSON.stringify(p.payload || {}),
            eventCreatedAt,
            eventCreatedAt,
        );
    },

    [EVENT_TYPES.CANCEL_SCHEDULED_EVENT]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload;
        db.prepare(`
            UPDATE lws_scheduled_events
            SET status = 'cancelled', cancel_event_id = ?, updated_at = ?
            WHERE lws_id = ? AND simulation_id = ?
        `).run(evaluated.event_internal_id, eventCreatedAt, p.scheduled_event_id, sim.id);
    },

    [EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload;
        const predRow = db.prepare('SELECT id FROM lws_scheduled_events WHERE lws_id = ? AND simulation_id = ?').get(p.predecessor_id, sim.id);
        let locId = null;
        if (p.target_location_id) {
            const loc = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(p.target_location_id, sim.world_id);
            if (loc) locId = loc.id;
        }

        const succInsert = db.prepare(`
            INSERT INTO lws_scheduled_events (
                lws_id, simulation_id, scheduled_fictional_time, title, description,
                target_location_id, payload, status, supersedes_event_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
            p.successor_id,
            sim.id,
            p.scheduled_fictional_time,
            p.title,
            p.description || '',
            locId,
            JSON.stringify(p.payload || {}),
            predRow.id,
            eventCreatedAt,
            eventCreatedAt,
        );
        const succId = succInsert.lastInsertRowid;

        db.prepare(`
            UPDATE lws_scheduled_events
            SET status = 'superseded', superseded_by_event_id = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(succId, eventCreatedAt, predRow.id, sim.id);
    },

    [EVENT_TYPES.TRIGGER_SCHEDULED_EVENT]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload;
        db.prepare(`
            UPDATE lws_scheduled_events
            SET status = 'triggered', trigger_event_id = ?, updated_at = ?
            WHERE lws_id = ? AND simulation_id = ?
        `).run(evaluated.event_internal_id, eventCreatedAt, p.scheduled_event_id, sim.id);
    },

    [EVENT_TYPES.UPDATE_CHARACTER_ROUTINE]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload;
        const simCharId = evaluated.actor_internal_id;
        const newRoutines = p.routines || [];

        const activeKeys = new Set(newRoutines.map(r => `${r.block_id}:${r.day_of_week}`));

        const existingRows = db.prepare(`
            SELECT id, lws_id, block_id, day_of_week, deleted_at
            FROM lws_simulation_character_routines
            WHERE simulation_character_id = ?
        `).all(simCharId);

        for (const row of existingRows) {
            const key = `${row.block_id}:${row.day_of_week}`;
            if (!activeKeys.has(key)) {
                if (row.deleted_at === null) {
                    db.prepare(`
                        UPDATE lws_simulation_character_routines
                        SET deleted_at = ?, updated_at = ?
                        WHERE id = ?
                    `).run(eventCreatedAt, eventCreatedAt, row.id);
                }
            }
        }

        for (const r of newRoutines) {
            let locId = null;
            if (r.target_location_id) {
                const loc = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(r.target_location_id, sim.world_id);
                if (loc) locId = loc.id;
            }

            const existing = existingRows.find(row => row.block_id === r.block_id && row.day_of_week === r.day_of_week);
            if (existing) {
                db.prepare(`
                    UPDATE lws_simulation_character_routines
                    SET start_time = ?, end_time = ?, activity = ?, target_location_id = ?,
                        priority = ?, flexibility = ?, enabled = ?, deleted_at = NULL, updated_at = ?
                    WHERE id = ?
                `).run(
                    r.start_time,
                    r.end_time,
                    r.activity,
                    locId,
                    r.priority ?? 50,
                    r.flexibility ?? 'flexible',
                    r.enabled ?? 1,
                    eventCreatedAt,
                    existing.id,
                );
            } else {
                db.prepare(`
                    INSERT INTO lws_simulation_character_routines (
                        lws_id, simulation_id, simulation_character_id, block_id, day_of_week,
                        start_time, end_time, activity, target_location_id, priority,
                        flexibility, enabled, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    r.lws_id || generateUuid(),
                    sim.id,
                    simCharId,
                    r.block_id,
                    r.day_of_week,
                    r.start_time,
                    r.end_time,
                    r.activity,
                    locId,
                    r.priority ?? 50,
                    r.flexibility ?? 'flexible',
                    r.enabled ?? 1,
                    eventCreatedAt,
                    eventCreatedAt,
                );
            }
        }
    },
};

/**
 * Applies the state transition for an evaluated event if it is stateful.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} sim
 * @param {object} evaluated
 * @param {string} eventCreatedAt
 */
export function applyStateTransition(db, sim, evaluated, eventCreatedAt) {
    const handler = STATE_TRANSITIONS[evaluated.event_type];
    if (handler) {
        handler(db, sim, evaluated, eventCreatedAt);
    }
}
