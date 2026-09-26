import { getDb } from '../db.js';
import { safeJsonParse, ensureActiveSimulation } from '../simulations/common.js';
import { generateDeterministicUuid } from '../authored/common.js';
import { deepMerge, EVENT_TYPES } from './taxonomy.js';
import { listEvents } from './events.js';
import { NEED_NAMES } from '../cognition/needs.js';
import { VALUE_DIMENSIONS } from '../cognition/values.js';
import { normalizeEmotionInput } from '../cognition/emotions.js';

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
    const simLwsId = event.simulation_id || state.simulation.lws_id;
    if (simLwsId && !state.simulation.lws_id) {
        state.simulation.lws_id = simLwsId;
    }

    // Phase 7 Option B: Fold payload.intention on any event
    if (payload.intention && event.actor_character_id) {
        const intention = payload.intention;
        const actorId = event.actor_character_id;
        state.intentions[actorId] = state.intentions[actorId] || {};
        state.intentions[actorId][intention.lws_id] = {
            lws_id: intention.lws_id,
            simulation_id: simLwsId,
            simulation_character_id: actorId,
            goal_id: intention.goal_id ?? null,
            action_type: intention.action_type || event.event_type,
            target_entity_type: intention.target_entity_type || 'none',
            target_entity_id: intention.target_entity_id ?? null,
            rationale: intention.rationale || '',
            status: intention.status || 'completed',
            cancellation_reason: intention.cancellation_reason ?? null,
            failure_reason: intention.failure_reason ?? null,
            priority: intention.priority ?? 50,
            attempt_index: intention.attempt_index,
            causal_context: intention.causal_context,
            created_at: event.created_at,
            updated_at: event.created_at,
        };
    }

    switch (event.event_type) {
        case EVENT_TYPES.SIMULATION_START:
            state.simulation.status = 'active';
            state.simulation.current_fictional_time = event.fictional_time;
            state.simulation.settings = payload.settings ?? {};
            if (simLwsId) {
                state.cameras.default = state.cameras.default || {
                    lws_id: generateDeterministicUuid('camera', simLwsId, 'default'),
                    camera_name: 'default',
                    mode: 'god_view',
                    target_character_lws_id: null,
                    target_location_lws_id: null,
                };
            }
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
            state.knowledge[charLwsId] = state.knowledge[charLwsId] || {};
            state.memories[charLwsId] = state.memories[charLwsId] || {};
            state.beliefs[charLwsId] = state.beliefs[charLwsId] || {};

            state.needs[charLwsId] = state.needs[charLwsId] || {};
            for (const needName of NEED_NAMES) {
                state.needs[charLwsId][needName] = {
                    lws_id: generateDeterministicUuid('need', simLwsId, charLwsId, needName),
                    simulation_id: simLwsId,
                    simulation_character_id: charLwsId,
                    need_name: needName,
                    satisfaction: 100,
                    decay_rate: 100,
                    last_evaluated_time: event.fictional_time,
                    created_at: event.created_at,
                    updated_at: event.created_at,
                };
            }

            state.values[charLwsId] = state.values[charLwsId] || {};
            for (const dim of VALUE_DIMENSIONS) {
                state.values[charLwsId][dim] = {
                    lws_id: generateDeterministicUuid('value', simLwsId, charLwsId, dim),
                    simulation_id: simLwsId,
                    simulation_character_id: charLwsId,
                    dimension: dim,
                    strength: 0,
                    created_at: event.created_at,
                    updated_at: event.created_at,
                };
            }

            state.emotions[charLwsId] = {
                lws_id: generateDeterministicUuid('emotion', simLwsId, charLwsId),
                simulation_id: simLwsId,
                simulation_character_id: charLwsId,
                dominant_emotion: 'neutral',
                intensity: 0,
                arousal: 50,
                valence: 0,
                last_updated_time: event.fictional_time,
                created_at: event.created_at,
                updated_at: event.created_at,
            };

            state.goals[charLwsId] = state.goals[charLwsId] || {};
            state.intentions[charLwsId] = state.intentions[charLwsId] || {};
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

        case EVENT_TYPES.UPDATE_RUNTIME_STATE: {
            const actorId = event.actor_character_id;
            if (state.characters[actorId] && payload.patch) {
                state.characters[actorId].runtime_state = deepMerge(
                    state.characters[actorId].runtime_state,
                    payload.patch ?? {},
                );
            }
            if (payload.cognition?.failed_intention && actorId) {
                const failed = payload.cognition.failed_intention;
                state.intentions[actorId] = state.intentions[actorId] || {};
                state.intentions[actorId][failed.lws_id] = {
                    lws_id: failed.lws_id,
                    simulation_id: simLwsId,
                    simulation_character_id: actorId,
                    goal_id: failed.goal_id ?? null,
                    action_type: failed.action_type,
                    target_entity_type: failed.target_entity_type || 'none',
                    target_entity_id: failed.target_entity_id ?? null,
                    rationale: failed.rationale || '',
                    status: 'failed',
                    cancellation_reason: null,
                    failure_reason: failed.failure_reason || 'AUTHORITY_REJECTED',
                    priority: failed.priority ?? 50,
                    attempt_index: failed.attempt_index,
                    causal_context: failed.causal_context,
                    created_at: event.created_at,
                    updated_at: event.created_at,
                };
            }
            if (payload.cognition?.needs && actorId) {
                state.needs[actorId] = state.needs[actorId] || {};
                for (const [k, v] of Object.entries(payload.cognition.needs)) {
                    if (state.needs[actorId][k]) {
                        state.needs[actorId][k].satisfaction = v.satisfaction ?? state.needs[actorId][k].satisfaction;
                        state.needs[actorId][k].decay_rate = v.decay_rate ?? state.needs[actorId][k].decay_rate;
                        state.needs[actorId][k].updated_at = event.created_at;
                    }
                }
            }
            break;
        }

        case EVENT_TYPES.CHARACTER_LEAVE:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].deleted_at = event.created_at;
            }
            break;

        case EVENT_TYPES.COMMUNICATE: {
            const actorId = event.actor_character_id;
            const targetId = event.target_character_id;

            // 1. Facts transmission
            if (targetId && Array.isArray(payload.facts)) {
                state.knowledge[targetId] = state.knowledge[targetId] || {};
                for (const f of payload.facts) {
                    if (f && f.fact_key && f.content) {
                        const kLwsId = generateDeterministicUuid('knowledge', targetId, f.fact_key);
                        state.knowledge[targetId][f.fact_key] = {
                            lws_id: kLwsId,
                            fact_key: f.fact_key,
                            content: f.content,
                            source_channel: 'communication',
                            source_character_id: actorId || null,
                            source_event_id: event.lws_id,
                            fictional_time_acquired: event.fictional_time,
                            deleted_at: null,
                        };
                    }
                }
            }

            // 2. Memories for actor & target
            if (actorId) {
                state.memories[actorId] = state.memories[actorId] || {};
                const memLwsId = generateDeterministicUuid('memory', event.lws_id, actorId, '0');
                state.memories[actorId][memLwsId] = {
                    lws_id: memLwsId,
                    summary: payload.summary || 'Spoke with someone',
                    details: payload.message || payload.content || '',
                    memory_type: 'episodic',
                    event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    emotional_salience: payload.emotional_salience ?? 50,
                    importance: payload.importance ?? 50,
                    confidence: 100,
                    status: 'vivid',
                    tags: targetId ? [`character:${targetId}`, `location:${event.location_id}`] : [`location:${event.location_id}`],
                    source_channel: 'communication',
                    deleted_at: null,
                };
            }

            if (targetId) {
                state.memories[targetId] = state.memories[targetId] || {};
                const memLwsId = generateDeterministicUuid('memory', event.lws_id, targetId, '1');
                state.memories[targetId][memLwsId] = {
                    lws_id: memLwsId,
                    summary: payload.summary || 'Someone spoke with me',
                    details: payload.message || payload.content || '',
                    memory_type: 'episodic',
                    event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    emotional_salience: payload.emotional_salience ?? 50,
                    importance: payload.importance ?? 50,
                    confidence: 100,
                    status: 'vivid',
                    tags: actorId ? [`character:${actorId}`, `location:${event.location_id}`] : [`location:${event.location_id}`],
                    source_channel: 'communication',
                    deleted_at: null,
                };
            }

            // 3. Beliefs
            if (Array.isArray(payload.beliefs)) {
                const recipientId = targetId || actorId;
                if (recipientId) {
                    state.beliefs[recipientId] = state.beliefs[recipientId] || {};
                    for (const b of payload.beliefs) {
                        const key = (b.subject_key || (b.predicate ? `${b.subject}:${b.predicate}` : b.subject) || '').trim();
                        if (key) {
                            const bLwsId = generateDeterministicUuid('belief', recipientId, key);
                            state.beliefs[recipientId][key] = {
                                lws_id: bLwsId,
                                subject_key: key,
                                statement: b.statement !== undefined ? String(b.statement) : (b.object_value !== undefined ? String(b.object_value) : ''),
                                belief_type: b.belief_type || 'belief',
                                confidence: b.confidence ?? 50,
                                source_basis: b.source_basis || 'hearsay',
                                causal_event_id: event.lws_id,
                                deleted_at: null,
                            };
                        }
                    }
                }
            }
            break;
        }

        case EVENT_TYPES.OBSERVE: {
            const actorId = event.actor_character_id;
            if (actorId) {
                if (Array.isArray(payload.observed_facts)) {
                    state.knowledge[actorId] = state.knowledge[actorId] || {};
                    for (const f of payload.observed_facts) {
                        if (f && f.fact_key && f.content) {
                            const kLwsId = generateDeterministicUuid('knowledge', actorId, f.fact_key);
                            state.knowledge[actorId][f.fact_key] = {
                                lws_id: kLwsId,
                                fact_key: f.fact_key,
                                content: f.content,
                                source_channel: 'evidence',
                                source_character_id: null,
                                source_event_id: event.lws_id,
                                fictional_time_acquired: event.fictional_time,
                                deleted_at: null,
                            };
                        }
                    }
                }

                state.memories[actorId] = state.memories[actorId] || {};
                const memLwsId = generateDeterministicUuid('memory', event.lws_id, actorId, '0');
                state.memories[actorId][memLwsId] = {
                    lws_id: memLwsId,
                    summary: payload.summary || `Observed ${payload.target || 'surroundings'}`,
                    details: payload.details || payload.description || '',
                    memory_type: 'episodic',
                    event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    emotional_salience: payload.emotional_salience ?? 50,
                    importance: payload.importance ?? 50,
                    confidence: 100,
                    status: 'vivid',
                    tags: event.location_id ? [`location:${event.location_id}`] : [],
                    source_channel: 'evidence',
                    deleted_at: null,
                };

                if (Array.isArray(payload.beliefs)) {
                    state.beliefs[actorId] = state.beliefs[actorId] || {};
                    for (const b of payload.beliefs) {
                        const key = (b.subject_key || (b.predicate ? `${b.subject}:${b.predicate}` : b.subject) || '').trim();
                        if (key) {
                            const bLwsId = generateDeterministicUuid('belief', actorId, key);
                            state.beliefs[actorId][key] = {
                                lws_id: bLwsId,
                                subject_key: key,
                                statement: b.statement !== undefined ? String(b.statement) : (b.object_value !== undefined ? String(b.object_value) : ''),
                                belief_type: b.belief_type || 'belief',
                                confidence: b.confidence ?? 50,
                                source_basis: b.source_basis || 'observation',
                                causal_event_id: event.lws_id,
                                deleted_at: null,
                            };
                        }
                    }
                }
            }
            break;
        }

        case EVENT_TYPES.INTERACT_OBJECT: {
            const actorId = event.actor_character_id;
            if (actorId) {
                if (Array.isArray(payload.discovered_facts)) {
                    state.knowledge[actorId] = state.knowledge[actorId] || {};
                    for (const f of payload.discovered_facts) {
                        if (f && f.fact_key && f.content) {
                            const kLwsId = generateDeterministicUuid('knowledge', actorId, f.fact_key);
                            state.knowledge[actorId][f.fact_key] = {
                                lws_id: kLwsId,
                                fact_key: f.fact_key,
                                content: f.content,
                                source_channel: 'evidence',
                                source_character_id: null,
                                source_event_id: event.lws_id,
                                fictional_time_acquired: event.fictional_time,
                                deleted_at: null,
                            };
                        }
                    }
                }

                state.memories[actorId] = state.memories[actorId] || {};
                const memLwsId = generateDeterministicUuid('memory', event.lws_id, actorId, '0');
                state.memories[actorId][memLwsId] = {
                    lws_id: memLwsId,
                    summary: payload.summary || `Interacted with ${payload.object_id || 'object'}`,
                    details: payload.details || payload.description || '',
                    memory_type: 'episodic',
                    event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    emotional_salience: payload.emotional_salience ?? 50,
                    importance: payload.importance ?? 50,
                    confidence: 100,
                    status: 'vivid',
                    tags: [`location:${event.location_id}`, `object:${payload.object_id || 'object'}`],
                    source_channel: 'evidence',
                    deleted_at: null,
                };

                if (Array.isArray(payload.beliefs)) {
                    state.beliefs[actorId] = state.beliefs[actorId] || {};
                    for (const b of payload.beliefs) {
                        const key = (b.subject_key || (b.predicate ? `${b.subject}:${b.predicate}` : b.subject) || '').trim();
                        if (key) {
                            const bLwsId = generateDeterministicUuid('belief', actorId, key);
                            state.beliefs[actorId][key] = {
                                lws_id: bLwsId,
                                subject_key: key,
                                statement: b.statement !== undefined ? String(b.statement) : (b.object_value !== undefined ? String(b.object_value) : ''),
                                belief_type: b.belief_type || 'belief',
                                confidence: b.confidence ?? 50,
                                source_basis: b.source_basis || 'observation',
                                causal_event_id: event.lws_id,
                                deleted_at: null,
                            };
                        }
                    }
                }
            }
            break;
        }

        case EVENT_TYPES.DIRECTOR_MODIFY_STATE: {
            const targetCharId = payload.target_id || payload.target_character_id || event.actor_character_id;

            if (payload.target === 'simulation') {
                state.simulation.settings = deepMerge(state.simulation.settings, payload.settings_patch ?? {});
            } else if (payload.target === 'camera' || payload.camera) {
                const camData = payload.camera || payload;
                const camName = (camData.camera_name || 'default').trim();
                const camLwsId = generateDeterministicUuid('camera', simLwsId, camName);
                state.cameras[camName] = {
                    lws_id: camLwsId,
                    camera_name: camName,
                    mode: camData.mode || 'god_view',
                    target_character_lws_id: camData.target_character_id || null,
                    target_location_lws_id: camData.target_location_id || null,
                };
            }

            if (targetCharId) {
                // 1. Facts
                if (Array.isArray(payload.facts) || Array.isArray(payload.knowledge)) {
                    const facts = payload.facts || payload.knowledge;
                    state.knowledge[targetCharId] = state.knowledge[targetCharId] || {};
                    for (const f of facts) {
                        if (f && f.fact_key && f.content) {
                            const kLwsId = generateDeterministicUuid('knowledge', targetCharId, f.fact_key);
                            state.knowledge[targetCharId][f.fact_key] = {
                                lws_id: kLwsId,
                                fact_key: f.fact_key,
                                content: f.content,
                                source_channel: f.source_channel || 'director_injection',
                                source_character_id: event.target_character_id || null,
                                source_event_id: event.lws_id || null,
                                fictional_time_acquired: event.fictional_time,
                                deleted_at: null,
                            };
                        }
                    }
                } else if (payload.target === 'character_knowledge' && payload.fact_key) {
                    state.knowledge[targetCharId] = state.knowledge[targetCharId] || {};
                    const kLwsId = generateDeterministicUuid('knowledge', targetCharId, payload.fact_key);
                    state.knowledge[targetCharId][payload.fact_key] = {
                        lws_id: kLwsId,
                        fact_key: payload.fact_key,
                        content: payload.content,
                        source_channel: payload.source_channel || 'director_injection',
                        source_character_id: event.target_character_id || null,
                        source_event_id: event.lws_id || null,
                        fictional_time_acquired: event.fictional_time,
                        deleted_at: null,
                    };
                }

                // 2. Beliefs
                if (Array.isArray(payload.beliefs)) {
                    state.beliefs[targetCharId] = state.beliefs[targetCharId] || {};
                    for (const b of payload.beliefs) {
                        const key = (b.subject_key || (b.predicate ? `${b.subject}:${b.predicate}` : b.subject) || '').trim();
                        if (key) {
                            const bLwsId = generateDeterministicUuid('belief', targetCharId, key);
                            state.beliefs[targetCharId][key] = {
                                lws_id: bLwsId,
                                subject_key: key,
                                statement: b.statement !== undefined ? String(b.statement) : (b.object_value !== undefined ? String(b.object_value) : ''),
                                belief_type: b.belief_type || 'belief',
                                confidence: b.confidence ?? 50,
                                source_basis: b.source_basis || 'director_injection',
                                causal_event_id: event.lws_id,
                                deleted_at: null,
                            };
                        }
                    }
                } else if (payload.target === 'character_belief' && (payload.subject_key || payload.subject)) {
                    state.beliefs[targetCharId] = state.beliefs[targetCharId] || {};
                    const key = (payload.subject_key || (payload.predicate ? `${payload.subject}:${payload.predicate}` : payload.subject) || '').trim();
                    const bLwsId = generateDeterministicUuid('belief', targetCharId, key);
                    state.beliefs[targetCharId][key] = {
                        lws_id: bLwsId,
                        subject_key: key,
                        statement: payload.statement !== undefined ? String(payload.statement) : (payload.object_value !== undefined ? String(payload.object_value) : ''),
                        belief_type: payload.belief_type || 'belief',
                        confidence: payload.confidence ?? 50,
                        source_basis: payload.source_basis || 'director_injection',
                        causal_event_id: event.lws_id,
                        deleted_at: null,
                    };
                }

                // 3. Memories
                if (Array.isArray(payload.memories)) {
                    state.memories[targetCharId] = state.memories[targetCharId] || {};
                    for (let idx = 0; idx < payload.memories.length; idx++) {
                        const m = payload.memories[idx];
                        const summary = m.summary || m.description || '';
                        const memLwsId = generateDeterministicUuid('memory', event.lws_id, targetCharId, String(idx));
                        state.memories[targetCharId][memLwsId] = {
                            lws_id: memLwsId,
                            summary,
                            details: m.details || m.reflection_notes || '',
                            memory_type: m.memory_type || 'episodic',
                            event_lws_id: event.lws_id,
                            fictional_time: event.fictional_time,
                            emotional_salience: m.salience ?? m.emotional_salience ?? 50,
                            importance: m.importance ?? 50,
                            confidence: m.confidence ?? 100,
                            status: m.status || 'vivid',
                            tags: m.tags || m.sentiment_tags || [],
                            source_channel: m.source_channel || 'director_injection',
                            deleted_at: null,
                        };
                    }
                } else if (payload.target === 'character_memory') {
                    const memLwsId = payload.memory_lws_id || payload.lws_id;
                    const patch = payload.patch || {};
                    for (const charId in state.memories) {
                        if (state.memories[charId][memLwsId]) {
                            const existing = state.memories[charId][memLwsId];
                            if (patch.summary !== undefined) existing.summary = patch.summary;
                            if (patch.description !== undefined) existing.summary = patch.description;
                            if (patch.details !== undefined) existing.details = patch.details;
                            if (patch.reflection_notes !== undefined) existing.details = patch.reflection_notes;
                            if (patch.emotional_salience !== undefined) existing.emotional_salience = patch.emotional_salience;
                            if (patch.salience !== undefined) existing.emotional_salience = patch.salience <= 1 && patch.salience > 0 ? Math.round(patch.salience * 100) : patch.salience;
                            if (patch.importance !== undefined) existing.importance = patch.importance <= 1 && patch.importance > 0 ? Math.round(patch.importance * 100) : patch.importance;
                            if (patch.confidence !== undefined) existing.confidence = patch.confidence;
                            if (patch.status !== undefined) existing.status = patch.status;
                            if (patch.tags !== undefined) existing.tags = patch.tags;
                            if (patch.sentiment_tags !== undefined) existing.tags = patch.sentiment_tags;
                            if (patch.is_deleted === true) existing.deleted_at = event.created_at;
                            if (patch.is_deleted === false) existing.deleted_at = null;
                        }
                    }
                }

                if (payload.target === 'character_needs' && payload.need_name) {
                    state.needs[targetCharId] = state.needs[targetCharId] || {};
                    if (state.needs[targetCharId][payload.need_name]) {
                        if (payload.satisfaction !== undefined) state.needs[targetCharId][payload.need_name].satisfaction = payload.satisfaction;
                        if (payload.decay_rate !== undefined) state.needs[targetCharId][payload.need_name].decay_rate = payload.decay_rate;
                        state.needs[targetCharId][payload.need_name].updated_at = event.created_at;
                    }
                } else if (payload.target === 'character_value' && payload.dimension) {
                    state.values[targetCharId] = state.values[targetCharId] || {};
                    if (state.values[targetCharId][payload.dimension]) {
                        state.values[targetCharId][payload.dimension].strength = payload.strength;
                        state.values[targetCharId][payload.dimension].updated_at = event.created_at;
                    }
                } else if (payload.target === 'character_emotion') {
                    const normalized = normalizeEmotionInput(payload.emotion || payload);
                    state.emotions[targetCharId] = {
                        ...(state.emotions[targetCharId] || {}),
                        ...normalized,
                        last_updated_time: event.fictional_time,
                        updated_at: event.created_at,
                    };
                } else if (payload.target === 'character_goal') {
                    const goalLwsId = payload.goal_lws_id || payload.lws_id;
                    if (goalLwsId) {
                        state.goals[targetCharId] = state.goals[targetCharId] || {};
                        const patch = payload.patch || payload;
                        if (state.goals[targetCharId][goalLwsId]) {
                            Object.assign(state.goals[targetCharId][goalLwsId], patch, { updated_at: event.created_at });
                        } else {
                            state.goals[targetCharId][goalLwsId] = {
                                lws_id: goalLwsId,
                                simulation_id: simLwsId,
                                simulation_character_id: targetCharId,
                                ...patch,
                                created_at: event.created_at,
                                updated_at: event.created_at,
                            };
                        }
                    }
                }

                if (state.characters[event.actor_character_id] && payload.target !== 'camera' && payload.target !== 'simulation' && payload.target !== 'character_knowledge' && payload.target !== 'character_belief' && payload.target !== 'character_memory' && payload.target !== 'character_needs' && payload.target !== 'character_value' && payload.target !== 'character_emotion' && payload.target !== 'character_goal' && !payload.beliefs && !payload.knowledge && !payload.facts && !payload.memories) {
                    const char = state.characters[event.actor_character_id];
                    if (event.location_id !== null && event.location_id !== undefined) char.current_location_id = event.location_id;
                    if (payload.activity !== undefined) char.activity = payload.activity;
                    if (payload.physical_condition !== undefined) char.physical_condition = payload.physical_condition;
                    if (payload.runtime_state !== undefined) {
                        char.runtime_state = deepMerge(char.runtime_state, payload.runtime_state);
                    }
                }
            }
            break;
        }

        case EVENT_TYPES.EMOTE: {
            const actorId = event.actor_character_id;
            if (actorId && (payload.emotion || payload.dominant_emotion)) {
                const normalized = normalizeEmotionInput(payload.emotion || payload);
                state.emotions[actorId] = {
                    ...(state.emotions[actorId] || {}),
                    ...normalized,
                    last_updated_time: event.fictional_time,
                    updated_at: event.created_at,
                };
            }
            break;
        }

        case EVENT_TYPES.REST:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'resting';
            }
            break;

        case EVENT_TYPES.WORK:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = payload.activity || 'working';
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
            lws_id: null,
            status: 'unknown',
            current_fictional_time: null,
            settings: {},
            deleted_at: null,
        },
        characters: {},
        scheduled_events: {},
        knowledge: {},
        memories: {},
        beliefs: {},
        cameras: {},
        needs: {},
        goals: {},
        intentions: {},
        values: {},
        emotions: {},
    };

    return events.reduce(simulationReducer, initialState);
}

/**
 * Verifies 100% canonical replay parity between pure in-memory event folding
 * and the projected SQLite database rows.
 *
 * @param {string} simLwsId
 * @returns {{ verified: boolean, event_count: number, character_count: number, scheduled_event_count: number, drift_detected: boolean }}
 */
export function verifySimulationParity(simLwsId) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    // 1. Fetch events from database
    const events = listEvents(simLwsId, { unlimited: true });

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

    // 6. Compare Cameras
    const dbCameras = db.prepare(`
        SELECT cam.*,
               sc.lws_id AS target_character_lws_id,
               loc.lws_id AS target_location_lws_id
        FROM lws_simulation_cameras cam
        LEFT JOIN lws_simulation_characters sc ON cam.target_character_id = sc.id
        LEFT JOIN lws_locations loc ON cam.target_location_id = loc.id
        WHERE cam.simulation_id = ?
    `).all(sim.id);

    for (const dbCam of dbCameras) {
        const repCam = replayed.cameras[dbCam.camera_name];
        if (repCam) {
            if (repCam.mode !== dbCam.mode) {
                throw new Error(`Camera ${dbCam.camera_name} mode drift: replayed=${repCam.mode}, db=${dbCam.mode}`);
            }
            if (repCam.target_character_lws_id !== (dbCam.target_character_lws_id || null)) {
                throw new Error(`Camera ${dbCam.camera_name} target_character drift`);
            }
            if (repCam.target_location_lws_id !== (dbCam.target_location_lws_id || null)) {
                throw new Error(`Camera ${dbCam.camera_name} target_location drift`);
            }
        }
    }

    // 7. Compare Needs (Phase 7)
    const dbNeeds = db.prepare(`
        SELECT n.*, sc.lws_id AS char_lws_id
        FROM lws_character_needs n
        JOIN lws_simulation_characters sc ON n.simulation_character_id = sc.id
        WHERE n.simulation_id = ?
    `).all(sim.id);

    for (const dn of dbNeeds) {
        const charNeeds = replayed.needs[dn.char_lws_id];
        if (!charNeeds || !charNeeds[dn.need_name]) {
            throw new Error(`Character ${dn.char_lws_id} need ${dn.need_name} missing in replayed state`);
        }
        const rn = charNeeds[dn.need_name];
        if (rn.satisfaction !== dn.satisfaction) {
            throw new Error(`Character ${dn.char_lws_id} need ${dn.need_name} satisfaction drift: replayed=${rn.satisfaction}, db=${dn.satisfaction}`);
        }
        if (rn.decay_rate !== dn.decay_rate) {
            throw new Error(`Character ${dn.char_lws_id} need ${dn.need_name} decay_rate drift: replayed=${rn.decay_rate}, db=${dn.decay_rate}`);
        }
    }

    // 8. Compare Values (Phase 7)
    const dbValues = db.prepare(`
        SELECT v.*, sc.lws_id AS char_lws_id
        FROM lws_character_values v
        JOIN lws_simulation_characters sc ON v.simulation_character_id = sc.id
        WHERE v.simulation_id = ?
    `).all(sim.id);

    for (const dv of dbValues) {
        const charVals = replayed.values[dv.char_lws_id];
        if (!charVals || !charVals[dv.dimension]) {
            throw new Error(`Character ${dv.char_lws_id} value ${dv.dimension} missing in replayed state`);
        }
        const rv = charVals[dv.dimension];
        if (rv.strength !== dv.strength) {
            throw new Error(`Character ${dv.char_lws_id} value ${dv.dimension} strength drift: replayed=${rv.strength}, db=${dv.strength}`);
        }
    }

    // 9. Compare Emotions (Phase 7)
    const dbEmotions = db.prepare(`
        SELECT e.*, sc.lws_id AS char_lws_id
        FROM lws_character_emotions e
        JOIN lws_simulation_characters sc ON e.simulation_character_id = sc.id
        WHERE e.simulation_id = ?
    `).all(sim.id);

    for (const de of dbEmotions) {
        const re = replayed.emotions[de.char_lws_id];
        if (!re) {
            throw new Error(`Character ${de.char_lws_id} emotion missing in replayed state`);
        }
        if (re.dominant_emotion !== de.dominant_emotion) {
            throw new Error(`Character ${de.char_lws_id} emotion dominant_emotion drift: replayed=${re.dominant_emotion}, db=${de.dominant_emotion}`);
        }
        if (re.intensity !== de.intensity) {
            throw new Error(`Character ${de.char_lws_id} emotion intensity drift: replayed=${re.intensity}, db=${de.intensity}`);
        }
        if (re.arousal !== de.arousal) {
            throw new Error(`Character ${de.char_lws_id} emotion arousal drift: replayed=${re.arousal}, db=${de.arousal}`);
        }
        if (re.valence !== de.valence) {
            throw new Error(`Character ${de.char_lws_id} emotion valence drift: replayed=${re.valence}, db=${de.valence}`);
        }
    }

    // 10. Compare Intentions (Phase 7 Option B)
    const dbIntentions = db.prepare(`
        SELECT i.*, sc.lws_id AS char_lws_id, g.lws_id AS goal_lws_id
        FROM lws_character_intentions i
        JOIN lws_simulation_characters sc ON i.simulation_character_id = sc.id
        LEFT JOIN lws_character_goals g ON i.goal_id = g.id
        WHERE i.simulation_id = ?
    `).all(sim.id);

    for (const di of dbIntentions) {
        const charIntentions = replayed.intentions[di.char_lws_id] || {};
        const ri = charIntentions[di.lws_id];
        if (!ri) {
            throw new Error(`Intention ${di.lws_id} missing in replayed state`);
        }
        if (ri.action_type !== di.action_type) {
            throw new Error(`Intention ${di.lws_id} action_type drift: replayed=${ri.action_type}, db=${di.action_type}`);
        }
        if (ri.status !== di.status) {
            throw new Error(`Intention ${di.lws_id} status drift: replayed=${ri.status}, db=${di.status}`);
        }
        if (ri.target_entity_type !== di.target_entity_type) {
            throw new Error(`Intention ${di.lws_id} target_entity_type drift: replayed=${ri.target_entity_type}, db=${di.target_entity_type}`);
        }
        if ((ri.target_entity_id || null) !== (di.target_entity_id || null)) {
            throw new Error(`Intention ${di.lws_id} target_entity_id drift: replayed=${ri.target_entity_id}, db=${di.target_entity_id}`);
        }
        if (ri.priority !== di.priority) {
            throw new Error(`Intention ${di.lws_id} priority drift: replayed=${ri.priority}, db=${di.priority}`);
        }
        if ((ri.failure_reason || null) !== (di.failure_reason || null)) {
            throw new Error(`Intention ${di.lws_id} failure_reason drift: replayed=${ri.failure_reason}, db=${di.failure_reason}`);
        }
        if ((ri.cancellation_reason || null) !== (di.cancellation_reason || null)) {
            throw new Error(`Intention ${di.lws_id} cancellation_reason drift: replayed=${ri.cancellation_reason}, db=${di.cancellation_reason}`);
        }
    }

    return {
        verified: true,
        parity_matched: true,
        differences: [],
        event_count: events.length,
        character_count: charCount,
        scheduled_event_count: replayedSchedCount,
        drift_detected: false,
    };
}
