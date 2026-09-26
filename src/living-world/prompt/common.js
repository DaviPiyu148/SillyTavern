/**
 * Living World Simulator (LWS) - Prompt & Context Common Taxonomies & Contracts
 */

export const GENERATION_MODES = Object.freeze({
    CHARACTER_DECISION: 'character_decision',
    CHARACTER_DIALOGUE: 'character_dialogue',
    WORLD_NARRATION: 'world_narration',
    DIRECTOR_QUERY: 'director_query',
});

export const PROMPT_LAYERS = Object.freeze({
    LWS_SYSTEM_CONTRACT: 'lws_system_contract',
    SIMULATION_STATE: 'simulation_state',
    WORLD_PREMISE_RULES: 'world_premise_rules',
    STYLE_AND_AUTHOR_INSTRUCTIONS: 'style_and_author_instructions',
    CHARACTER_AUTHORED_PROFILE: 'character_authored_profile',
    CHARACTER_MIND_STATE: 'character_mind_state',
    PERMITTED_RELATIONSHIPS: 'permitted_relationships',
    PERMITTED_PERCEPTION_SCENE: 'permitted_perception_scene',
    RELEVANT_MEMORIES_AND_KNOWLEDGE: 'relevant_memories_and_knowledge',
    RECENT_CAUSAL_EVENTS: 'recent_causal_events',
    DIRECTOR_INSTRUCTION_OR_USER_PROMPT: 'director_instruction_or_user_prompt',
    OUTPUT_CONTRACT: 'output_contract',
});

export const OUTPUT_CONTRACT_TYPES = Object.freeze({
    STRUCTURED_PROPOSAL: 'structured_proposal',
    NARRATIVE_PROSE: 'narrative_prose',
    DUAL_BLOCK: 'dual_block',
    DIRECTOR_REPORT: 'director_report',
});

export const LAYER_PRIORITIES = Object.freeze({
    [PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]: 100, // Fixed - Never pruned
    [PROMPT_LAYERS.OUTPUT_CONTRACT]: 95,      // Fixed - Never pruned
    [PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT]: 90, // Fixed - Never pruned
    [PROMPT_LAYERS.CHARACTER_MIND_STATE]: 80, // High
    [PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]: 75, // High
    [PROMPT_LAYERS.SIMULATION_STATE]: 70,     // High
    [PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS]: 60, // Medium
    [PROMPT_LAYERS.WORLD_PREMISE_RULES]: 55,  // Medium
    [PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE]: 50, // Medium
    [PROMPT_LAYERS.PERMITTED_RELATIONSHIPS]: 40, // Elastic
    [PROMPT_LAYERS.RELEVANT_MEMORIES_AND_KNOWLEDGE]: 30, // Elastic
    [PROMPT_LAYERS.RECENT_CAUSAL_EVENTS]: 20, // Elastic (Lowest priority for truncation)
});

export const DEFAULT_SYSTEM_CONTRACT = `[LWS PROTECTED SIMULATION CONTRACT]
You are operating within the Living World Simulator (LWS).
CRITICAL SIMULATION RULES:
1. You are not omniscient. You only have access to information explicitly provided in this context.
2. You cannot directly declare or mutate ground truth reality. Any actions you wish to take must be formatted as event proposals.
3. The simulation engine validates all proposals against physical and domain rules before committing changes.
4. Characters must behave in accordance with their established traits, needs, emotions, values, beliefs, and relationships.
5. If you do not possess knowledge of an event, place, or secret, you must act with authentic ignorance.`;

export const OUTPUT_CONTRACT_INSTRUCTIONS = Object.freeze({
    [OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL]: `[OUTPUT CONTRACT: STRUCTURED PROPOSAL]
Provide your proposed action as a structured XML block:
<lws_proposal>
{
  "event_type": "<EVENT_TYPE>",
  "actor_character_id": "<ACTOR_LWS_ID>",
  "target_character_id": "<TARGET_LWS_ID_OR_NULL>",
  "location_id": "<LOCATION_LWS_ID_OR_NULL>",
  "payload": {
    "rationale": "<Reason for this action>"
  }
}
</lws_proposal>`,

    [OUTPUT_CONTRACT_TYPES.NARRATIVE_PROSE]: `[OUTPUT CONTRACT: NARRATIVE PROSE]
Provide vivid narrative prose reflecting the current scene, dialogue, and sensory experience from the specified perspective. Do not output raw JSON or internal variable names.`,

    [OUTPUT_CONTRACT_TYPES.DUAL_BLOCK]: `[OUTPUT CONTRACT: DUAL BLOCK]
If your character decides to take a consequential action, declare it in an <lws_proposal> JSON block.
Then provide the corresponding dialogue and narrative prose describing what occurs from the character's perspective.
Format:
<lws_proposal>
{
  "event_type": "<EVENT_TYPE>",
  "actor_character_id": "<ACTOR_LWS_ID>",
  "target_character_id": "<TARGET_LWS_ID_OR_NULL>",
  "location_id": "<LOCATION_LWS_ID_OR_NULL>",
  "payload": {}
}
</lws_proposal>
<Your narrative and dialogue here>`,

    [OUTPUT_CONTRACT_TYPES.DIRECTOR_REPORT]: `[OUTPUT CONTRACT: DIRECTOR REPORT]
Provide a clear, objective assessment and structured summary addressing the Director query using the provided simulation data.`,
});
