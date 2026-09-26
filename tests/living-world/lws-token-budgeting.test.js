import { describe, it, expect } from '@jest/globals';
import {
    estimateTokens,
    allocateTokenBudget,
    estimatePromptContextTokens,
} from '../../src/living-world/prompt/token-budget.js';
import { PROMPT_LAYERS, DEFAULT_SYSTEM_CONTRACT, OUTPUT_CONTRACT_INSTRUCTIONS, OUTPUT_CONTRACT_TYPES } from '../../src/living-world/prompt/common.js';

describe('Phase 10 - Token Budgeting & Layer Trimming', () => {
    it('estimates tokens deterministically', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens(null)).toBe(0);

        const sample = 'The ancient tower stood atop the windy crag overlooking the misty valley.';
        const count = estimateTokens(sample);
        expect(count).toBeGreaterThan(10);
        expect(count).toBeLessThan(35);
    });

    it('retains all layers when within budget limit', () => {
        const dummyContext = {
            simulation_id: 'sim-1',
            generation_mode: 'character_dialogue',
            output_contract_type: OUTPUT_CONTRACT_TYPES.DUAL_BLOCK,
            layers: {
                [PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]: { name: 'System Contract', priority: 100, content: DEFAULT_SYSTEM_CONTRACT },
                [PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]: { name: 'Profile', priority: 75, content: 'Name: Alice\nPersonality: Brave' },
                [PROMPT_LAYERS.OUTPUT_CONTRACT]: { name: 'Output Contract', priority: 95, content: OUTPUT_CONTRACT_INSTRUCTIONS[OUTPUT_CONTRACT_TYPES.DUAL_BLOCK] },
            },
            system_prompt: 'system text',
            user_prompt: 'user text',
            messages: [{ role: 'system', content: 'system text' }, { role: 'user', content: 'user text' }],
        };

        const budgeted = allocateTokenBudget(dummyContext, 4096);
        expect(budgeted.token_budget.truncated).toBe(false);
        expect(budgeted.token_budget.pruned_layers).toHaveLength(0);
        expect(budgeted.token_budget.total_estimated_tokens).toBeLessThan(4096);
        expect(budgeted.token_budget.remaining_tokens).toBeGreaterThan(0);
        expect(budgeted.layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]).toBeDefined();
    });

    it('prunes lowest-priority layers first when over budget', () => {
        const dummyContext = {
            simulation_id: 'sim-1',
            generation_mode: 'character_dialogue',
            output_contract_type: OUTPUT_CONTRACT_TYPES.DUAL_BLOCK,
            layers: {
                [PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]: { name: 'System Contract', priority: 100, content: 'Short system contract.' },
                [PROMPT_LAYERS.OUTPUT_CONTRACT]: { name: 'Output Contract', priority: 95, content: 'Short output contract.' },
                [PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT]: { name: 'User Prompt', priority: 90, content: 'Short user instruction.' },
                [PROMPT_LAYERS.CHARACTER_MIND_STATE]: { name: 'Mind State', priority: 80, content: 'Mind state: calm, active.' },
                [PROMPT_LAYERS.RECENT_CAUSAL_EVENTS]: {
                    name: 'Recent Events',
                    priority: 20,
                    content: 'Event 1: Detailed action A occurred in the grand market involving merchant trades.\nEvent 2: Detailed action B occurred in the dark back alley involving suspicious meetings.\nEvent 3: Detailed action C occurred near the north gate with heavy guard patrols.\nEvent 4: Detailed action D occurred at dusk with travelers arriving in carriages.',
                },
                [PROMPT_LAYERS.RELEVANT_MEMORIES_AND_KNOWLEDGE]: {
                    name: 'Memories',
                    priority: 30,
                    content: 'Memory 1: Remembers vivid details of ancient ruins from past expeditions across the wildlands.\nMemory 2: Remembers old tavern song sung by traveling bards from the eastern shores.\nMemory 3: Remembers secret doorway hidden behind the royal tapestries in the inner sanctum.',
                },
            },
            system_prompt: '',
            user_prompt: '',
            messages: [],
        };

        // Enforce tight budget
        const budgeted = allocateTokenBudget(dummyContext, 120);
        expect(budgeted.token_budget.truncated).toBe(true);
        expect(budgeted.token_budget.pruned_layers.length).toBeGreaterThan(0);

        // Fixed layers must NEVER be pruned
        expect(budgeted.layers[PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]).toBeDefined();
        expect(budgeted.layers[PROMPT_LAYERS.OUTPUT_CONTRACT]).toBeDefined();
        expect(budgeted.layers[PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT]).toBeDefined();

        // Lowest priority layer (RECENT_CAUSAL_EVENTS, priority 20) was pruned or truncated
        const eventPruned = budgeted.token_budget.pruned_layers.some(p => p.layer === PROMPT_LAYERS.RECENT_CAUSAL_EVENTS);
        expect(eventPruned).toBe(true);

        // Reassembled messages must not be empty
        expect(budgeted.messages).toHaveLength(2);
        expect(budgeted.messages[0].role).toBe('system');
        expect(budgeted.messages[1].role).toBe('user');
    });
});
