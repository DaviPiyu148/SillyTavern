/**
 * Living World Simulator (LWS) - Dynamic Context Builder & Knowledge Filtering
 */

import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { ensureActiveSimulation, safeJsonParse, isValidUuid } from '../simulations/common.js';
import {
    GENERATION_MODES,
    PROMPT_LAYERS,
    OUTPUT_CONTRACT_TYPES,
    DEFAULT_SYSTEM_CONTRACT,
    OUTPUT_CONTRACT_INSTRUCTIONS,
} from './common.js';
import { retrieveCharacterMemories } from '../perception/memory-retrieval.js';
import { calculateSensoryClarity } from '../environment/common.js';
import { generateAmbientPopulation } from '../population/ambient-generator.js';
import { getTimeBucket } from '../population/common.js';

/**
 * Builds the layered prompt context for a simulation generation request.
 * Enforces strict perspective isolation and zero hidden knowledge leakage.
 *
 * @param {string} simLwsId
 * @param {object} [options]
 * @returns {object} Assembled context containing layers, system_prompt, messages, and metadata
 */
export function buildPromptContext(simLwsId, options = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const mode = options.generationMode || options.generation_mode || GENERATION_MODES.CHARACTER_DIALOGUE;
    if (!Object.values(GENERATION_MODES).includes(mode)) {
        throw new LwsValidationError(`Invalid generation mode: ${mode}`, ['generationMode']);
    }

    const charLwsId = options.characterLwsId || options.character_lws_id || null;
    const cameraName = options.cameraName || options.camera_name || 'default';
    const userInput = options.userInput || options.user_input || options.prompt || '';
    const userSystemPrompt = options.userSystemPrompt || options.user_system_prompt || '';
    const memoryLimit = Math.min(Math.max(1, Number(options.memoryLimit || options.memory_limit || 5)), 20);
    const eventLimit = Math.min(Math.max(1, Number(options.eventLimit || options.event_limit || 5)), 20);

    let outputContractType = options.outputContractType || options.output_contract_type;
    if (!outputContractType) {
        if (mode === GENERATION_MODES.CHARACTER_DECISION) {
            outputContractType = OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL;
        } else if (mode === GENERATION_MODES.WORLD_NARRATION) {
            outputContractType = OUTPUT_CONTRACT_TYPES.NARRATIVE_PROSE;
        } else if (mode === GENERATION_MODES.DIRECTOR_QUERY) {
            outputContractType = OUTPUT_CONTRACT_TYPES.DIRECTOR_REPORT;
        } else {
            outputContractType = OUTPUT_CONTRACT_TYPES.DUAL_BLOCK;
        }
    }

    // ------------------------------------------------------------------------
    // 1. Fetch World & Setting Data
    // ------------------------------------------------------------------------
    const world = db.prepare('SELECT * FROM lws_worlds WHERE id = ?').get(sim.world_id);
    const worldRules = db.prepare(`
        SELECT title, body
        FROM lws_world_rules
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
    `).all(sim.world_id);

    const authoredPromptConfig = db.prepare(`
        SELECT style_notes, tone_notes, format_notes
        FROM lws_authored_prompt_configs
        WHERE world_id = ?
    `).get(sim.world_id);

    // Simulation-scoped prompt override in settings
    const simSettings = safeJsonParse(sim.settings, {});
    const simPromptConfig = simSettings.prompt_config || {};

    // ------------------------------------------------------------------------
    // 2. Fetch Character Data (if character perspective)
    // ------------------------------------------------------------------------
    let charRow = null;
    let charTier = null;
    let charNeeds = [];
    let charValues = [];
    let charEmotion = null;
    let charGoals = [];
    let charIntentions = [];
    let charRelationships = [];
    let charFactionMemberships = [];
    let charKnowledge = [];
    let charBeliefs = [];
    let charMemories = [];
    let charPerceivedEvents = [];
    let locationRow = null;
    let locationEnv = null;
    let locationOps = null;
    let sensoryClarity = 100;
    let coLocatedCharacters = [];
    let ambientEntities = [];

    if (charLwsId) {
        if (!isValidUuid(charLwsId)) {
            throw new LwsValidationError(`Invalid character UUID: ${charLwsId}`, ['characterLwsId']);
        }

        charRow = db.prepare(`
            SELECT sc.*, c.name, c.description, c.personality, c.scenario_context, c.tags,
                   c.lws_id AS authored_character_lws_id,
                   loc.lws_id AS location_lws_id, loc.name AS location_name, loc.description AS location_description
            FROM lws_simulation_characters sc
            JOIN lws_characters c ON sc.character_id = c.id
            LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
            WHERE (sc.lws_id = ? OR c.lws_id = ?) AND sc.simulation_id = ? AND sc.deleted_at IS NULL
        `).get(charLwsId, charLwsId, sim.id);

        if (!charRow) {
            throw new LwsNotFoundError(`Character ${charLwsId} not found in this simulation`);
        }

        charTier = db.prepare(`
            SELECT tier, cognitive_budget, is_promoted
            FROM lws_simulation_character_tiers
            WHERE simulation_character_id = ?
        `).get(charRow.id) || { tier: 'core', cognitive_budget: 'full', is_promoted: 0 };

        // Needs (Phase 7: energy, nourishment, social, safety, morale)
        charNeeds = db.prepare(`
            SELECT need_name, satisfaction, decay_rate
            FROM lws_character_needs
            WHERE simulation_character_id = ?
            ORDER BY need_name ASC
        `).all(charRow.id);

        // Values (Phase 7)
        charValues = db.prepare(`
            SELECT dimension, strength
            FROM lws_character_values
            WHERE simulation_character_id = ?
            ORDER BY dimension ASC
        `).all(charRow.id);

        // Emotions (Phase 7)
        charEmotion = db.prepare(`
            SELECT dominant_emotion, intensity, arousal, valence
            FROM lws_character_emotions
            WHERE simulation_character_id = ?
        `).get(charRow.id);

        // Active Goals
        charGoals = db.prepare(`
            SELECT lws_id, title, status, priority, urgency, progress, goal_type
            FROM lws_character_goals
            WHERE simulation_character_id = ? AND deleted_at IS NULL AND status IN ('active', 'in_progress', 'pending')
            ORDER BY priority ASC, urgency DESC
            LIMIT 5
        `).all(charRow.id);

        // Active Intentions
        charIntentions = db.prepare(`
            SELECT lws_id, action_type, target_entity_type, target_entity_id, priority, status, rationale
            FROM lws_character_intentions
            WHERE simulation_character_id = ? AND status = 'active'
            ORDER BY priority ASC
            LIMIT 3
        `).all(charRow.id);

        // Outgoing Relationships (STRICT: only source = charRow.id)
        charRelationships = db.prepare(`
            SELECT r.trust, r.affection, r.familiarity, r.respect, r.loyalty, r.last_interaction_fictional_time,
                   target_sc.lws_id AS target_char_lws_id, target_c.name AS target_char_name
            FROM lws_character_relationships r
            JOIN lws_simulation_characters target_sc ON r.target_character_id = target_sc.id
            JOIN lws_characters target_c ON target_sc.character_id = target_c.id
            WHERE r.simulation_id = ? AND r.source_character_id = ? AND r.deleted_at IS NULL
            ORDER BY r.familiarity DESC
            LIMIT 10
        `).all(sim.id, charRow.id);

        // Faction Memberships (STRICT: only for this character)
        charFactionMemberships = db.prepare(`
            SELECT fm.rank_role, fm.standing, fm.loyalty_score, fm.membership_status,
                   f.name AS faction_name, f.lws_id AS faction_lws_id
            FROM lws_character_faction_memberships fm
            JOIN lws_factions f ON fm.faction_id = f.id
            WHERE fm.simulation_id = ? AND fm.simulation_character_id = ? AND fm.deleted_at IS NULL AND fm.membership_status = 'active'
        `).all(sim.id, charRow.id);

        // Knowledge facts
        charKnowledge = db.prepare(`
            SELECT fact_key, content, source_channel, fictional_time_acquired
            FROM lws_character_knowledge
            WHERE simulation_character_id = ? AND deleted_at IS NULL
            ORDER BY id DESC
            LIMIT 10
        `).all(charRow.id);

        // Beliefs
        charBeliefs = db.prepare(`
            SELECT subject_key, statement, confidence
            FROM lws_character_beliefs
            WHERE simulation_character_id = ? AND deleted_at IS NULL
            ORDER BY id DESC
            LIMIT 10
        `).all(charRow.id);

        // Relevant Memories
        try {
            charMemories = retrieveCharacterMemories(db, charRow.lws_id, {
                currentFictionalTime: sim.current_fictional_time,
                query_text: userInput,
                limit: memoryLimit,
            });
        } catch {
            charMemories = [];
        }

        // Location & Sensory Clarity (if character is in a location)
        if (charRow.current_location_id) {
            locationRow = db.prepare('SELECT * FROM lws_locations WHERE id = ?').get(charRow.current_location_id);
            locationEnv = db.prepare('SELECT * FROM lws_location_environments WHERE simulation_id = ? AND location_id = ?').get(sim.id, charRow.current_location_id);
            locationOps = db.prepare('SELECT * FROM lws_location_operational_states WHERE simulation_id = ? AND location_id = ?').get(sim.id, charRow.current_location_id);
            sensoryClarity = calculateSensoryClarity(locationEnv || {}, locationOps || {});

            // Co-located active characters
            coLocatedCharacters = db.prepare(`
                SELECT sc.lws_id, c.name, sc.activity, sc.physical_condition
                FROM lws_simulation_characters sc
                JOIN lws_characters c ON sc.character_id = c.id
                WHERE sc.simulation_id = ? AND sc.current_location_id = ? AND sc.id != ? AND sc.deleted_at IS NULL
            `).all(sim.id, charRow.current_location_id, charRow.id);

            // Ambient crowd estimate
            try {
                const timeBucket = getTimeBucket(sim.current_fictional_time);
                const archetypes = db.prepare('SELECT * FROM lws_ambient_archetypes WHERE world_id = ? AND deleted_at IS NULL').all(sim.world_id);
                ambientEntities = generateAmbientPopulation(
                    sim.lws_id,
                    charRow.location_lws_id,
                    timeBucket,
                    sim.world_id,
                    locationEnv,
                    locationOps,
                    archetypes,
                    coLocatedCharacters,
                );
            } catch {
                ambientEntities = [];
            }
        }

        // Recent perceived events
        charPerceivedEvents = db.prepare(`
            SELECT e.event_type, e.fictional_time, e.payload, ep.sensory_modality
            FROM lws_event_perceptions ep
            JOIN lws_events e ON ep.event_id = e.id
            WHERE ep.simulation_id = ? AND ep.simulation_character_id = ?
            ORDER BY e.sequence_number DESC
            LIMIT ?
        `).all(sim.id, charRow.id, eventLimit).reverse();
    } else if (mode === GENERATION_MODES.WORLD_NARRATION) {
        // World Narration / Camera View
        const cameraRow = db.prepare(`
            SELECT cam.*, loc.lws_id AS target_loc_lws_id, loc.name AS target_loc_name,
                   sc.lws_id AS target_char_lws_id, c.name AS target_char_name
            FROM lws_simulation_cameras cam
            LEFT JOIN lws_locations loc ON cam.target_location_id = loc.id
            LEFT JOIN lws_simulation_characters sc ON cam.target_character_id = sc.id
            LEFT JOIN lws_characters c ON sc.character_id = c.id
            WHERE cam.simulation_id = ? AND cam.camera_name = ?
        `).get(sim.id, cameraName);

        if (cameraRow?.target_location_id) {
            locationRow = db.prepare('SELECT * FROM lws_locations WHERE id = ?').get(cameraRow.target_location_id);
            locationEnv = db.prepare('SELECT * FROM lws_location_environments WHERE simulation_id = ? AND location_id = ?').get(sim.id, cameraRow.target_location_id);
            locationOps = db.prepare('SELECT * FROM lws_location_operational_states WHERE simulation_id = ? AND location_id = ?').get(sim.id, cameraRow.target_location_id);
            sensoryClarity = calculateSensoryClarity(locationEnv || {}, locationOps || {});

            coLocatedCharacters = db.prepare(`
                SELECT sc.lws_id, c.name, sc.activity, sc.physical_condition
                FROM lws_simulation_characters sc
                JOIN lws_characters c ON sc.character_id = c.id
                WHERE sc.simulation_id = ? AND sc.current_location_id = ? AND sc.deleted_at IS NULL
            `).all(sim.id, cameraRow.target_location_id);
        }
    }

    // ------------------------------------------------------------------------
    // 3. Assemble the 12 Conceptual Layers
    // ------------------------------------------------------------------------
    const layers = {};

    // Layer 1: LWS System Contract
    layers[PROMPT_LAYERS.LWS_SYSTEM_CONTRACT] = {
        name: 'LWS Protected Simulation Contract',
        priority: 100,
        content: DEFAULT_SYSTEM_CONTRACT,
    };

    // Layer 2: Current Simulation State & Environment
    const simStateLines = [
        `[SIMULATION STATE]`,
        `Simulation: ${sim.name || sim.lws_id} (Status: ${sim.status})`,
        `Fictional Timestamp: ${sim.current_fictional_time}`,
    ];
    if (locationRow) {
        simStateLines.push(`Current Location: ${locationRow.name} (${locationRow.lws_id})`);
        if (locationRow.description) {
            simStateLines.push(`Location Description: ${locationRow.description}`);
        }
        if (locationEnv) {
            simStateLines.push(`Environment: Weather: ${locationEnv.weather}, Lighting: ${locationEnv.lighting_override || locationEnv.lighting_level}, Temperature: ${locationEnv.temperature_celsius}°C, Noise: ${locationEnv.noise_level}/100, Air Quality: ${locationEnv.air_quality}`);
        }
        if (locationOps) {
            simStateLines.push(`Operational Status: Access: ${locationOps.access_override || locationOps.access_status}, Crowd: ${locationOps.crowd_density}`);
        }
        simStateLines.push(`Sensory Clarity: ${sensoryClarity}/100`);
    }
    layers[PROMPT_LAYERS.SIMULATION_STATE] = {
        name: 'Simulation State & Environment',
        priority: 70,
        content: simStateLines.join('\n'),
    };

    // Layer 3: World Premise & Rules
    const worldLines = [
        `[WORLD PREMISE & RULES]`,
        `World: ${world?.name || 'Unknown'}`,
    ];
    if (world?.premise) worldLines.push(`Premise: ${world.premise}`);
    if (world?.description) worldLines.push(`Description: ${world.description}`);
    if (worldRules.length > 0) {
        worldLines.push(`World Rules:`);
        for (const r of worldRules) {
            worldLines.push(`- ${r.title ? `[${r.title}] ` : ''}${r.body}`);
        }
    }
    layers[PROMPT_LAYERS.WORLD_PREMISE_RULES] = {
        name: 'World Premise & Rules',
        priority: 55,
        content: worldLines.join('\n'),
    };

    // Layer 4: Style & Author Instructions (+ User System Prompt)
    const styleLines = [`[AUTHOR & STYLE INSTRUCTIONS]`];
    const styleNotes = simPromptConfig.style_notes || authoredPromptConfig?.style_notes;
    const toneNotes = simPromptConfig.tone_notes || authoredPromptConfig?.tone_notes;
    const formatNotes = simPromptConfig.format_notes || authoredPromptConfig?.format_notes;

    if (styleNotes) styleLines.push(`Style Notes: ${styleNotes}`);
    if (toneNotes) styleLines.push(`Tone Notes: ${toneNotes}`);
    if (formatNotes) styleLines.push(`Format Notes: ${formatNotes}`);
    if (userSystemPrompt) {
        styleLines.push(`User Guidance: ${userSystemPrompt}`);
    }
    layers[PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS] = {
        name: 'Style & Author Instructions',
        priority: 60,
        content: styleLines.join('\n'),
    };

    // Layer 5: Character Authored Profile
    if (charRow) {
        const profileLines = [
            `[CHARACTER PROFILE: ${charRow.name}]`,
            `LWS ID: ${charRow.lws_id}`,
            `Personality: ${charRow.personality || 'Not specified'}`,
        ];
        if (charRow.description) profileLines.push(`Description: ${charRow.description}`);
        if (charRow.scenario_context) profileLines.push(`Scenario Context: ${charRow.scenario_context}`);
        const tags = safeJsonParse(charRow.tags, []);
        if (tags.length > 0) profileLines.push(`Tags: ${tags.join(', ')}`);
        layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE] = {
            name: 'Character Authored Profile',
            priority: 75,
            content: profileLines.join('\n'),
        };
    }

    // Layer 6: Character Mind State
    if (charRow) {
        const mindLines = [
            `[CHARACTER MIND & RUNTIME STATE]`,
            `Cognitive Tier: ${charTier?.tier || 'core'} (${charTier?.cognitive_budget || 'full'} budget)`,
            `Activity: ${charRow.activity || 'idle'}`,
            `Physical Condition: ${charRow.physical_condition || 'normal'}`,
        ];
        if (charEmotion) {
            mindLines.push(`Dominant Emotion: ${charEmotion.dominant_emotion} (Intensity: ${charEmotion.intensity}/100, Valence: ${charEmotion.valence}, Arousal: ${charEmotion.arousal})`);
        }
        if (charNeeds.length > 0) {
            const needStr = charNeeds.map(n => `${n.need_name}: ${Math.round(n.satisfaction)}%`).join(', ');
            mindLines.push(`Needs: ${needStr}`);
        }
        if (charValues.length > 0) {
            const valStr = charValues.map(v => `${v.dimension}: ${v.strength > 0 ? '+' : ''}${v.strength}`).join(', ');
            mindLines.push(`Values: ${valStr}`);
        }
        if (charGoals.length > 0) {
            mindLines.push(`Active Goals:`);
            for (const g of charGoals) {
                mindLines.push(`- ${g.title} (Priority: ${g.priority}, Urgency: ${g.urgency}, Progress: ${g.progress}%)`);
            }
        }
        if (charIntentions.length > 0) {
            mindLines.push(`Active Intentions:`);
            for (const i of charIntentions) {
                mindLines.push(`- Action: ${i.action_type} (Target: ${i.target_entity_type}:${i.target_entity_id || 'none'}, Priority: ${i.priority})`);
            }
        }
        layers[PROMPT_LAYERS.CHARACTER_MIND_STATE] = {
            name: 'Character Mind State',
            priority: 80,
            content: mindLines.join('\n'),
        };
    }

    // Layer 7: Permitted Relationships & Factions
    if (charRow) {
        const relLines = [`[SOCIAL MATRIX & RELATIONSHIPS]`];
        if (charFactionMemberships.length > 0) {
            relLines.push(`Faction Standings:`);
            for (const f of charFactionMemberships) {
                relLines.push(`- ${f.faction_name}: ${f.rank_role} (Standing: ${f.standing}, Loyalty: ${f.loyalty_score})`);
            }
        }
        if (charRelationships.length > 0) {
            relLines.push(`Interpersonal Relationships (Subjective View):`);
            for (const r of charRelationships) {
                relLines.push(`- ${r.target_char_name} (${r.target_char_lws_id}): Trust ${r.trust}, Affection ${r.affection}, Familiarity ${r.familiarity}, Respect ${r.respect}, Loyalty ${r.loyalty}`);
            }
        } else {
            relLines.push(`No established personal relationships.`);
        }
        layers[PROMPT_LAYERS.PERMITTED_RELATIONSHIPS] = {
            name: 'Permitted Relationships & Social Context',
            priority: 40,
            content: relLines.join('\n'),
        };
    }

    // Layer 8: Permitted Perception & Current Scene
    const sceneLines = [`[CURRENT SCENE & VISIBLE ENTITIES]`];
    if (locationRow) {
        sceneLines.push(`Location: ${locationRow.name}`);
        if (coLocatedCharacters.length > 0) {
            sceneLines.push(`Visible Present Characters:`);
            for (const c of coLocatedCharacters) {
                sceneLines.push(`- ${c.name} (${c.lws_id}): Activity: ${c.activity}, Condition: ${c.physical_condition}`);
            }
        } else {
            sceneLines.push(`No other primary characters present.`);
        }
        if (ambientEntities.length > 0) {
            sceneLines.push(`Ambient Crowd (${ambientEntities.length} entities):`);
            for (const a of ambientEntities.slice(0, 4)) {
                sceneLines.push(`- ${a.name} (${a.role_title}): ${a.current_activity}`);
            }
        }
    }
    layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE] = {
        name: 'Permitted Perception & Scene',
        priority: 50,
        content: sceneLines.join('\n'),
    };

    // Layer 9: Relevant Memories, Knowledge, Beliefs
    if (charRow) {
        const memLines = [`[SUBJECTIVE MEMORIES, KNOWLEDGE & BELIEFS]`];
        if (charBeliefs.length > 0) {
            memLines.push(`Beliefs & Suspicions:`);
            for (const b of charBeliefs) {
                memLines.push(`- "${b.statement}" (Confidence: ${b.confidence}%)`);
            }
        }
        if (charKnowledge.length > 0) {
            memLines.push(`Known Facts:`);
            for (const k of charKnowledge) {
                memLines.push(`- [${k.fact_key}] ${k.content}`);
            }
        }
        if (charMemories.length > 0) {
            memLines.push(`Recalled Memories:`);
            for (const m of charMemories) {
                memLines.push(`- [${m.fictional_time}] ${m.summary} (Salience: ${m.emotional_salience}%)`);
            }
        }
        layers[PROMPT_LAYERS.RELEVANT_MEMORIES_AND_KNOWLEDGE] = {
            name: 'Subjective Memories & Knowledge',
            priority: 30,
            content: memLines.join('\n'),
        };
    }

    // Layer 10: Recent Causal Events
    if (charPerceivedEvents.length > 0) {
        const eventLines = [`[RECENT PERCEIVED EVENTS]`];
        for (const e of charPerceivedEvents) {
            const payloadStr = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload || {});
            eventLines.push(`- [${e.fictional_time}] ${e.event_type} (${e.sensory_modality}): ${payloadStr.slice(0, 80)}`);
        }
        layers[PROMPT_LAYERS.RECENT_CAUSAL_EVENTS] = {
            name: 'Recent Perceived Events',
            priority: 20,
            content: eventLines.join('\n'),
        };
    }

    // Layer 11: Director Instruction / User Input
    if (userInput) {
        layers[PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT] = {
            name: 'User Input / Turn Prompt',
            priority: 90,
            content: `[USER INPUT / SCENE PROMPT]\n${userInput}`,
        };
    }

    // Layer 12: Output Contract
    const contractInstruction = OUTPUT_CONTRACT_INSTRUCTIONS[outputContractType] || OUTPUT_CONTRACT_INSTRUCTIONS[OUTPUT_CONTRACT_TYPES.DUAL_BLOCK];
    layers[PROMPT_LAYERS.OUTPUT_CONTRACT] = {
        name: 'Output Contract Instructions',
        priority: 95,
        content: contractInstruction,
    };

    // ------------------------------------------------------------------------
    // 4. Construct System Prompt and Chat Messages
    // ------------------------------------------------------------------------
    const systemSections = [
        layers[PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]?.content,
        layers[PROMPT_LAYERS.WORLD_PREMISE_RULES]?.content,
        layers[PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS]?.content,
        layers[PROMPT_LAYERS.OUTPUT_CONTRACT]?.content,
    ].filter(Boolean);

    const systemPrompt = systemSections.join('\n\n');

    const contextSections = [
        layers[PROMPT_LAYERS.SIMULATION_STATE]?.content,
        layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]?.content,
        layers[PROMPT_LAYERS.CHARACTER_MIND_STATE]?.content,
        layers[PROMPT_LAYERS.PERMITTED_RELATIONSHIPS]?.content,
        layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE]?.content,
        layers[PROMPT_LAYERS.RELEVANT_MEMORIES_AND_KNOWLEDGE]?.content,
        layers[PROMPT_LAYERS.RECENT_CAUSAL_EVENTS]?.content,
        layers[PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT]?.content,
    ].filter(Boolean);

    const userPrompt = contextSections.join('\n\n');

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    return {
        simulation_id: sim.lws_id,
        character_id: charRow?.lws_id ?? null,
        authored_character_id: charRow?.authored_character_lws_id ?? null,
        character_name: charRow?.name ?? null,
        generation_mode: mode,
        output_contract_type: outputContractType,
        layers,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        messages,
        metadata: {
            world_id: sim.world_id,
            current_fictional_time: sim.current_fictional_time,
            sensory_clarity: sensoryClarity,
            memory_count: charMemories.length,
            event_count: charPerceivedEvents.length,
            relationship_count: charRelationships.length,
        },
    };
}
