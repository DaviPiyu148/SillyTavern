import { EVENT_TYPES, deepMerge } from './taxonomy.js';
import { safeJsonParse } from '../simulations/common.js';
import { generateUuid } from '../authored/common.js';
import { upsertCharacterKnowledge } from '../perception/knowledge.js';
import { createCharacterMemory, patchCharacterMemory } from '../perception/memories.js';
import { upsertCharacterBelief } from '../perception/beliefs.js';
import { setSimulationCamera } from '../perception/camera.js';

/**
 * Table-driven state transition handlers for all stateful events.
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

        const targetCharRow = (p.target_id || p.target_character_id)
            ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(p.target_id || p.target_character_id, p.target_id || p.target_character_id, sim.id)
            : (evaluated.actor_internal_id ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ?').get(evaluated.actor_internal_id) : null);

        if (p.target === 'simulation') {
            const row = db.prepare('SELECT settings FROM lws_simulations WHERE id = ?').get(sim.id);
            const currentSettings = safeJsonParse(row?.settings, {});
            const mergedSettings = deepMerge(currentSettings, p.settings_patch ?? {});

            db.prepare(`
                UPDATE lws_simulations
                SET settings = ?, updated_at = ?
                WHERE id = ?
            `).run(JSON.stringify(mergedSettings), eventCreatedAt, sim.id);
        } else if (p.target === 'camera' || p.camera) {
            const camData = p.camera || p;
            let targetCharId = null;
            if (camData.target_character_id) {
                const char = typeof camData.target_character_id === 'number'
                    ? db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ?').get(camData.target_character_id)
                    : db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(camData.target_character_id);
                if (char) targetCharId = char.id;
            }
            let targetLocId = null;
            if (camData.target_location_id) {
                const loc = typeof camData.target_location_id === 'number'
                    ? db.prepare('SELECT id FROM lws_locations WHERE id = ?').get(camData.target_location_id)
                    : db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(camData.target_location_id);
                if (loc) targetLocId = loc.id;
            }
            setSimulationCamera(db, {
                simulation_id: sim.id,
                sim_lws_id: sim.lws_id,
                camera_name: camData.camera_name || 'default',
                mode: camData.mode || 'god_view',
                target_character_id: targetCharId,
                target_location_id: targetLocId,
                created_at: eventCreatedAt,
                updated_at: eventCreatedAt,
            });
        }

        if (targetCharRow) {
            // 1. Facts / Knowledge array or single
            if (Array.isArray(p.facts) || Array.isArray(p.knowledge)) {
                const facts = p.facts || p.knowledge;
                for (const f of facts) {
                    if (f && f.fact_key && f.content) {
                        upsertCharacterKnowledge(db, {
                            simulation_id: sim.id,
                            simulation_character_id: targetCharRow.id,
                            char_lws_id: targetCharRow.lws_id,
                            fact_key: f.fact_key,
                            content: f.content,
                            source_channel: f.source_channel || 'director_injection',
                            source_character_id: evaluated.target_internal_id || null,
                            source_event_id: evaluated.event_internal_id || null,
                            fictional_time_acquired: evaluated.fictional_time,
                            created_at: eventCreatedAt,
                            updated_at: eventCreatedAt,
                        });
                    }
                }
            } else if (p.target === 'character_knowledge') {
                upsertCharacterKnowledge(db, {
                    simulation_id: sim.id,
                    simulation_character_id: targetCharRow.id,
                    char_lws_id: targetCharRow.lws_id,
                    fact_key: p.fact_key,
                    content: p.content,
                    source_channel: p.source_channel || 'director_injection',
                    source_character_id: evaluated.target_internal_id || null,
                    source_event_id: evaluated.event_internal_id || null,
                    fictional_time_acquired: evaluated.fictional_time,
                    created_at: eventCreatedAt,
                    updated_at: eventCreatedAt,
                });
            }

            // 2. Beliefs array or single
            if (Array.isArray(p.beliefs)) {
                for (const b of p.beliefs) {
                    if (b && (b.subject || b.subject_key) && (b.predicate || b.statement || b.object_value)) {
                        upsertCharacterBelief(db, {
                            simulation_id: sim.id,
                            simulation_character_id: targetCharRow.id,
                            char_lws_id: targetCharRow.lws_id,
                            subject: b.subject,
                            subject_key: b.subject_key,
                            predicate: b.predicate,
                            statement: b.statement,
                            object_value: b.object_value,
                            belief_type: b.belief_type || 'belief',
                            confidence: b.confidence ?? 50,
                            source_basis: b.source_basis || 'director_injection',
                            causal_event_id: evaluated.event_internal_id || null,
                            created_at: eventCreatedAt,
                            updated_at: eventCreatedAt,
                        });
                    }
                }
            } else if (p.target === 'character_belief') {
                upsertCharacterBelief(db, {
                    simulation_id: sim.id,
                    simulation_character_id: targetCharRow.id,
                    char_lws_id: targetCharRow.lws_id,
                    subject: p.subject,
                    subject_key: p.subject_key,
                    predicate: p.predicate,
                    statement: p.statement,
                    object_value: p.object_value,
                    belief_type: p.belief_type || 'belief',
                    confidence: p.confidence ?? 50,
                    source_basis: p.source_basis || 'director_injection',
                    causal_event_id: evaluated.event_internal_id || null,
                    created_at: eventCreatedAt,
                    updated_at: eventCreatedAt,
                });
            }

            // 3. Memories array or patch
            if (Array.isArray(p.memories)) {
                for (const m of p.memories) {
                    createCharacterMemory(db, {
                        simulation_id: sim.id,
                        simulation_character_id: targetCharRow.id,
                        char_lws_id: targetCharRow.lws_id,
                        summary: m.summary || m.description,
                        details: m.details || m.reflection_notes || '',
                        memory_type: m.memory_type || 'episodic',
                        event_id: evaluated.event_internal_id || null,
                        event_lws_id: evaluated.event_lws_id || null,
                        fictional_time: evaluated.fictional_time,
                        emotional_salience: m.salience ?? m.emotional_salience ?? 50,
                        importance: m.importance ?? 50,
                        confidence: m.confidence ?? 100,
                        status: m.status || 'vivid',
                        tags: m.tags || m.sentiment_tags || [],
                        source_channel: m.source_channel || 'director_injection',
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            } else if (p.target === 'character_memory') {
                const memLwsId = p.memory_lws_id || p.lws_id;
                patchCharacterMemory(db, memLwsId, p.patch || {}, eventCreatedAt);
            }
        }

        if (evaluated.actor_internal_id && p.target !== 'camera' && p.target !== 'simulation' && p.target !== 'character_knowledge' && p.target !== 'character_belief' && p.target !== 'character_memory' && !p.beliefs && !p.knowledge && !p.facts && !p.memories) {
            const row = db.prepare(`
                SELECT current_location_id, activity, physical_condition, runtime_state
                FROM lws_simulation_characters
                WHERE id = ? AND simulation_id = ?
            `).get(evaluated.actor_internal_id, sim.id);
            if (row) {
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
        }
    },

    [EVENT_TYPES.COMMUNICATE]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        const actor = evaluated.actor_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.actor_internal_id)
            : null;
        const target = evaluated.target_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.target_internal_id)
            : null;

        // 1. Facts transmission to target
        if (target && Array.isArray(p.facts)) {
            for (const f of p.facts) {
                if (f && f.fact_key && f.content) {
                    upsertCharacterKnowledge(db, {
                        simulation_id: sim.id,
                        simulation_character_id: target.id,
                        char_lws_id: target.lws_id,
                        fact_key: f.fact_key,
                        content: f.content,
                        source_channel: 'communication',
                        source_character_id: actor?.id ?? null,
                        source_event_id: evaluated.event_internal_id,
                        fictional_time_acquired: evaluated.fictional_time,
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            }
        }

        // 2. Memory creation for actor and target
        if (actor) {
            createCharacterMemory(db, {
                simulation_id: sim.id,
                simulation_character_id: actor.id,
                char_lws_id: actor.lws_id,
                summary: p.summary || `Spoke with ${target?.name || 'someone'}`,
                details: p.message || p.content || '',
                memory_type: 'episodic',
                event_id: evaluated.event_internal_id,
                event_lws_id: evaluated.event_lws_id,
                fictional_time: evaluated.fictional_time,
                emotional_salience: p.emotional_salience ?? 50,
                importance: p.importance ?? 50,
                confidence: 100,
                status: 'vivid',
                tags: target ? [`character:${target.lws_id}`, `location:${evaluated.location_lws_id}`] : [`location:${evaluated.location_lws_id}`],
                source_channel: 'communication',
                slot_index: 0,
                created_at: eventCreatedAt,
                updated_at: eventCreatedAt,
            });
        }

        if (target) {
            createCharacterMemory(db, {
                simulation_id: sim.id,
                simulation_character_id: target.id,
                char_lws_id: target.lws_id,
                summary: p.summary || `${actor?.name || 'Someone'} spoke with me`,
                details: p.message || p.content || '',
                memory_type: 'episodic',
                event_id: evaluated.event_internal_id,
                event_lws_id: evaluated.event_lws_id,
                fictional_time: evaluated.fictional_time,
                emotional_salience: p.emotional_salience ?? 50,
                importance: p.importance ?? 50,
                confidence: 100,
                status: 'vivid',
                tags: actor ? [`character:${actor.lws_id}`, `location:${evaluated.location_lws_id}`] : [`location:${evaluated.location_lws_id}`],
                source_channel: 'communication',
                slot_index: 1,
                created_at: eventCreatedAt,
                updated_at: eventCreatedAt,
            });
        }

        // 3. Beliefs array
        if (Array.isArray(p.beliefs)) {
            for (const b of p.beliefs) {
                if (b && b.subject_key && b.statement) {
                    const recipient = target || actor;
                    if (recipient) {
                        upsertCharacterBelief(db, {
                            simulation_id: sim.id,
                            simulation_character_id: recipient.id,
                            char_lws_id: recipient.lws_id,
                            subject_key: b.subject_key,
                            statement: b.statement,
                            belief_type: b.belief_type || 'belief',
                            confidence: b.confidence ?? 50,
                            source_basis: b.source_basis || 'hearsay',
                            causal_event_id: evaluated.event_internal_id,
                            created_at: eventCreatedAt,
                            updated_at: eventCreatedAt,
                        });
                    }
                }
            }
        }
    },

    [EVENT_TYPES.OBSERVE]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        const actor = evaluated.actor_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.actor_internal_id)
            : null;

        if (actor && Array.isArray(p.observed_facts)) {
            for (const f of p.observed_facts) {
                if (f && f.fact_key && f.content) {
                    upsertCharacterKnowledge(db, {
                        simulation_id: sim.id,
                        simulation_character_id: actor.id,
                        char_lws_id: actor.lws_id,
                        fact_key: f.fact_key,
                        content: f.content,
                        source_channel: 'evidence',
                        source_character_id: null,
                        source_event_id: evaluated.event_internal_id,
                        fictional_time_acquired: evaluated.fictional_time,
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            }
        }

        if (actor) {
            createCharacterMemory(db, {
                simulation_id: sim.id,
                simulation_character_id: actor.id,
                char_lws_id: actor.lws_id,
                summary: p.summary || `Observed ${p.target || 'surroundings'}`,
                details: p.details || p.description || '',
                memory_type: 'episodic',
                event_id: evaluated.event_internal_id,
                event_lws_id: evaluated.event_lws_id,
                fictional_time: evaluated.fictional_time,
                emotional_salience: p.emotional_salience ?? 50,
                importance: p.importance ?? 50,
                confidence: 100,
                status: 'vivid',
                tags: [`location:${evaluated.location_lws_id}`],
                source_channel: 'evidence',
                slot_index: 0,
                created_at: eventCreatedAt,
                updated_at: eventCreatedAt,
            });
        }

        if (actor && Array.isArray(p.beliefs)) {
            for (const b of p.beliefs) {
                if (b && b.subject_key && b.statement) {
                    upsertCharacterBelief(db, {
                        simulation_id: sim.id,
                        simulation_character_id: actor.id,
                        char_lws_id: actor.lws_id,
                        subject_key: b.subject_key,
                        statement: b.statement,
                        belief_type: b.belief_type || 'belief',
                        confidence: b.confidence ?? 50,
                        source_basis: b.source_basis || 'observation',
                        causal_event_id: evaluated.event_internal_id,
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            }
        }
    },

    [EVENT_TYPES.INTERACT_OBJECT]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        const actor = evaluated.actor_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.actor_internal_id)
            : null;

        if (actor && Array.isArray(p.discovered_facts)) {
            for (const f of p.discovered_facts) {
                if (f && f.fact_key && f.content) {
                    upsertCharacterKnowledge(db, {
                        simulation_id: sim.id,
                        simulation_character_id: actor.id,
                        char_lws_id: actor.lws_id,
                        fact_key: f.fact_key,
                        content: f.content,
                        source_channel: 'evidence',
                        source_character_id: null,
                        source_event_id: evaluated.event_internal_id,
                        fictional_time_acquired: evaluated.fictional_time,
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            }
        }

        if (actor) {
            createCharacterMemory(db, {
                simulation_id: sim.id,
                simulation_character_id: actor.id,
                char_lws_id: actor.lws_id,
                summary: p.summary || `Interacted with ${p.object_id || 'object'}`,
                details: p.details || p.description || '',
                memory_type: 'episodic',
                event_id: evaluated.event_internal_id,
                event_lws_id: evaluated.event_lws_id,
                fictional_time: evaluated.fictional_time,
                emotional_salience: p.emotional_salience ?? 50,
                importance: p.importance ?? 50,
                confidence: 100,
                status: 'vivid',
                tags: [`location:${evaluated.location_lws_id}`, `object:${p.object_id || 'object'}`],
                source_channel: 'evidence',
                slot_index: 0,
                created_at: eventCreatedAt,
                updated_at: eventCreatedAt,
            });
        }

        if (actor && Array.isArray(p.beliefs)) {
            for (const b of p.beliefs) {
                if (b && b.subject_key && b.statement) {
                    upsertCharacterBelief(db, {
                        simulation_id: sim.id,
                        simulation_character_id: actor.id,
                        char_lws_id: actor.lws_id,
                        subject_key: b.subject_key,
                        statement: b.statement,
                        belief_type: b.belief_type || 'belief',
                        confidence: b.confidence ?? 50,
                        source_basis: b.source_basis || 'observation',
                        causal_event_id: evaluated.event_internal_id,
                        created_at: eventCreatedAt,
                        updated_at: eventCreatedAt,
                    });
                }
            }
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
        const act = evaluated.payload?.activity || 'working';
        db.prepare(`
            UPDATE lws_simulation_characters
            SET activity = ?, updated_at = ?
            WHERE id = ? AND simulation_id = ?
        `).run(act, eventCreatedAt, evaluated.actor_internal_id, sim.id);
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
