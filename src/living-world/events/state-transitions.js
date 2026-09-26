import { EVENT_TYPES, deepMerge } from './taxonomy.js';
import { safeJsonParse } from '../simulations/common.js';
import { generateUuid } from '../authored/common.js';
import { upsertCharacterKnowledge } from '../perception/knowledge.js';
import { createCharacterMemory, patchCharacterMemory } from '../perception/memories.js';
import { upsertCharacterBelief } from '../perception/beliefs.js';
import { setSimulationCamera } from '../perception/camera.js';
import { updateCharacterEmotion, normalizeEmotionInput } from '../cognition/emotions.js';
import { updateCharacterValue } from '../cognition/values.js';
import { getProposalTarget } from '../cognition/common.js';
import { applyRelationshipDelta, evaluateFamiliarityDecay } from '../social/relationships.js';
import { createSocialInformation, evaluateBeliefAdoption } from '../social/rumors.js';
import { updateFactionMembership } from '../social/factions.js';
import { recordCharacterDevelopment } from '../social/development.js';
import { calculateDiurnalTemperature, calculateDiurnalLighting, evaluateOperatingHours } from '../environment/common.js';
import { updateLocationEnvironment } from '../environment/environment.js';
import { updateLocationOperationalState } from '../environment/operational-states.js';
import { elevateCharacterTier } from '../population/character-tiers.js';

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

        if (evaluated.payload?.social || evaluated.payload?.social_state) {
            const soc = evaluated.payload.social || evaluated.payload.social_state;
            if (soc.relationship_update && evaluated.actor_internal_id) {
                const r = soc.relationship_update;
                const tgtRow = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(r.target_character_id || r.target_id, r.target_character_id || r.target_id, sim.id);
                const actorRow = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ?').get(evaluated.actor_internal_id);
                if (actorRow && tgtRow) {
                    applyRelationshipDelta(db, sim.id, sim.lws_id, actorRow.id, actorRow.lws_id, tgtRow.id, tgtRow.lws_id, r.delta || r, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, r.interaction_type || 'update', r.narrative_rationale || '', eventCreatedAt);
                }
            }
            if (soc.rumor_update) {
                createSocialInformation(db, {
                    ...soc.rumor_update,
                    simulation_id: sim.id,
                    sim_lws_id: sim.lws_id,
                    fictional_time: evaluated.fictional_time,
                    created_at: eventCreatedAt,
                }, evaluated);
            }
            if (soc.faction_membership_update && evaluated.actor_internal_id) {
                const f = soc.faction_membership_update;
                updateFactionMembership(db, sim.id, evaluated.actor_internal_id, f.faction_id, f.patch || f, eventCreatedAt);
            }
            if (soc.development_record && evaluated.actor_internal_id) {
                const d = soc.development_record;
                recordCharacterDevelopment(db, {
                    ...d,
                    simulation_id: sim.id,
                    sim_lws_id: sim.lws_id,
                    simulation_character_id: evaluated.actor_internal_id,
                    fictional_time: evaluated.fictional_time,
                    created_at: eventCreatedAt,
                }, evaluated);
            }
        }

        // Phase 9: Tier elevation handling
        if (evaluated.payload?.tier_elevation && evaluated.actor_internal_id) {
            elevateCharacterTier(db, sim.id, evaluated.actor_internal_id, evaluated.payload.tier_elevation);
        } else if (evaluated.payload?.tier && evaluated.actor_internal_id) {
            elevateCharacterTier(db, sim.id, evaluated.actor_internal_id, evaluated.payload.tier);
        }

        // Phase 9: Environment and operational state updates
        if (evaluated.payload?.environment && evaluated.location_internal_id) {
            updateLocationEnvironment(db, sim.id, evaluated.location_internal_id, evaluated.payload.environment, evaluated.fictional_time);
        }
        if (evaluated.payload?.operational_state && evaluated.location_internal_id) {
            updateLocationOperationalState(db, sim.id, evaluated.location_internal_id, evaluated.payload.operational_state, evaluated.fictional_time);
        }
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

        // Map-based cognition mutations
        if (p.character_needs && typeof p.character_needs === 'object') {
            for (const [charKey, needsMap] of Object.entries(p.character_needs)) {
                const cRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(charKey, charKey, sim.id);
                if (cRow && typeof needsMap === 'object') {
                    for (const [nName, nVal] of Object.entries(needsMap)) {
                        const sat = typeof nVal === 'number' ? Math.max(0, Math.min(100, Math.round(nVal))) : (nVal?.satisfaction !== undefined ? Math.max(0, Math.min(100, Math.round(nVal.satisfaction))) : null);
                        const dec = nVal?.decay_rate !== undefined ? Math.max(0, Math.min(1000, Math.round(nVal.decay_rate))) : null;
                        if (sat !== null && dec !== null) {
                            db.prepare('UPDATE lws_character_needs SET satisfaction = ?, decay_rate = ?, updated_at = ? WHERE simulation_character_id = ? AND need_name = ?').run(sat, dec, eventCreatedAt, cRow.id, nName);
                        } else if (sat !== null) {
                            db.prepare('UPDATE lws_character_needs SET satisfaction = ?, updated_at = ? WHERE simulation_character_id = ? AND need_name = ?').run(sat, eventCreatedAt, cRow.id, nName);
                        } else if (dec !== null) {
                            db.prepare('UPDATE lws_character_needs SET decay_rate = ?, updated_at = ? WHERE simulation_character_id = ? AND need_name = ?').run(dec, eventCreatedAt, cRow.id, nName);
                        }
                    }
                }
            }
        }

        if (p.character_values && typeof p.character_values === 'object') {
            for (const [charKey, valMap] of Object.entries(p.character_values)) {
                const cRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(charKey, charKey, sim.id);
                if (cRow && typeof valMap === 'object') {
                    for (const [dim, strVal] of Object.entries(valMap)) {
                        const str = typeof strVal === 'number' ? Math.max(-100, Math.min(100, Math.round(strVal))) : (strVal?.strength !== undefined ? Math.max(-100, Math.min(100, Math.round(strVal.strength))) : 0);
                        updateCharacterValue(db, cRow.id, dim, str, eventCreatedAt);
                    }
                }
            }
        }

        if (p.character_emotions && typeof p.character_emotions === 'object') {
            for (const [charKey, emoData] of Object.entries(p.character_emotions)) {
                const cRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(charKey, charKey, sim.id);
                if (cRow && typeof emoData === 'object') {
                    updateCharacterEmotion(db, cRow.id, emoData, evaluated.fictional_time, eventCreatedAt);
                }
            }
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
            } else if (p.target === 'character_needs') {
                const needName = p.need_name;
                const sat = p.satisfaction !== undefined ? Math.max(0, Math.min(100, Math.round(p.satisfaction))) : null;
                const decay = p.decay_rate !== undefined ? Math.max(0, Math.min(1000, Math.round(p.decay_rate))) : null;
                if (needName) {
                    if (sat !== null && decay !== null) {
                        db.prepare(`
                            UPDATE lws_character_needs
                            SET satisfaction = ?, decay_rate = ?, updated_at = ?
                            WHERE simulation_character_id = ? AND need_name = ?
                        `).run(sat, decay, eventCreatedAt, targetCharRow.id, needName);
                    } else if (sat !== null) {
                        db.prepare(`
                            UPDATE lws_character_needs
                            SET satisfaction = ?, updated_at = ?
                            WHERE simulation_character_id = ? AND need_name = ?
                        `).run(sat, eventCreatedAt, targetCharRow.id, needName);
                    } else if (decay !== null) {
                        db.prepare(`
                            UPDATE lws_character_needs
                            SET decay_rate = ?, updated_at = ?
                            WHERE simulation_character_id = ? AND need_name = ?
                        `).run(decay, eventCreatedAt, targetCharRow.id, needName);
                    }
                }
            } else if (p.target === 'character_value' && p.dimension) {
                const strength = p.strength !== undefined ? Math.max(-100, Math.min(100, Math.round(p.strength))) : 0;
                updateCharacterValue(db, targetCharRow.id, p.dimension, strength, eventCreatedAt);
            } else if (p.target === 'character_emotion') {
                const emoData = p.emotion || p;
                updateCharacterEmotion(db, targetCharRow.id, emoData, evaluated.fictional_time, eventCreatedAt);
            } else if (p.target === 'character_goal') {
                const goalLwsId = p.goal_lws_id || p.lws_id;
                if (goalLwsId) {
                    const patch = p.patch || p;
                    const status = patch.status;
                    const priority = patch.priority;
                    const progress = patch.progress;
                    const deletedAt = patch.deleted_at;
                    if (deletedAt !== undefined) {
                        db.prepare(`
                            UPDATE lws_character_goals
                            SET deleted_at = ?, status = 'abandoned', updated_at = ?
                            WHERE lws_id = ? AND simulation_character_id = ?
                        `).run(deletedAt, eventCreatedAt, goalLwsId, targetCharRow.id);
                    } else if (status !== undefined || priority !== undefined || progress !== undefined) {
                        const existingG = db.prepare('SELECT * FROM lws_character_goals WHERE lws_id = ?').get(goalLwsId);
                        if (existingG) {
                            db.prepare(`
                                UPDATE lws_character_goals
                                SET status = COALESCE(?, status), priority = COALESCE(?, priority),
                                    progress = COALESCE(?, progress), updated_at = ?
                                WHERE id = ?
                            `).run(status ?? null, priority ?? null, progress ?? null, eventCreatedAt, existingG.id);
                        }
                    }
                }
            } else if (p.target === 'character_relationship') {
                const srcRow = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(p.source_character_id || p.source_id, p.source_character_id || p.source_id, sim.id);
                const tgtRow = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(p.target_character_id || p.target_id, p.target_character_id || p.target_id, sim.id);
                if (srcRow && tgtRow) {
                    applyRelationshipDelta(db, sim.id, sim.lws_id, srcRow.id, srcRow.lws_id, tgtRow.id, tgtRow.lws_id, p.delta || p, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, p.interaction_type || 'director_override', p.narrative_rationale || 'Director relationship modification', eventCreatedAt);
                }
            } else if (p.target === 'character_development' || p.development_record || p.social_state?.development_record) {
                const devData = p.development_record || p.social_state?.development_record || p;
                const charRow = targetCharRow || (evaluated.actor_internal_id ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ?').get(evaluated.actor_internal_id) : null);
                if (charRow) {
                    recordCharacterDevelopment(db, {
                        ...devData,
                        simulation_id: sim.id,
                        sim_lws_id: sim.lws_id,
                        simulation_character_id: charRow.id,
                        trigger_category: devData.trigger_category || 'director_override',
                        causal_event_ids: devData.causal_event_ids || [evaluated.event_lws_id],
                        fictional_time: evaluated.fictional_time,
                        created_at: eventCreatedAt,
                    }, evaluated);
                }
            } else if (p.target === 'faction_membership') {
                const charRow = targetCharRow || (evaluated.actor_internal_id ? db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE id = ?').get(evaluated.actor_internal_id) : null);
                if (charRow && p.faction_id) {
                    updateFactionMembership(db, sim.id, charRow.id, p.faction_id, p.patch || p, eventCreatedAt);
                }
            } else if (p.target === 'social_information' || p.rumor) {
                const rumorData = p.rumor || p;
                createSocialInformation(db, {
                    ...rumorData,
                    simulation_id: sim.id,
                    sim_lws_id: sim.lws_id,
                    fictional_time: evaluated.fictional_time,
                    created_at: eventCreatedAt,
                }, evaluated);
            }
        }

        if (evaluated.actor_internal_id && p.target !== 'camera' && p.target !== 'simulation' && p.target !== 'character_knowledge' && p.target !== 'character_belief' && p.target !== 'character_memory' && p.target !== 'character_relationship' && p.target !== 'character_development' && p.target !== 'faction_membership' && p.target !== 'social_information' && !p.beliefs && !p.knowledge && !p.facts && !p.memories) {
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

        // Phase 9: Director Environment, Operational State, and Tier Overrides
        if (p.environment) {
            const locId = evaluated.location_internal_id || (p.location_id ? (db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(p.location_id, sim.world_id)?.id) : null);
            if (locId) {
                updateLocationEnvironment(db, sim.id, locId, p.environment, evaluated.fictional_time);
            }
        }
        if (p.operational_state) {
            const locId = evaluated.location_internal_id || (p.location_id ? (db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(p.location_id, sim.world_id)?.id) : null);
            if (locId) {
                updateLocationOperationalState(db, sim.id, locId, p.operational_state, evaluated.fictional_time);
            }
        }
        if (p.tier_elevation && targetCharRow) {
            elevateCharacterTier(db, sim.id, targetCharRow.id, p.tier_elevation);
        } else if (p.tier && targetCharRow) {
            elevateCharacterTier(db, sim.id, targetCharRow.id, p.tier);
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

        // 4. Directional Relationship deltas (Phase 8)
        if (actor && target) {
            if (p.relationship_delta) {
                const d = p.relationship_delta;
                applyRelationshipDelta(db, sim.id, sim.lws_id, actor.id, actor.lws_id, target.id, target.lws_id, d, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, 'communication', d.narrative_rationale || d.rationale || 'Conversation interaction', eventCreatedAt);
                if (d.reverse) {
                    applyRelationshipDelta(db, sim.id, sim.lws_id, target.id, target.lws_id, actor.id, actor.lws_id, d.reverse, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, 'communication', d.reverse.narrative_rationale || d.reverse.rationale || 'Conversation interaction', eventCreatedAt);
                }
            }
        }

        // 5. Rumors & Social Information (Phase 8)
        if (p.rumor || p.social_information) {
            const rumorData = p.rumor || p.social_information;
            const depth = Number(rumorData.transmission_depth ?? 0);
            const isRoot = depth === 0;
            const createdSocialInfo = createSocialInformation(db, {
                simulation_id: sim.id,
                sim_lws_id: sim.lws_id,
                originator_character_id: actor ? actor.id : null,
                transmitter_character_id: !isRoot ? (actor ? actor.id : null) : null,
                transmitter_char_lws_id: !isRoot ? (actor ? actor.lws_id : null) : null,
                recipient_character_id: !isRoot ? (target ? target.id : null) : null,
                recipient_char_lws_id: !isRoot ? (target ? target.lws_id : null) : null,
                causal_event_id: evaluated.event_internal_id,
                causal_event_lws_id: evaluated.event_lws_id,
                fictional_time: evaluated.fictional_time,
                created_at: eventCreatedAt,
                ...rumorData,
            }, evaluated);

            if (target && actor) {
                evaluateBeliefAdoption(db, sim.id, target, actor, createdSocialInfo, evaluated, eventCreatedAt);
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

    [EVENT_TYPES.EMOTE]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        if (evaluated.actor_internal_id && (p.emotion || p.dominant_emotion)) {
            const emoData = p.emotion || p;
            updateCharacterEmotion(db, evaluated.actor_internal_id, emoData, evaluated.fictional_time, eventCreatedAt);
        }
    },

    [EVENT_TYPES.CONSUME_ITEM]: (db, sim, evaluated, eventCreatedAt) => {
        // CONSUME_ITEM optionally updates nourishment or inventory
    },

    [EVENT_TYPES.TRANSFER_ITEM]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        const actor = evaluated.actor_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.actor_internal_id)
            : null;
        const target = evaluated.target_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.target_internal_id)
            : null;

        if (actor && target) {
            const impact = p.relationship_impact || {
                delta_affection: p.delta_affection ?? 15,
                delta_trust: p.delta_trust ?? 10,
                delta_loyalty: p.delta_loyalty ?? 5,
                delta_familiarity: p.delta_familiarity ?? 10,
            };
            applyRelationshipDelta(db, sim.id, sim.lws_id, target.id, target.lws_id, actor.id, actor.lws_id, impact, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, 'gift', p.narrative_rationale || 'Item transfer / gift', eventCreatedAt);
        }
    },

    [EVENT_TYPES.COMBAT_ACTION]: (db, sim, evaluated, eventCreatedAt) => {
        const p = evaluated.payload ?? {};
        const actor = evaluated.actor_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.actor_internal_id)
            : null;
        const target = evaluated.target_internal_id
            ? db.prepare('SELECT sc.id, sc.lws_id, c.name FROM lws_simulation_characters sc JOIN lws_characters c ON sc.character_id = c.id WHERE sc.id = ?').get(evaluated.target_internal_id)
            : null;

        if (actor && target) {
            const impact = p.relationship_impact || {
                delta_affection: p.delta_affection ?? -40,
                delta_trust: p.delta_trust ?? -50,
                delta_respect: p.delta_respect ?? 0,
                delta_loyalty: p.delta_loyalty ?? -30,
            };
            applyRelationshipDelta(db, sim.id, sim.lws_id, target.id, target.lws_id, actor.id, actor.lws_id, impact, evaluated.event_internal_id, evaluated.event_lws_id, evaluated.fictional_time, 'combat', p.narrative_rationale || 'Hostile confrontation in combat', eventCreatedAt);
        }
    },

    [EVENT_TYPES.TIME_ADVANCE]: (db, sim, evaluated, eventCreatedAt) => {
        db.prepare(`
            UPDATE lws_simulations
            SET current_fictional_time = ?, updated_at = ?
            WHERE id = ?
        `).run(evaluated.fictional_time, eventCreatedAt, sim.id);

        evaluateFamiliarityDecay(db, sim.id, sim.lws_id, evaluated.fictional_time, evaluated.event_internal_id, evaluated.event_lws_id, eventCreatedAt);

        // Phase 9: Update derived environment temperature and lighting curves
        const envRows = db.prepare('SELECT * FROM lws_location_environments WHERE simulation_id = ?').all(sim.id);
        for (const env of envRows) {
            const locRow = db.prepare('SELECT * FROM lws_locations WHERE id = ?').get(env.location_id);
            let isIndoor = Boolean(env.is_indoor);
            let hasIlluminatedTag = false;
            if (locRow) {
                if (locRow.is_indoor !== undefined) isIndoor = Boolean(locRow.is_indoor);
                let tags = [];
                try {
                    tags = typeof locRow.tags === 'string' ? JSON.parse(locRow.tags) : (locRow.tags || []);
                } catch {
                    tags = [];
                }
                hasIlluminatedTag = tags.includes('illuminated') || tags.includes('lit');
                if (tags.includes('indoor')) isIndoor = true;
            }
            const nextTemp = env.temperature_override !== null
                ? env.temperature_override
                : calculateDiurnalTemperature(evaluated.fictional_time, env.temperature_baseline ?? 20.0, isIndoor);
            const nextLighting = env.lighting_override !== null
                ? env.lighting_override
                : calculateDiurnalLighting(evaluated.fictional_time, isIndoor, hasIlluminatedTag, env.weather);

            db.prepare(`
                UPDATE lws_location_environments
                SET temperature_celsius = ?, lighting_level = ?, last_evaluated_fictional_time = ?, updated_at = ?
                WHERE id = ?
            `).run(nextTemp, nextLighting, evaluated.fictional_time, eventCreatedAt, env.id);
        }

        // Phase 9: Update derived operational access states
        const opsRows = db.prepare('SELECT * FROM lws_location_operational_states WHERE simulation_id = ?').all(sim.id);
        for (const ops of opsRows) {
            if (ops.access_override === null && ops.operating_hours) {
                const nextAccess = evaluateOperatingHours(evaluated.fictional_time, ops.operating_hours);
                db.prepare(`
                    UPDATE lws_location_operational_states
                    SET access_status = ?, updated_at = ?
                    WHERE id = ?
                `).run(nextAccess, eventCreatedAt, ops.id);
            }
        }
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

    // Phase 7 Option B: Persist accepted intention on any proposable action
    if (evaluated.payload?.intention && evaluated.actor_internal_id) {
        const intention = evaluated.payload.intention;
        let goalInternalId = null;
        if (intention.goal_id) {
            const g = db.prepare('SELECT id FROM lws_character_goals WHERE (lws_id = ? OR id = ?) AND simulation_character_id = ?').get(intention.goal_id, intention.goal_id, evaluated.actor_internal_id);
            if (g) goalInternalId = g.id;
        }
        const target = intention.target_entity_type
            ? { type: intention.target_entity_type, id: intention.target_entity_id }
            : getProposalTarget(evaluated);

        const existingIntention = db.prepare('SELECT id FROM lws_character_intentions WHERE lws_id = ?').get(intention.lws_id);
        if (existingIntention) {
            db.prepare(`
                UPDATE lws_character_intentions
                SET status = 'completed', updated_at = ?
                WHERE id = ?
            `).run(eventCreatedAt, existingIntention.id);
        } else {
            db.prepare(`
                INSERT INTO lws_character_intentions (
                    lws_id, simulation_id, simulation_character_id, goal_id,
                    action_type, target_entity_type, target_entity_id, rationale,
                    status, priority, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
            `).run(
                intention.lws_id,
                sim.id,
                evaluated.actor_internal_id,
                goalInternalId,
                intention.action_type || evaluated.event_type,
                target.type,
                target.id,
                intention.rationale || '',
                intention.priority || 50,
                eventCreatedAt,
                eventCreatedAt,
            );
        }
    }

    // Phase 7 Option B: Persist failed intention on UPDATE_RUNTIME_STATE cognition variant
    if (evaluated.payload?.cognition?.failed_intention && evaluated.actor_internal_id) {
        const failed = evaluated.payload.cognition.failed_intention;
        let goalInternalId = null;
        if (failed.goal_id) {
            const g = db.prepare('SELECT id FROM lws_character_goals WHERE (lws_id = ? OR id = ?) AND simulation_character_id = ?').get(failed.goal_id, failed.goal_id, evaluated.actor_internal_id);
            if (g) goalInternalId = g.id;
        }
        const existingIntention = db.prepare('SELECT id FROM lws_character_intentions WHERE lws_id = ?').get(failed.lws_id);
        if (existingIntention) {
            db.prepare(`
                UPDATE lws_character_intentions
                SET status = 'failed', failure_reason = ?, updated_at = ?
                WHERE id = ?
            `).run(failed.failure_reason || 'AUTHORITY_REJECTED', eventCreatedAt, existingIntention.id);
        } else {
            db.prepare(`
                INSERT INTO lws_character_intentions (
                    lws_id, simulation_id, simulation_character_id, goal_id,
                    action_type, target_entity_type, target_entity_id, rationale,
                    status, failure_reason, priority, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?)
            `).run(
                failed.lws_id,
                sim.id,
                evaluated.actor_internal_id,
                goalInternalId,
                failed.action_type,
                failed.target_entity_type || 'none',
                failed.target_entity_id || null,
                failed.rationale || '',
                failed.failure_reason || 'AUTHORITY_REJECTED',
                failed.priority || 50,
                eventCreatedAt,
                eventCreatedAt,
            );
        }
    }

    // Phase 7 Event-Backed Goals: Create Goal
    if (evaluated.payload?.cognition?.create_goal && evaluated.actor_internal_id) {
        const cg = evaluated.payload.cognition.create_goal;
        let targetLocId = null;
        if (cg.target_location_id) {
            const loc = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(cg.target_location_id, sim.world_id);
            if (loc) targetLocId = loc.id;
        }
        let targetCharId = null;
        if (cg.target_character_id) {
            const tc = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND simulation_id = ?').get(cg.target_character_id, sim.id);
            if (tc) targetCharId = tc.id;
        }
        let causalEvId = null;
        if (cg.causal_event_id) {
            const ev = db.prepare('SELECT id FROM lws_events WHERE lws_id = ? AND simulation_id = ?').get(cg.causal_event_id, sim.id);
            if (ev) causalEvId = ev.id;
        }

        const existingGoal = db.prepare('SELECT id FROM lws_character_goals WHERE lws_id = ?').get(cg.lws_id);
        if (!existingGoal) {
            db.prepare(`
                INSERT INTO lws_character_goals (
                    lws_id, simulation_id, simulation_character_id, client_goal_key,
                    title, description, goal_type, status, priority, urgency, progress,
                    objective_action_type, target_location_id, target_character_id, target_object_id,
                    deadline_fictional_time, causal_event_id, created_at, updated_at, deleted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            `).run(
                cg.lws_id,
                sim.id,
                evaluated.actor_internal_id,
                cg.client_goal_key ?? null,
                cg.title,
                cg.description || '',
                cg.goal_type || 'short_term',
                cg.status || 'active',
                cg.priority ?? 50,
                cg.urgency ?? 50,
                cg.progress ?? 0,
                cg.objective_action_type ?? null,
                targetLocId,
                targetCharId,
                cg.target_object_id ?? null,
                cg.deadline_fictional_time ?? null,
                causalEvId,
                eventCreatedAt,
                eventCreatedAt,
            );
        }
    }

    // Phase 7 Event-Backed Goals: Update / Soft-Delete Goal
    if (evaluated.payload?.cognition?.update_goal && evaluated.actor_internal_id) {
        const ug = evaluated.payload.cognition.update_goal;
        const goalId = ug.goal_lws_id || ug.lws_id;
        const existing = db.prepare('SELECT * FROM lws_character_goals WHERE lws_id = ? AND simulation_id = ?').get(goalId, sim.id);
        if (existing) {
            if (ug.deleted_at || ug.is_deleted === true) {
                const finalStatus = existing.status === 'completed' ? 'completed' : 'abandoned';
                db.prepare(`
                    UPDATE lws_character_goals
                    SET deleted_at = ?, status = ?, updated_at = ?
                    WHERE id = ?
                `).run(eventCreatedAt, finalStatus, eventCreatedAt, existing.id);

                db.prepare(`
                    UPDATE lws_character_intentions
                    SET status = 'cancelled', cancellation_reason = 'goal_deleted', updated_at = ?
                    WHERE goal_id = ? AND status IN ('active', 'executing')
                `).run(eventCreatedAt, existing.id);
            } else {
                const newTitle = ug.title !== undefined ? ug.title : existing.title;
                const newDesc = ug.description !== undefined ? ug.description : existing.description;
                const newStatus = ug.status !== undefined ? ug.status : existing.status;
                const newPriority = ug.priority !== undefined ? ug.priority : existing.priority;
                const newUrgency = ug.urgency !== undefined ? ug.urgency : existing.urgency;
                const newProgress = ug.progress !== undefined ? ug.progress : (ug.status === 'completed' ? 100 : existing.progress);
                const newDeadline = ug.deadline_fictional_time !== undefined ? ug.deadline_fictional_time : existing.deadline_fictional_time;

                db.prepare(`
                    UPDATE lws_character_goals
                    SET title = ?, description = ?, status = ?, priority = ?, urgency = ?,
                        progress = ?, deadline_fictional_time = ?, updated_at = ?
                    WHERE id = ?
                `).run(
                    newTitle, newDesc, newStatus, newPriority, newUrgency,
                    newProgress, newDeadline, eventCreatedAt, existing.id
                );

                if (newStatus === 'completed' || newStatus === 'abandoned') {
                    const reason = newStatus === 'completed' ? 'goal_completed' : 'goal_abandoned';
                    db.prepare(`
                        UPDATE lws_character_intentions
                        SET status = 'cancelled', cancellation_reason = ?, updated_at = ?
                        WHERE goal_id = ? AND status IN ('active', 'executing')
                    `).run(reason, eventCreatedAt, existing.id);
                }
            }
        }
    }
}
