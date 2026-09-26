/**
 * Living World Simulator (LWS) - Token Budgeting & Layer Trimming
 */

import { LAYER_PRIORITIES, PROMPT_LAYERS } from './common.js';

/**
 * Estimates the token count of a given text string.
 * Uses a deterministic ~3.8 characters/token heuristic with word boundary awareness.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;

    // Word count and char count heuristic
    const charEstimate = Math.ceil(trimmed.length / 3.8);
    const wordCount = trimmed.split(/\s+/).length;
    const wordEstimate = Math.ceil(wordCount * 1.3);

    return Math.max(charEstimate, wordEstimate);
}

/**
 * Estimates token counts for all layers in an assembled prompt context.
 *
 * @param {object} context
 * @returns {object} Layer token breakdown and total count
 */
export function estimatePromptContextTokens(context) {
    if (!context || !context.layers) {
        return { total: 0, breakdown: {} };
    }

    let total = 0;
    const breakdown = {};

    for (const [layerKey, layerObj] of Object.entries(context.layers)) {
        if (!layerObj?.content) continue;
        const count = estimateTokens(layerObj.content);
        breakdown[layerKey] = count;
        total += count;
    }

    // Include system and user wrapper formatting overhead (~20 tokens)
    total += 20;

    return { total, breakdown };
}

/**
 * Re-assembles system_prompt, user_prompt, and messages from active layers.
 *
 * @param {object} layers
 * @returns {{ system_prompt: string, user_prompt: string, messages: object[] }}
 */
function reassemblePrompts(layers) {
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

    return { system_prompt: systemPrompt, user_prompt: userPrompt, messages };
}

/**
 * Allocates token budget across assembled context layers.
 * Prunes or truncates lower-priority layers when total tokens exceed maxTokens.
 * Fixed layers (LWS System Contract, Output Contract, Director/User Input) are never pruned.
 *
 * @param {object} assembledContext Context from buildPromptContext
 * @param {number} [maxTokens=4096] Maximum total token budget
 * @param {object} [options]
 * @returns {object} Budgeted context with token_budget metadata
 */
export function allocateTokenBudget(assembledContext, maxTokens = 4096, options = {}) {
    if (!assembledContext || typeof assembledContext !== 'object') {
        throw new TypeError('assembledContext must be a valid object');
    }

    const budgetLimit = Math.max(100, Number(maxTokens) || 4096);
    // Deep clone layers to avoid mutating input directly
    const workingLayers = {};
    for (const [key, val] of Object.entries(assembledContext.layers || {})) {
        if (val && typeof val === 'object') {
            workingLayers[key] = { ...val };
        }
    }

    let { total, breakdown } = estimatePromptContextTokens({ layers: workingLayers });
    const prunedLayers = [];

    if (total <= budgetLimit) {
        return {
            ...assembledContext,
            layers: workingLayers,
            token_budget: {
                max_tokens: budgetLimit,
                total_estimated_tokens: total,
                remaining_tokens: Math.max(0, budgetLimit - total),
                truncated: false,
                pruned_layers: [],
                layer_breakdown: breakdown,
            },
        };
    }

    // Sort active prunable layers by priority ascending (lowest priority first)
    const prunableLayerKeys = Object.keys(workingLayers)
        .filter(key => {
            const priority = LAYER_PRIORITIES[key] ?? 50;
            return priority < 90; // Layers >= 90 are fixed and protected
        })
        .sort((a, b) => (LAYER_PRIORITIES[a] ?? 50) - (LAYER_PRIORITIES[b] ?? 50));

    for (const layerKey of prunableLayerKeys) {
        if (total <= budgetLimit) break;

        const layerObj = workingLayers[layerKey];
        if (!layerObj || !layerObj.content) continue;

        const lines = layerObj.content.split('\n');

        // If multi-line, try line-by-line truncation first if layer has list items
        if (lines.length > 3) {
            let reduced = false;
            while (lines.length > 2) {
                lines.pop();
                layerObj.content = lines.join('\n');
                ({ total, breakdown } = estimatePromptContextTokens({ layers: workingLayers }));
                if (total <= budgetLimit) {
                    reduced = true;
                    prunedLayers.push({
                        layer: layerKey,
                        action: 'truncated',
                        remaining_lines: lines.length,
                    });
                    break;
                }
            }
            if (reduced) break;
        }

        // Completely prune layer if still over budget
        delete workingLayers[layerKey];
        prunedLayers.push({
            layer: layerKey,
            action: 'removed',
        });
        ({ total, breakdown } = estimatePromptContextTokens({ layers: workingLayers }));
    }

    // Reassemble prompts and messages with pruned layers
    const reassembled = reassemblePrompts(workingLayers);

    return {
        ...assembledContext,
        layers: workingLayers,
        system_prompt: reassembled.system_prompt,
        user_prompt: reassembled.user_prompt,
        messages: reassembled.messages,
        token_budget: {
            max_tokens: budgetLimit,
            total_estimated_tokens: total,
            remaining_tokens: Math.max(0, budgetLimit - total),
            truncated: prunedLayers.length > 0,
            pruned_layers: prunedLayers,
            layer_breakdown: breakdown,
        },
    };
}
