import { EVENT_TYPES, deepMerge } from './taxonomy.js';
import { safeJsonParse } from '../simulations/common.js';

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
