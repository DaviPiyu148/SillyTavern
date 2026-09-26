import { getDb } from '../db.js';
import { safeJsonParse, ensureActiveSimulation } from '../simulations/common.js';
import { generateDeterministicUuid } from '../authored/common.js';
import { deepMerge, EVENT_TYPES } from './taxonomy.js';
import { listEvents } from './events.js';
import { NEED_NAMES } from '../cognition/needs.js';
import { VALUE_DIMENSIONS } from '../cognition/values.js';
import { normalizeEmotionInput } from '../cognition/emotions.js';
import { calculateFamiliarityDecay, clamp } from '../social/common.js';
import { calculateDiurnalTemperature, calculateDiurnalLighting, evaluateOperatingHours } from '../environment/common.js';

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
    const simLwsId = event.simulation_id || state.simulation?.lws_id;
    if (state.simulation && simLwsId && !state.simulation.lws_id) {
        state.simulation.lws_id = simLwsId;
    }

    state.characters = state.characters || {};
    state.scheduled_events = state.scheduled_events || {};
    state.knowledge = state.knowledge || {};
    state.memories = state.memories || {};
    state.beliefs = state.beliefs || {};
    state.cameras = state.cameras || {};
    state.needs = state.needs || {};
    state.goals = state.goals || {};
    state.intentions = state.intentions || {};
    state.values = state.values || {};
    state.emotions = state.emotions || {};
    state.relationships = state.relationships || {};
    state.relationshipEvidence = state.relationshipEvidence || [];
    state.socialInformation = state.socialInformation || {};
    state.factionMemberships = state.factionMemberships || {};
    state.developmentRecords = state.developmentRecords || [];
    state.characterTiers = state.characterTiers || {};
    state.promotedEntities = state.promotedEntities || {};
    state.locationEnvironments = state.locationEnvironments || {};
    state.locationOperationalStates = state.locationOperationalStates || {};

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

            if (Array.isArray(payload.authored_snapshot?.factions)) {
                for (const f of payload.authored_snapshot.factions) {
                    const fLwsId = f.faction_lws_id || f.lws_id || f.faction_id;
                    const memLwsId = generateDeterministicUuid('faction_membership', simLwsId, charLwsId, fLwsId);
                    state.factionMemberships[`${charLwsId}:${fLwsId}`] = {
                        lws_id: memLwsId,
                        simulation_character_lws_id: charLwsId,
                        faction_lws_id: fLwsId,
                        rank_role: f.role || 'member',
                        standing: 0,
                        loyalty_score: 50,
                        membership_status: 'active',
                        joined_fictional_time: event.fictional_time,
                    };
                }
            }

            // Phase 9: Record character tier and promotion record
            const targetTier = payload.tier || payload.promotion?.promoted_to_tier || 'core';
            const isPromoted = Boolean(payload.promotion || payload.runtime_state?.is_promoted || payload.is_promoted);
            state.characterTiers[charLwsId] = {
                lws_id: generateDeterministicUuid('tier', simLwsId, charLwsId),
                simulation_id: simLwsId,
                simulation_character_id: charLwsId,
                tier: targetTier,
                cognitive_budget: targetTier === 'core' ? 'full' : 'lightweight',
                is_promoted: isPromoted ? 1 : 0,
            };

            if (payload.promotion) {
                const promo = payload.promotion;
                const promoKey = promo.source_transient_id || charLwsId;
                state.promotedEntities[promoKey] = {
                    lws_id: generateDeterministicUuid('promoted_record', simLwsId, charLwsId),
                    simulation_id: simLwsId,
                    simulation_character_id: charLwsId,
                    source_archetype_key: promo.source_archetype_key || 'unknown',
                    source_transient_id: promo.source_transient_id,
                    origin_location_id: event.location_id,
                    promotion_reason: promo.promotion_reason || 'direct_interaction',
                    causal_event_id: event.causal_event_id,
                    promoted_to_tier: targetTier,
                    fictional_time: event.fictional_time,
                };
            }
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
            if (payload.cognition?.create_goal && actorId) {
                const cg = payload.cognition.create_goal;
                state.goals[actorId] = state.goals[actorId] || {};
                state.goals[actorId][cg.lws_id] = {
                    lws_id: cg.lws_id,
                    simulation_id: simLwsId,
                    simulation_character_id: actorId,
                    client_goal_key: cg.client_goal_key ?? null,
                    title: cg.title,
                    description: cg.description || '',
                    goal_type: cg.goal_type || 'short_term',
                    status: cg.status || 'active',
                    priority: cg.priority ?? 50,
                    urgency: cg.urgency ?? 50,
                    progress: cg.progress ?? 0,
                    objective_action_type: cg.objective_action_type ?? null,
                    target_location_id: cg.target_location_id ?? null,
                    target_character_id: cg.target_character_id ?? null,
                    target_object_id: cg.target_object_id ?? null,
                    deadline_fictional_time: cg.deadline_fictional_time ?? null,
                    causal_event_id: cg.causal_event_id ?? null,
                    created_at: event.created_at,
                    updated_at: event.created_at,
                    deleted_at: null,
                };
            }
            if (payload.cognition?.update_goal && actorId) {
                const ug = payload.cognition.update_goal;
                const goalId = ug.goal_lws_id || ug.lws_id;
                state.goals[actorId] = state.goals[actorId] || {};
                if (state.goals[actorId][goalId]) {
                    const goal = state.goals[actorId][goalId];
                    if (ug.deleted_at || ug.is_deleted === true) {
                        goal.deleted_at = event.created_at;
                        if (goal.status !== 'completed') {
                            goal.status = 'abandoned';
                        }
                        if (state.intentions?.[actorId]) {
                            for (const intention of Object.values(state.intentions[actorId])) {
                                if (String(intention.goal_id) === String(goalId) && (intention.status === 'active' || intention.status === 'executing')) {
                                    intention.status = 'cancelled';
                                    intention.cancellation_reason = 'goal_deleted';
                                    intention.updated_at = event.created_at;
                                }
                            }
                        }
                    } else {
                        if (ug.title !== undefined) goal.title = ug.title;
                        if (ug.description !== undefined) goal.description = ug.description;
                        if (ug.priority !== undefined) goal.priority = ug.priority;
                        if (ug.urgency !== undefined) goal.urgency = ug.urgency;
                        if (ug.progress !== undefined) goal.progress = ug.progress;
                        if (ug.deadline_fictional_time !== undefined) goal.deadline_fictional_time = ug.deadline_fictional_time;
                        if (ug.status !== undefined) {
                            goal.status = ug.status;
                            if (ug.status === 'completed') {
                                if (ug.progress === undefined) goal.progress = 100;
                                if (state.intentions?.[actorId]) {
                                    for (const intention of Object.values(state.intentions[actorId])) {
                                        if (String(intention.goal_id) === String(goalId) && (intention.status === 'active' || intention.status === 'executing')) {
                                            intention.status = 'cancelled';
                                            intention.cancellation_reason = 'goal_completed';
                                            intention.updated_at = event.created_at;
                                        }
                                    }
                                }
                            } else if (ug.status === 'abandoned') {
                                if (state.intentions?.[actorId]) {
                                    for (const intention of Object.values(state.intentions[actorId])) {
                                        if (String(intention.goal_id) === String(goalId) && (intention.status === 'active' || intention.status === 'executing')) {
                                            intention.status = 'cancelled';
                                            intention.cancellation_reason = 'goal_abandoned';
                                            intention.updated_at = event.created_at;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    goal.updated_at = event.created_at;
                }
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

            if (payload.social || payload.social_state) {
                const soc = payload.social || payload.social_state;
                if (soc.relationship_update && actorId) {
                    const r = soc.relationship_update;
                    const tgtId = r.target_character_id || r.target_id || r.target_character_lws_id;
                    if (tgtId) {
                        const relKey = `${actorId}:${tgtId}`;
                        const existingRel = state.relationships[relKey] || {
                            lws_id: generateDeterministicUuid('relationship', simLwsId, actorId, tgtId),
                            source_character_lws_id: actorId,
                            target_character_lws_id: tgtId,
                            trust: 0,
                            affection: 0,
                            familiarity: 0,
                            respect: 0,
                            loyalty: 0,
                            last_interaction_fictional_time: null,
                        };
                        const d = r.delta || r;
                        const prevTrust = existingRel.trust;
                        const prevAff = existingRel.affection;
                        const prevFam = existingRel.familiarity;
                        const prevResp = existingRel.respect;
                        const prevLoy = existingRel.loyalty;

                        existingRel.trust = clamp(existingRel.trust + (d.delta_trust ?? d.trust ?? 0), -100, 100);
                        existingRel.affection = clamp(existingRel.affection + (d.delta_affection ?? d.affection ?? 0), -100, 100);
                        existingRel.familiarity = clamp(existingRel.familiarity + (d.delta_familiarity ?? d.familiarity ?? 0), 0, 100);
                        existingRel.respect = clamp(existingRel.respect + (d.delta_respect ?? d.respect ?? 0), -100, 100);
                        existingRel.loyalty = clamp(existingRel.loyalty + (d.delta_loyalty ?? d.loyalty ?? 0), -100, 100);
                        existingRel.last_interaction_fictional_time = event.fictional_time;
                        state.relationships[relKey] = existingRel;

                        const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, actorId, tgtId, String(existingRel.familiarity - prevFam));
                        state.relationshipEvidence.push({
                            lws_id: evLwsId,
                            relationship_lws_id: existingRel.lws_id,
                            source_character_lws_id: actorId,
                            target_character_lws_id: tgtId,
                            causal_event_lws_id: event.lws_id,
                            fictional_time: event.fictional_time,
                            delta_trust: existingRel.trust - prevTrust,
                            delta_affection: existingRel.affection - prevAff,
                            delta_familiarity: existingRel.familiarity - prevFam,
                            delta_respect: existingRel.respect - prevResp,
                            delta_loyalty: existingRel.loyalty - prevLoy,
                            interaction_type: r.interaction_type || 'update',
                            narrative_rationale: r.narrative_rationale || '',
                        });
                    }
                }
                if (soc.rumor_update) {
                    const ru = soc.rumor_update;
                    const infoLwsId = generateDeterministicUuid('social_info', simLwsId, ru.root_social_information_id || ru.subject_key, ru.transmitter_character_id || 'orig', ru.recipient_character_id || 'all', event.lws_id);
                    state.socialInformation[infoLwsId] = {
                        lws_id: infoLwsId,
                        parent_social_information_lws_id: ru.parent_social_information_id || null,
                        root_social_information_lws_id: (ru.transmission_depth === 0) ? infoLwsId : (ru.root_social_information_id || infoLwsId),
                        originator_character_lws_id: ru.originator_character_id || null,
                        transmitter_character_lws_id: ru.transmitter_character_id || null,
                        recipient_character_lws_id: ru.recipient_character_id || null,
                        causal_event_lws_id: event.lws_id,
                        subject_key: ru.subject_key,
                        topic: ru.topic,
                        claim_statement: ru.claim_statement,
                        veracity: ru.veracity || 'unknown',
                        ground_truth_event_lws_id: ru.ground_truth_event_id || null,
                        distortion_level: ru.distortion_level ?? 0,
                        transmission_depth: ru.transmission_depth ?? 0,
                        confidence_score: ru.confidence_score ?? 50,
                        fictional_time: event.fictional_time,
                    };
                }
                if (soc.faction_membership_update && actorId) {
                    const f = soc.faction_membership_update;
                    const memKey = `${actorId}:${f.faction_id}`;
                    if (state.factionMemberships[memKey]) {
                        const m = state.factionMemberships[memKey];
                        if (f.rank_role !== undefined) m.rank_role = f.rank_role;
                        if (f.standing !== undefined) m.standing = clamp(Math.round(f.standing), -100, 100);
                        if (f.loyalty_score !== undefined) m.loyalty_score = clamp(Math.round(f.loyalty_score), -100, 100);
                        if (f.membership_status !== undefined) m.membership_status = f.membership_status;
                        if (f.delta_standing !== undefined) m.standing = clamp(m.standing + Math.round(f.delta_standing), -100, 100);
                        if (f.delta_loyalty !== undefined) m.loyalty_score = clamp(m.loyalty_score + Math.round(f.delta_loyalty), -100, 100);
                    }
                }
                if (soc.development_record && actorId) {
                    const d = soc.development_record;
                    const devLwsId = generateDeterministicUuid('dev_record', simLwsId, actorId, d.dimension_key, Array.isArray(d.causal_event_ids) ? d.causal_event_ids[0] : event.fictional_time);
                    state.developmentRecords.push({
                        lws_id: devLwsId,
                        simulation_character_lws_id: actorId,
                        dimension_category: d.dimension_category,
                        dimension_key: d.dimension_key,
                        previous_value: d.previous_value ?? 0,
                        new_value: d.new_value ?? 0,
                        delta: d.delta !== undefined ? d.delta : ((d.new_value ?? 0) - (d.previous_value ?? 0)),
                        trigger_category: d.trigger_category,
                        causal_event_ids: Array.isArray(d.causal_event_ids) ? d.causal_event_ids : (typeof d.causal_event_ids === 'string' ? safeJsonParse(d.causal_event_ids, []) : []),
                        stability: d.stability ?? 50,
                        fictional_time: event.fictional_time,
                    });

                    // Project into in-memory state
                    if (d.dimension_category === 'value_shift') {
                        state.values[actorId] = state.values[actorId] || {};
                        state.values[actorId][d.dimension_key] = {
                            lws_id: generateDeterministicUuid('value', simLwsId, actorId, d.dimension_key),
                            dimension: d.dimension_key,
                            strength: Math.round(d.new_value),
                        };
                    } else if (d.dimension_category === 'baseline_need_shift') {
                        state.needs[actorId] = state.needs[actorId] || {};
                        if (state.needs[actorId][d.dimension_key]) {
                            state.needs[actorId][d.dimension_key].decay_rate = Math.round(d.new_value);
                        }
                    } else if (d.dimension_category === 'disposition_shift' || d.dimension_category === 'habit_shift') {
                        if (state.characters[actorId]) {
                            const sec = d.dimension_category === 'disposition_shift' ? 'dispositions' : 'habits';
                            state.characters[actorId].runtime_state[sec] = state.characters[actorId].runtime_state[sec] || {};
                            state.characters[actorId].runtime_state[sec][d.dimension_key] = d.new_value;
                        }
                    }
                }
            }

            // Phase 9: Tier elevation handling
            if (actorId && (payload.tier_elevation || payload.tier)) {
                const nextTier = payload.tier_elevation || payload.tier;
                if (nextTier === 'core' && state.characterTiers[actorId]) {
                    state.characterTiers[actorId].tier = 'core';
                    state.characterTiers[actorId].cognitive_budget = 'full';
                }
            }

            // Phase 9: Environment updates
            if (payload.environment && event.location_id) {
                const locId = event.location_id;
                const env = state.locationEnvironments[locId] || {
                    lws_id: generateDeterministicUuid('loc_env', simLwsId, locId),
                    simulation_id: simLwsId,
                    location_id: locId,
                    weather: 'clear',
                    temperature_baseline: 20.0,
                    temperature_celsius: 20.0,
                    temperature_override: null,
                    lighting_level: 'normal',
                    lighting_override: null,
                    noise_level: 20,
                    is_indoor: 0,
                    air_quality: 'clean',
                    hazards: [],
                    last_evaluated_fictional_time: event.fictional_time,
                };
                const patch = payload.environment;
                if (patch.weather !== undefined) env.weather = patch.weather;
                if (patch.temperature_baseline !== undefined) env.temperature_baseline = patch.temperature_baseline;
                if (patch.temperature_override !== undefined) env.temperature_override = patch.temperature_override;
                if (patch.lighting_override !== undefined) env.lighting_override = patch.lighting_override;
                if (patch.noise_level !== undefined) env.noise_level = patch.noise_level;
                if (patch.is_indoor !== undefined) env.is_indoor = patch.is_indoor ? 1 : 0;
                if (patch.air_quality !== undefined) env.air_quality = patch.air_quality;
                if (patch.hazards !== undefined) env.hazards = Array.isArray(patch.hazards) ? patch.hazards : (typeof patch.hazards === 'string' ? safeJsonParse(patch.hazards, []) : []);

                env.temperature_celsius = env.temperature_override !== null
                    ? env.temperature_override
                    : calculateDiurnalTemperature(event.fictional_time, env.temperature_baseline ?? 20.0, Boolean(env.is_indoor));
                env.lighting_level = env.lighting_override !== null
                    ? env.lighting_override
                    : calculateDiurnalLighting(event.fictional_time, Boolean(env.is_indoor), false, env.weather);
                env.last_evaluated_fictional_time = event.fictional_time;
                state.locationEnvironments[locId] = env;
            }

            // Phase 9: Operational state updates
            if (payload.operational_state && event.location_id) {
                const locId = event.location_id;
                const ops = state.locationOperationalStates[locId] || {
                    lws_id: generateDeterministicUuid('loc_ops', simLwsId, locId),
                    simulation_id: simLwsId,
                    location_id: locId,
                    access_status: 'open',
                    access_override: null,
                    operating_hours: null,
                    crowd_density: 'moderate',
                    ambient_capacity: 50,
                };
                const patch = payload.operational_state;
                if (patch.access_override !== undefined) ops.access_override = patch.access_override;
                if (patch.operating_hours !== undefined) ops.operating_hours = typeof patch.operating_hours === 'object' ? patch.operating_hours : safeJsonParse(patch.operating_hours, null);
                if (patch.crowd_density !== undefined) ops.crowd_density = patch.crowd_density;
                if (patch.ambient_capacity !== undefined) ops.ambient_capacity = patch.ambient_capacity;

                if (ops.access_override !== null) {
                    ops.access_status = ops.access_override;
                } else if (ops.operating_hours) {
                    ops.access_status = evaluateOperatingHours(event.fictional_time, ops.operating_hours);
                } else if (patch.access_status !== undefined) {
                    ops.access_status = patch.access_status;
                }
                state.locationOperationalStates[locId] = ops;
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

            // 4. Directional Relationships (Phase 8)
            if (actorId && targetId && payload.relationship_delta) {
                const d = payload.relationship_delta;
                const relKey = `${actorId}:${targetId}`;
                const existingRel = state.relationships[relKey] || {
                    lws_id: generateDeterministicUuid('relationship', simLwsId, actorId, targetId),
                    source_character_lws_id: actorId,
                    target_character_lws_id: targetId,
                    trust: 0,
                    affection: 0,
                    familiarity: 0,
                    respect: 0,
                    loyalty: 0,
                    last_interaction_fictional_time: null,
                };
                const prevTrust = existingRel.trust;
                const prevAff = existingRel.affection;
                const prevFam = existingRel.familiarity;
                const prevResp = existingRel.respect;
                const prevLoy = existingRel.loyalty;

                existingRel.trust = clamp(existingRel.trust + (d.delta_trust ?? d.trust ?? 0), -100, 100);
                existingRel.affection = clamp(existingRel.affection + (d.delta_affection ?? d.affection ?? 0), -100, 100);
                existingRel.familiarity = clamp(existingRel.familiarity + (d.delta_familiarity ?? d.familiarity ?? 0), 0, 100);
                existingRel.respect = clamp(existingRel.respect + (d.delta_respect ?? d.respect ?? 0), -100, 100);
                existingRel.loyalty = clamp(existingRel.loyalty + (d.delta_loyalty ?? d.loyalty ?? 0), -100, 100);
                existingRel.last_interaction_fictional_time = event.fictional_time;
                state.relationships[relKey] = existingRel;

                const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, actorId, targetId, String(existingRel.familiarity - prevFam));
                state.relationshipEvidence.push({
                    lws_id: evLwsId,
                    relationship_lws_id: existingRel.lws_id,
                    source_character_lws_id: actorId,
                    target_character_lws_id: targetId,
                    causal_event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    delta_trust: existingRel.trust - prevTrust,
                    delta_affection: existingRel.affection - prevAff,
                    delta_familiarity: existingRel.familiarity - prevFam,
                    delta_respect: existingRel.respect - prevResp,
                    delta_loyalty: existingRel.loyalty - prevLoy,
                    interaction_type: 'communication',
                    narrative_rationale: d.narrative_rationale || d.rationale || 'Conversation interaction',
                });

                if (d.reverse) {
                    const revKey = `${targetId}:${actorId}`;
                    const existingRev = state.relationships[revKey] || {
                        lws_id: generateDeterministicUuid('relationship', simLwsId, targetId, actorId),
                        source_character_lws_id: targetId,
                        target_character_lws_id: actorId,
                        trust: 0,
                        affection: 0,
                        familiarity: 0,
                        respect: 0,
                        loyalty: 0,
                        last_interaction_fictional_time: null,
                    };
                    const rPrevTrust = existingRev.trust;
                    const rPrevAff = existingRev.affection;
                    const rPrevFam = existingRev.familiarity;
                    const rPrevResp = existingRev.respect;
                    const rPrevLoy = existingRev.loyalty;

                    existingRev.trust = clamp(existingRev.trust + (d.reverse.delta_trust ?? d.reverse.trust ?? 0), -100, 100);
                    existingRev.affection = clamp(existingRev.affection + (d.reverse.delta_affection ?? d.reverse.affection ?? 0), -100, 100);
                    existingRev.familiarity = clamp(existingRev.familiarity + (d.reverse.delta_familiarity ?? d.reverse.familiarity ?? 0), 0, 100);
                    existingRev.respect = clamp(existingRev.respect + (d.reverse.delta_respect ?? d.reverse.respect ?? 0), -100, 100);
                    existingRev.loyalty = clamp(existingRev.loyalty + (d.reverse.delta_loyalty ?? d.reverse.loyalty ?? 0), -100, 100);
                    existingRev.last_interaction_fictional_time = event.fictional_time;
                    state.relationships[revKey] = existingRev;

                    const revEvLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, targetId, actorId, String(existingRev.familiarity - rPrevFam));
                    state.relationshipEvidence.push({
                        lws_id: revEvLwsId,
                        relationship_lws_id: existingRev.lws_id,
                        source_character_lws_id: targetId,
                        target_character_lws_id: actorId,
                        causal_event_lws_id: event.lws_id,
                        fictional_time: event.fictional_time,
                        delta_trust: existingRev.trust - rPrevTrust,
                        delta_affection: existingRev.affection - rPrevAff,
                        delta_familiarity: existingRev.familiarity - rPrevFam,
                        delta_respect: existingRev.respect - rPrevResp,
                        delta_loyalty: existingRev.loyalty - rPrevLoy,
                        interaction_type: 'communication',
                        narrative_rationale: d.reverse.narrative_rationale || d.reverse.rationale || 'Conversation interaction',
                    });
                }
            }

            // 5. Rumors & Social Information (Phase 8)
            if (payload.rumor || payload.social_information) {
                const r = payload.rumor || payload.social_information;
                const depth = Number(r.transmission_depth ?? 0);
                const isRoot = depth === 0;
                const transId = isRoot ? null : (r.transmitter_character_id || r.transmitter_character_lws_id || actorId || null);
                const recipId = isRoot ? null : (r.recipient_character_id || r.recipient_character_lws_id || targetId || null);
                const infoLwsId = r.lws_id || generateDeterministicUuid(
                    'social_info',
                    simLwsId,
                    r.root_social_information_id || r.root_social_information_lws_id || r.subject_key,
                    transId || 'orig',
                    recipId || 'all',
                    event.lws_id,
                );
                const parentLwsId = r.parent_social_information_id || r.parent_social_information_lws_id || null;
                const rootLwsId = isRoot ? infoLwsId : (r.root_social_information_id || r.root_social_information_lws_id || infoLwsId);

                state.socialInformation[infoLwsId] = {
                    lws_id: infoLwsId,
                    parent_social_information_lws_id: parentLwsId,
                    root_social_information_lws_id: rootLwsId,
                    originator_character_lws_id: r.originator_character_id || r.originator_character_lws_id || (isRoot ? actorId : null),
                    transmitter_character_lws_id: transId,
                    recipient_character_lws_id: recipId,
                    causal_event_lws_id: event.lws_id,
                    subject_key: r.subject_key,
                    topic: r.topic,
                    claim_statement: r.claim_statement,
                    veracity: r.veracity || 'unknown',
                    ground_truth_event_lws_id: r.ground_truth_event_id || r.ground_truth_event_lws_id || null,
                    distortion_level: r.distortion_level ?? 0,
                    transmission_depth: depth,
                    confidence_score: r.confidence_score ?? 50,
                    fictional_time: event.fictional_time,
                };

                if (targetId && actorId) {
                    const rel = state.relationships[`${targetId}:${actorId}`];
                    const trust = rel?.trust ?? 0;
                    if (trust > -30) {
                        const cRumor = r.confidence_score ?? 50;
                        const scaledConfidence = clamp(Math.round(cRumor * ((trust + 100) / 200)), 1, 100);
                        const beliefType = scaledConfidence >= 70 ? 'belief' : 'suspicion';
                        const sourceBasis = 'hearsay';

                        const bLwsId = generateDeterministicUuid('belief', targetId, r.subject_key);
                        state.beliefs[targetId] = state.beliefs[targetId] || {};
                        state.beliefs[targetId][r.subject_key] = {
                            lws_id: bLwsId,
                            subject_key: r.subject_key,
                            statement: r.claim_statement,
                            belief_type: beliefType,
                            confidence: scaledConfidence,
                            source_basis: sourceBasis,
                            causal_event_id: event.lws_id,
                            deleted_at: null,
                        };
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
                } else if (payload.target === 'character_relationship') {
                    const srcId = payload.source_character_id || payload.source_id;
                    const tgtId = payload.target_character_id || payload.target_id;
                    if (srcId && tgtId) {
                        const relKey = `${srcId}:${tgtId}`;
                        const existingRel = state.relationships[relKey] || {
                            lws_id: generateDeterministicUuid('relationship', simLwsId, srcId, tgtId),
                            source_character_lws_id: srcId,
                            target_character_lws_id: tgtId,
                            trust: 0,
                            affection: 0,
                            familiarity: 0,
                            respect: 0,
                            loyalty: 0,
                            last_interaction_fictional_time: null,
                        };
                        const d = payload.delta || payload;
                        const prevTrust = existingRel.trust;
                        const prevAff = existingRel.affection;
                        const prevFam = existingRel.familiarity;
                        const prevResp = existingRel.respect;
                        const prevLoy = existingRel.loyalty;

                        existingRel.trust = clamp(existingRel.trust + (d.delta_trust ?? d.trust ?? 0), -100, 100);
                        existingRel.affection = clamp(existingRel.affection + (d.delta_affection ?? d.affection ?? 0), -100, 100);
                        existingRel.familiarity = clamp(existingRel.familiarity + (d.delta_familiarity ?? d.familiarity ?? 0), 0, 100);
                        existingRel.respect = clamp(existingRel.respect + (d.delta_respect ?? d.respect ?? 0), -100, 100);
                        existingRel.loyalty = clamp(existingRel.loyalty + (d.delta_loyalty ?? d.loyalty ?? 0), -100, 100);
                        existingRel.last_interaction_fictional_time = event.fictional_time;
                        state.relationships[relKey] = existingRel;

                        const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, srcId, tgtId, String(existingRel.familiarity - prevFam));
                        state.relationshipEvidence.push({
                            lws_id: evLwsId,
                            relationship_lws_id: existingRel.lws_id,
                            source_character_lws_id: srcId,
                            target_character_lws_id: tgtId,
                            causal_event_lws_id: event.lws_id,
                            fictional_time: event.fictional_time,
                            delta_trust: existingRel.trust - prevTrust,
                            delta_affection: existingRel.affection - prevAff,
                            delta_familiarity: existingRel.familiarity - prevFam,
                            delta_respect: existingRel.respect - prevResp,
                            delta_loyalty: existingRel.loyalty - prevLoy,
                            interaction_type: payload.interaction_type || 'director_override',
                            narrative_rationale: payload.narrative_rationale || 'Director relationship modification',
                        });
                    }
                } else if (payload.target === 'character_development' || payload.development_record || payload.social_state?.development_record) {
                    const devData = payload.development_record || payload.social_state?.development_record || payload;
                    const charId = targetCharId || event.actor_character_id;
                    if (charId) {
                        const devLwsId = generateDeterministicUuid('dev_record', simLwsId, charId, devData.dimension_key, event.lws_id);
                        state.developmentRecords.push({
                            lws_id: devLwsId,
                            simulation_character_lws_id: charId,
                            dimension_category: devData.dimension_category,
                            dimension_key: devData.dimension_key,
                            previous_value: devData.previous_value ?? 0,
                            new_value: devData.new_value ?? 0,
                            delta: devData.delta !== undefined ? devData.delta : ((devData.new_value ?? 0) - (devData.previous_value ?? 0)),
                            trigger_category: devData.trigger_category || 'director_override',
                            causal_event_ids: devData.causal_event_ids || [event.lws_id],
                            stability: devData.stability ?? 50,
                            fictional_time: event.fictional_time,
                        });

                        if (devData.dimension_category === 'value_shift') {
                            state.values[charId] = state.values[charId] || {};
                            state.values[charId][devData.dimension_key] = {
                                lws_id: generateDeterministicUuid('value', simLwsId, charId, devData.dimension_key),
                                dimension: devData.dimension_key,
                                strength: Math.round(devData.new_value),
                            };
                        } else if (devData.dimension_category === 'baseline_need_shift') {
                            state.needs[charId] = state.needs[charId] || {};
                            if (state.needs[charId][devData.dimension_key]) {
                                state.needs[charId][devData.dimension_key].decay_rate = Math.round(devData.new_value);
                            }
                        } else if (devData.dimension_category === 'disposition_shift' || devData.dimension_category === 'habit_shift') {
                            if (state.characters[charId]) {
                                const sec = devData.dimension_category === 'disposition_shift' ? 'dispositions' : 'habits';
                                state.characters[charId].runtime_state[sec] = state.characters[charId].runtime_state[sec] || {};
                                state.characters[charId].runtime_state[sec][devData.dimension_key] = devData.new_value;
                            }
                        }
                    }
                } else if (payload.target === 'faction_membership') {
                    const charId = targetCharId || event.actor_character_id;
                    if (charId && payload.faction_id) {
                        const memKey = `${charId}:${payload.faction_id}`;
                        if (state.factionMemberships[memKey]) {
                            const m = state.factionMemberships[memKey];
                            if (payload.rank_role !== undefined) m.rank_role = payload.rank_role;
                            if (payload.standing !== undefined) m.standing = clamp(Math.round(payload.standing), -100, 100);
                            if (payload.loyalty_score !== undefined) m.loyalty_score = clamp(Math.round(payload.loyalty_score), -100, 100);
                            if (payload.membership_status !== undefined) m.membership_status = payload.membership_status;
                        }
                    }
                } else if (payload.target === 'social_information' || payload.rumor) {
                    const r = payload.rumor || payload;
                    const infoLwsId = generateDeterministicUuid('social_info', simLwsId, r.root_social_information_id || r.subject_key, r.transmitter_character_id || 'orig', r.recipient_character_id || 'all', event.lws_id);
                    state.socialInformation[infoLwsId] = {
                        lws_id: infoLwsId,
                        parent_social_information_lws_id: r.parent_social_information_id || null,
                        root_social_information_lws_id: (r.transmission_depth === 0) ? infoLwsId : (r.root_social_information_id || infoLwsId),
                        originator_character_lws_id: r.originator_character_id || null,
                        transmitter_character_lws_id: r.transmitter_character_id || null,
                        recipient_character_lws_id: r.recipient_character_id || null,
                        causal_event_lws_id: event.lws_id,
                        subject_key: r.subject_key,
                        topic: r.topic,
                        claim_statement: r.claim_statement,
                        veracity: r.veracity || 'unknown',
                        ground_truth_event_lws_id: r.ground_truth_event_id || null,
                        distortion_level: r.distortion_level ?? 0,
                        transmission_depth: r.transmission_depth ?? 0,
                        confidence_score: r.confidence_score ?? 50,
                        fictional_time: event.fictional_time,
                    };
                }

                if (state.characters[event.actor_character_id] && payload.target !== 'camera' && payload.target !== 'simulation' && payload.target !== 'character_knowledge' && payload.target !== 'character_belief' && payload.target !== 'character_memory' && payload.target !== 'character_needs' && payload.target !== 'character_value' && payload.target !== 'character_emotion' && payload.target !== 'character_goal' && payload.target !== 'character_relationship' && payload.target !== 'character_development' && payload.target !== 'faction_membership' && payload.target !== 'social_information' && !payload.beliefs && !payload.knowledge && !payload.facts && !payload.memories) {
                    const char = state.characters[event.actor_character_id];
                    if (event.location_id !== null && event.location_id !== undefined) char.current_location_id = event.location_id;
                    if (payload.activity !== undefined) char.activity = payload.activity;
                    if (payload.physical_condition !== undefined) char.physical_condition = payload.physical_condition;
                    if (payload.runtime_state !== undefined) {
                        char.runtime_state = deepMerge(char.runtime_state, payload.runtime_state);
                    }
                }
            }

            // Phase 9: Director Environment, Operational State, and Tier Overrides
            if (payload.target === 'location_environment' || payload.environment) {
                const locId = payload.location_id || payload.location_lws_id || event.location_id;
                if (locId) {
                    const env = state.locationEnvironments[locId] || {
                        lws_id: generateDeterministicUuid('loc_env', simLwsId, locId),
                        simulation_id: simLwsId,
                        location_id: locId,
                        weather: 'clear',
                        temperature_baseline: 20.0,
                        temperature_celsius: 20.0,
                        temperature_override: null,
                        lighting_level: 'normal',
                        lighting_override: null,
                        noise_level: 20,
                        is_indoor: 0,
                        air_quality: 'clean',
                        hazards: [],
                        last_evaluated_fictional_time: event.fictional_time,
                    };
                    const patch = payload.environment || payload;
                    if (patch.weather !== undefined) env.weather = patch.weather;
                    if (patch.temperature_baseline !== undefined) env.temperature_baseline = patch.temperature_baseline;
                    if (patch.temperature_override !== undefined) env.temperature_override = patch.temperature_override;
                    if (patch.lighting_override !== undefined) env.lighting_override = patch.lighting_override;
                    if (patch.noise_level !== undefined) env.noise_level = patch.noise_level;
                    if (patch.is_indoor !== undefined) env.is_indoor = patch.is_indoor ? 1 : 0;
                    if (patch.air_quality !== undefined) env.air_quality = patch.air_quality;
                    if (patch.hazards !== undefined) env.hazards = Array.isArray(patch.hazards) ? patch.hazards : (typeof patch.hazards === 'string' ? safeJsonParse(patch.hazards, []) : []);

                    env.temperature_celsius = env.temperature_override !== null
                        ? env.temperature_override
                        : calculateDiurnalTemperature(event.fictional_time, env.temperature_baseline ?? 20.0, Boolean(env.is_indoor));
                    env.lighting_level = env.lighting_override !== null
                        ? env.lighting_override
                        : calculateDiurnalLighting(event.fictional_time, Boolean(env.is_indoor), false, env.weather);
                    env.last_evaluated_fictional_time = event.fictional_time;
                    state.locationEnvironments[locId] = env;
                }
            }

            if (payload.target === 'location_operational_state' || payload.operational_state) {
                const locId = payload.location_id || payload.location_lws_id || event.location_id;
                if (locId) {
                    const ops = state.locationOperationalStates[locId] || {
                        lws_id: generateDeterministicUuid('loc_ops', simLwsId, locId),
                        simulation_id: simLwsId,
                        location_id: locId,
                        access_status: 'open',
                        access_override: null,
                        operating_hours: null,
                        crowd_density: 'moderate',
                        ambient_capacity: 50,
                    };
                    const patch = payload.operational_state || payload;
                    if (patch.access_override !== undefined) ops.access_override = patch.access_override;
                    if (patch.operating_hours !== undefined) ops.operating_hours = typeof patch.operating_hours === 'object' ? patch.operating_hours : safeJsonParse(patch.operating_hours, null);
                    if (patch.crowd_density !== undefined) ops.crowd_density = patch.crowd_density;
                    if (patch.ambient_capacity !== undefined) ops.ambient_capacity = patch.ambient_capacity;

                    if (ops.access_override !== null) {
                        ops.access_status = ops.access_override;
                    } else if (ops.operating_hours) {
                        ops.access_status = evaluateOperatingHours(event.fictional_time, ops.operating_hours);
                    } else if (patch.access_status !== undefined) {
                        ops.access_status = patch.access_status;
                    }
                    state.locationOperationalStates[locId] = ops;
                }
            }

            if ((payload.target === 'character_tier' || payload.tier_elevation || payload.tier) && targetCharId) {
                const nextTier = payload.tier_elevation || payload.tier || 'core';
                if (nextTier === 'core' && state.characterTiers[targetCharId]) {
                    state.characterTiers[targetCharId].tier = 'core';
                    state.characterTiers[targetCharId].cognitive_budget = 'full';
                }
            }
            break;
        }

        case EVENT_TYPES.TRANSFER_ITEM: {
            const actorId = event.actor_character_id;
            const targetId = event.target_character_id;
            if (actorId && targetId) {
                const impact = payload.relationship_impact || {
                    delta_affection: payload.delta_affection ?? 15,
                    delta_trust: payload.delta_trust ?? 10,
                    delta_loyalty: payload.delta_loyalty ?? 5,
                    delta_familiarity: payload.delta_familiarity ?? 10,
                };
                const relKey = `${targetId}:${actorId}`;
                const existingRel = state.relationships[relKey] || {
                    lws_id: generateDeterministicUuid('relationship', simLwsId, targetId, actorId),
                    source_character_lws_id: targetId,
                    target_character_lws_id: actorId,
                    trust: 0,
                    affection: 0,
                    familiarity: 0,
                    respect: 0,
                    loyalty: 0,
                    last_interaction_fictional_time: null,
                };
                const prevTrust = existingRel.trust;
                const prevAff = existingRel.affection;
                const prevFam = existingRel.familiarity;
                const prevResp = existingRel.respect;
                const prevLoy = existingRel.loyalty;

                existingRel.trust = clamp(existingRel.trust + (impact.delta_trust ?? 10), -100, 100);
                existingRel.affection = clamp(existingRel.affection + (impact.delta_affection ?? 15), -100, 100);
                existingRel.loyalty = clamp(existingRel.loyalty + (impact.delta_loyalty ?? 5), -100, 100);
                existingRel.familiarity = clamp(existingRel.familiarity + (impact.delta_familiarity ?? 10), 0, 100);
                existingRel.last_interaction_fictional_time = event.fictional_time;
                state.relationships[relKey] = existingRel;

                const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, targetId, actorId, String(existingRel.familiarity - prevFam));
                state.relationshipEvidence.push({
                    lws_id: evLwsId,
                    relationship_lws_id: existingRel.lws_id,
                    source_character_lws_id: targetId,
                    target_character_lws_id: actorId,
                    causal_event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    delta_trust: existingRel.trust - prevTrust,
                    delta_affection: existingRel.affection - prevAff,
                    delta_familiarity: existingRel.familiarity - prevFam,
                    delta_respect: existingRel.respect - prevResp,
                    delta_loyalty: existingRel.loyalty - prevLoy,
                    interaction_type: 'gift',
                    narrative_rationale: payload.narrative_rationale || 'Item transfer / gift',
                });
            }
            break;
        }

        case EVENT_TYPES.COMBAT_ACTION: {
            const actorId = event.actor_character_id;
            const targetId = event.target_character_id;
            if (actorId && targetId) {
                const impact = payload.relationship_impact || {
                    delta_affection: payload.delta_affection ?? -40,
                    delta_trust: payload.delta_trust ?? -50,
                    delta_respect: payload.delta_respect ?? 0,
                    delta_loyalty: payload.delta_loyalty ?? -30,
                };
                const relKey = `${targetId}:${actorId}`;
                const existingRel = state.relationships[relKey] || {
                    lws_id: generateDeterministicUuid('relationship', simLwsId, targetId, actorId),
                    source_character_lws_id: targetId,
                    target_character_lws_id: actorId,
                    trust: 0,
                    affection: 0,
                    familiarity: 0,
                    respect: 0,
                    loyalty: 0,
                    last_interaction_fictional_time: null,
                };
                const prevTrust = existingRel.trust;
                const prevAff = existingRel.affection;
                const prevFam = existingRel.familiarity;
                const prevResp = existingRel.respect;
                const prevLoy = existingRel.loyalty;

                existingRel.trust = clamp(existingRel.trust + (impact.delta_trust ?? -50), -100, 100);
                existingRel.affection = clamp(existingRel.affection + (impact.delta_affection ?? -40), -100, 100);
                existingRel.respect = clamp(existingRel.respect + (impact.delta_respect ?? 0), -100, 100);
                existingRel.loyalty = clamp(existingRel.loyalty + (impact.delta_loyalty ?? -30), -100, 100);
                existingRel.last_interaction_fictional_time = event.fictional_time;
                state.relationships[relKey] = existingRel;

                const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, targetId, actorId, '0');
                state.relationshipEvidence.push({
                    lws_id: evLwsId,
                    relationship_lws_id: existingRel.lws_id,
                    source_character_lws_id: targetId,
                    target_character_lws_id: actorId,
                    causal_event_lws_id: event.lws_id,
                    fictional_time: event.fictional_time,
                    delta_trust: existingRel.trust - prevTrust,
                    delta_affection: existingRel.affection - prevAff,
                    delta_familiarity: existingRel.familiarity - prevFam,
                    delta_respect: existingRel.respect - prevResp,
                    delta_loyalty: existingRel.loyalty - prevLoy,
                    interaction_type: 'combat',
                    narrative_rationale: payload.narrative_rationale || 'Hostile confrontation in combat',
                });
            }
            break;
        }

        case EVENT_TYPES.TIME_ADVANCE: {
            state.simulation.current_fictional_time = event.fictional_time;

            // Evaluate familiarity decay for relationships with last interaction > 7 days
            const currMs = new Date(event.fictional_time).getTime();
            for (const rel of Object.values(state.relationships)) {
                if (rel.last_interaction_fictional_time && rel.familiarity > 0) {
                    const lastMs = new Date(rel.last_interaction_fictional_time).getTime();
                    const deltaSeconds = Math.floor((currMs - lastMs) / 1000);
                    if (deltaSeconds > 604800) {
                        const nextFam = calculateFamiliarityDecay(rel.familiarity, deltaSeconds);
                        const deltaFam = nextFam - rel.familiarity;
                        if (deltaFam <= -1) {
                            rel.familiarity = nextFam;
                            const evLwsId = generateDeterministicUuid('rel_evidence', event.lws_id, rel.source_character_lws_id, rel.target_character_lws_id, String(deltaFam));
                            state.relationshipEvidence.push({
                                lws_id: evLwsId,
                                relationship_lws_id: rel.lws_id,
                                source_character_lws_id: rel.source_character_lws_id,
                                target_character_lws_id: rel.target_character_lws_id,
                                causal_event_lws_id: event.lws_id,
                                fictional_time: event.fictional_time,
                                delta_trust: 0,
                                delta_affection: 0,
                                delta_familiarity: deltaFam,
                                delta_respect: 0,
                                delta_loyalty: 0,
                                interaction_type: 'temporal_decay',
                                narrative_rationale: 'Familiarity decayed due to elapsed fictional time without interaction (> 7 days)',
                            });
                        }
                    }
                }
            }

            // Phase 9: Update diurnal environment temperature and lighting curves
            for (const env of Object.values(state.locationEnvironments)) {
                env.temperature_celsius = env.temperature_override !== null
                    ? env.temperature_override
                    : calculateDiurnalTemperature(event.fictional_time, env.temperature_baseline ?? 20.0, Boolean(env.is_indoor));
                env.lighting_level = env.lighting_override !== null
                    ? env.lighting_override
                    : calculateDiurnalLighting(event.fictional_time, Boolean(env.is_indoor), false, env.weather);
                env.last_evaluated_fictional_time = event.fictional_time;
            }

            // Phase 9: Update operational access states
            for (const ops of Object.values(state.locationOperationalStates)) {
                if (ops.access_override === null && ops.operating_hours) {
                    ops.access_status = evaluateOperatingHours(event.fictional_time, ops.operating_hours);
                }
            }
            break;
        }

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

        case EVENT_TYPES.TRAVEL:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'traveling';
            }
            break;

        case EVENT_TYPES.EAT:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'eating';
            }
            break;

        case EVENT_TYPES.SLEEP:
            if (state.characters[event.actor_character_id]) {
                state.characters[event.actor_character_id].activity = 'sleeping';
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
        relationships: {},
        relationshipEvidence: [],
        socialInformation: {},
        factionMemberships: {},
        developmentRecords: [],
        characterTiers: {},
        promotedEntities: {},
        locationEnvironments: {},
        locationOperationalStates: {},
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

    // 11. Compare Goals (Phase 7)
    const dbGoals = db.prepare(`
        SELECT g.*, sc.lws_id AS char_lws_id
        FROM lws_character_goals g
        JOIN lws_simulation_characters sc ON g.simulation_character_id = sc.id
        WHERE g.simulation_id = ?
    `).all(sim.id);

    for (const dg of dbGoals) {
        const charGoals = replayed.goals[dg.char_lws_id] || {};
        const rg = charGoals[dg.lws_id];
        if (!rg) {
            throw new Error(`Goal ${dg.lws_id} missing in replayed state`);
        }
        if (rg.title !== dg.title) {
            throw new Error(`Goal ${dg.lws_id} title drift: replayed=${rg.title}, db=${dg.title}`);
        }
        if (rg.status !== dg.status) {
            throw new Error(`Goal ${dg.lws_id} status drift: replayed=${rg.status}, db=${dg.status}`);
        }
        if (rg.priority !== dg.priority) {
            throw new Error(`Goal ${dg.lws_id} priority drift: replayed=${rg.priority}, db=${dg.priority}`);
        }
        if (rg.urgency !== dg.urgency) {
            throw new Error(`Goal ${dg.lws_id} urgency drift: replayed=${rg.urgency}, db=${dg.urgency}`);
        }
        if (rg.progress !== dg.progress) {
            throw new Error(`Goal ${dg.lws_id} progress drift: replayed=${rg.progress}, db=${dg.progress}`);
        }
        if ((rg.client_goal_key || null) !== (dg.client_goal_key || null)) {
            throw new Error(`Goal ${dg.lws_id} client_goal_key drift: replayed=${rg.client_goal_key}, db=${dg.client_goal_key}`);
        }
        if (rg.goal_type !== dg.goal_type) {
            throw new Error(`Goal ${dg.lws_id} goal_type drift: replayed=${rg.goal_type}, db=${dg.goal_type}`);
        }
        if ((rg.deleted_at ? new Date(rg.deleted_at).toISOString() : null) !== (dg.deleted_at ? new Date(dg.deleted_at).toISOString() : null)) {
            throw new Error(`Goal ${dg.lws_id} deleted_at drift: replayed=${rg.deleted_at}, db=${dg.deleted_at}`);
        }
    }

    // 12. Compare Relationships (Phase 8)
    const dbRels = db.prepare(`
        SELECT r.*, sc1.lws_id AS source_char_lws_id, sc2.lws_id AS target_char_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulation_characters sc1 ON r.source_character_id = sc1.id
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ?
    `).all(sim.id);

    for (const dr of dbRels) {
        const relKey = `${dr.source_char_lws_id}:${dr.target_char_lws_id}`;
        const rr = replayed.relationships[relKey];
        if (!rr) {
            throw new Error(`Relationship ${relKey} missing in replayed state`);
        }
        if (rr.trust !== dr.trust) {
            throw new Error(`Relationship ${relKey} trust drift: replayed=${rr.trust}, db=${dr.trust}`);
        }
        if (rr.affection !== dr.affection) {
            throw new Error(`Relationship ${relKey} affection drift: replayed=${rr.affection}, db=${dr.affection}`);
        }
        if (rr.familiarity !== dr.familiarity) {
            throw new Error(`Relationship ${relKey} familiarity drift: replayed=${rr.familiarity}, db=${dr.familiarity}`);
        }
        if (rr.respect !== dr.respect) {
            throw new Error(`Relationship ${relKey} respect drift: replayed=${rr.respect}, db=${dr.respect}`);
        }
        if (rr.loyalty !== dr.loyalty) {
            throw new Error(`Relationship ${relKey} loyalty drift: replayed=${rr.loyalty}, db=${dr.loyalty}`);
        }
        if ((rr.last_interaction_fictional_time || null) !== (dr.last_interaction_fictional_time || null)) {
            throw new Error(`Relationship ${relKey} last_interaction_fictional_time drift: replayed=${rr.last_interaction_fictional_time}, db=${dr.last_interaction_fictional_time}`);
        }
    }

    // 13. Compare Relationship Evidence (Phase 8)
    const dbEvCount = db.prepare(`
        SELECT COUNT(*) AS total FROM lws_relationship_evidence WHERE simulation_id = ?
    `).get(sim.id).total;
    if (dbEvCount !== replayed.relationshipEvidence.length) {
        throw new Error(`Relationship evidence count drift: replayed=${replayed.relationshipEvidence.length}, db=${dbEvCount}`);
    }

    // 14. Compare Social Information / Rumors (Phase 8)
    const dbSocialInfo = db.prepare(`
        SELECT si.*,
               rsi.lws_id AS root_lws_id,
               psi.lws_id AS parent_lws_id,
               sc_orig.lws_id AS orig_char_lws_id,
               sc_trans.lws_id AS trans_char_lws_id,
               sc_recip.lws_id AS recip_char_lws_id
        FROM lws_social_information si
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        WHERE si.simulation_id = ?
    `).all(sim.id);

    for (const dsi of dbSocialInfo) {
        const rsi = replayed.socialInformation[dsi.lws_id];
        if (!rsi) {
            throw new Error(`Social information ${dsi.lws_id} missing in replayed state`);
        }
        if (rsi.transmission_depth !== dsi.transmission_depth) {
            throw new Error(`Social information ${dsi.lws_id} depth drift: replayed=${rsi.transmission_depth}, db=${dsi.transmission_depth}`);
        }
        if (rsi.veracity !== dsi.veracity) {
            throw new Error(`Social information ${dsi.lws_id} veracity drift: replayed=${rsi.veracity}, db=${dsi.veracity}`);
        }
        if (rsi.confidence_score !== dsi.confidence_score) {
            throw new Error(`Social information ${dsi.lws_id} confidence drift: replayed=${rsi.confidence_score}, db=${dsi.confidence_score}`);
        }
        if (rsi.claim_statement !== dsi.claim_statement) {
            throw new Error(`Social information ${dsi.lws_id} statement drift: replayed=${rsi.claim_statement}, db=${dsi.claim_statement}`);
        }
    }

    // 15. Compare Faction Memberships (Phase 8)
    const dbMemberships = db.prepare(`
        SELECT fm.*, sc.lws_id AS char_lws_id, f.lws_id AS faction_lws_id
        FROM lws_character_faction_memberships fm
        JOIN lws_simulation_characters sc ON fm.simulation_character_id = sc.id
        JOIN lws_factions f ON fm.faction_id = f.id
        WHERE fm.simulation_id = ?
    `).all(sim.id);

    for (const dm of dbMemberships) {
        const memKey = `${dm.char_lws_id}:${dm.faction_lws_id}`;
        const rm = replayed.factionMemberships[memKey] || replayed.factionMemberships[`${dm.char_lws_id}:${dm.faction_id}`];
        if (!rm) {
            throw new Error(`Faction membership ${memKey} missing in replayed state`);
        }
        if (rm.rank_role !== dm.rank_role) {
            throw new Error(`Faction membership ${memKey} rank_role drift: replayed=${rm.rank_role}, db=${dm.rank_role}`);
        }
        if (rm.standing !== dm.standing) {
            throw new Error(`Faction membership ${memKey} standing drift: replayed=${rm.standing}, db=${dm.standing}`);
        }
        if (rm.loyalty_score !== dm.loyalty_score) {
            throw new Error(`Faction membership ${memKey} loyalty drift: replayed=${rm.loyalty_score}, db=${dm.loyalty_score}`);
        }
        if (rm.membership_status !== dm.membership_status) {
            throw new Error(`Faction membership ${memKey} status drift: replayed=${rm.membership_status}, db=${dm.membership_status}`);
        }
    }

    // 16. Compare Character Development Records (Phase 8)
    const dbDevRecords = db.prepare(`
        SELECT dr.*, sc.lws_id AS char_lws_id
        FROM lws_character_development_records dr
        JOIN lws_simulation_characters sc ON dr.simulation_character_id = sc.id
        WHERE dr.simulation_id = ?
    `).all(sim.id);

    if (dbDevRecords.length !== replayed.developmentRecords.length) {
        throw new Error(`Development records count drift: replayed=${replayed.developmentRecords.length}, db=${dbDevRecords.length}`);
    }

    // 17. Compare Beliefs (Reconciled Phase 6/8)
    const dbBeliefs = db.prepare(`
        SELECT b.*, sc.lws_id AS char_lws_id
        FROM lws_character_beliefs b
        JOIN lws_simulation_characters sc ON b.simulation_character_id = sc.id
        WHERE b.simulation_id = ?
    `).all(sim.id);

    for (const dbB of dbBeliefs) {
        const charBeliefs = replayed.beliefs[dbB.char_lws_id] || {};
        const rb = charBeliefs[dbB.subject_key];
        if (!rb) {
            throw new Error(`Character ${dbB.char_lws_id} belief ${dbB.subject_key} missing in replayed state`);
        }
        if (rb.statement !== dbB.statement) {
            throw new Error(`Belief ${dbB.subject_key} statement drift: replayed=${rb.statement}, db=${dbB.statement}`);
        }
        if (rb.confidence !== dbB.confidence) {
            throw new Error(`Belief ${dbB.subject_key} confidence drift: replayed=${rb.confidence}, db=${dbB.confidence}`);
        }
    }

    // 18. Compare Character Tiers (Phase 9)
    const dbTiers = db.prepare(`
        SELECT t.*, sc.lws_id AS char_lws_id
        FROM lws_simulation_character_tiers t
        JOIN lws_simulation_characters sc ON t.simulation_character_id = sc.id
        WHERE t.simulation_id = ?
    `).all(sim.id);

    for (const dt of dbTiers) {
        const rt = replayed.characterTiers[dt.char_lws_id];
        if (!rt) {
            throw new Error(`Character ${dt.char_lws_id} tier missing in replayed state`);
        }
        if (rt.tier !== dt.tier) {
            throw new Error(`Character ${dt.char_lws_id} tier drift: replayed=${rt.tier}, db=${dt.tier}`);
        }
        if (rt.cognitive_budget !== dt.cognitive_budget) {
            throw new Error(`Character ${dt.char_lws_id} cognitive_budget drift: replayed=${rt.cognitive_budget}, db=${dt.cognitive_budget}`);
        }
        if (Boolean(rt.is_promoted) !== Boolean(dt.is_promoted)) {
            throw new Error(`Character ${dt.char_lws_id} is_promoted drift: replayed=${rt.is_promoted}, db=${dt.is_promoted}`);
        }
    }

    // 19. Compare Promoted Entity Records (Phase 9)
    const dbPromoted = db.prepare(`
        SELECT p.*, sc.lws_id AS char_lws_id, loc.lws_id AS origin_loc_lws_id
        FROM lws_promoted_entity_records p
        JOIN lws_simulation_characters sc ON p.simulation_character_id = sc.id
        LEFT JOIN lws_locations loc ON p.origin_location_id = loc.id
        WHERE p.simulation_id = ?
    `).all(sim.id);

    for (const dp of dbPromoted) {
        const rp = replayed.promotedEntities[dp.source_transient_id] || replayed.promotedEntities[dp.char_lws_id];
        if (!rp) {
            throw new Error(`Promoted entity record ${dp.source_transient_id} missing in replayed state`);
        }
        if (rp.source_archetype_key !== dp.source_archetype_key) {
            throw new Error(`Promoted entity archetype drift: replayed=${rp.source_archetype_key}, db=${dp.source_archetype_key}`);
        }
        if (rp.promoted_to_tier !== dp.promoted_to_tier) {
            throw new Error(`Promoted entity tier drift: replayed=${rp.promoted_to_tier}, db=${dp.promoted_to_tier}`);
        }
        if (rp.promotion_reason !== dp.promotion_reason) {
            throw new Error(`Promoted entity reason drift: replayed=${rp.promotion_reason}, db=${dp.promotion_reason}`);
        }
    }

    // 20. Compare Location Environments (Phase 9)
    const dbEnvs = db.prepare(`
        SELECT env.*, loc.lws_id AS loc_lws_id
        FROM lws_location_environments env
        JOIN lws_locations loc ON env.location_id = loc.id
        WHERE env.simulation_id = ?
    `).all(sim.id);

    for (const de of dbEnvs) {
        const re = replayed.locationEnvironments[de.loc_lws_id];
        if (re) {
            if (re.weather !== de.weather) {
                throw new Error(`Location ${de.loc_lws_id} weather drift: replayed=${re.weather}, db=${de.weather}`);
            }
            if (re.temperature_override !== de.temperature_override) {
                throw new Error(`Location ${de.loc_lws_id} temp override drift: replayed=${re.temperature_override}, db=${de.temperature_override}`);
            }
            if (re.lighting_override !== de.lighting_override) {
                throw new Error(`Location ${de.loc_lws_id} lighting override drift: replayed=${re.lighting_override}, db=${de.lighting_override}`);
            }
            if (re.noise_level !== de.noise_level) {
                throw new Error(`Location ${de.loc_lws_id} noise drift: replayed=${re.noise_level}, db=${de.noise_level}`);
            }
            if (re.air_quality !== de.air_quality) {
                throw new Error(`Location ${de.loc_lws_id} air quality drift: replayed=${re.air_quality}, db=${de.air_quality}`);
            }
        }
    }

    // 21. Compare Location Operational States (Phase 9)
    const dbOps = db.prepare(`
        SELECT ops.*, loc.lws_id AS loc_lws_id
        FROM lws_location_operational_states ops
        JOIN lws_locations loc ON ops.location_id = loc.id
        WHERE ops.simulation_id = ?
    `).all(sim.id);

    for (const dops of dbOps) {
        const rops = replayed.locationOperationalStates[dops.loc_lws_id];
        if (rops) {
            if (rops.access_status !== dops.access_status) {
                throw new Error(`Location ${dops.loc_lws_id} access_status drift: replayed=${rops.access_status}, db=${dops.access_status}`);
            }
            if (rops.access_override !== dops.access_override) {
                throw new Error(`Location ${dops.loc_lws_id} access_override drift: replayed=${rops.access_override}, db=${dops.access_override}`);
            }
            if (rops.crowd_density !== dops.crowd_density) {
                throw new Error(`Location ${dops.loc_lws_id} crowd_density drift: replayed=${rops.crowd_density}, db=${dops.crowd_density}`);
            }
            if (rops.ambient_capacity !== dops.ambient_capacity) {
                throw new Error(`Location ${dops.loc_lws_id} ambient_capacity drift: replayed=${rops.ambient_capacity}, db=${dops.ambient_capacity}`);
            }
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
