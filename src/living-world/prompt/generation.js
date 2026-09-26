/**
 * Living World Simulator (LWS) - Generation Orchestration & Narrative Turn Pipeline
 */

import { buildPromptContext } from './context-builder.js';
import { allocateTokenBudget } from './token-budget.js';
import { parseModelResponse } from './output-parser.js';
import { executeNarrativeTurn } from '../events/narrative-turns.js';

/**
 * Orchestrates a complete simulation generation turn:
 * 1. Assembles perspective-isolated 12-layer context
 * 2. Applies priority-based token budgeting
 * 3. Dispatches prompt to LLM driver / mock provider
 * 4. Parses dual-block output (<lws_proposal> + narrative prose)
 * 5. Executes proposals through the 2-transaction savepoint authority pipeline
 *
 * @param {string} simLwsId Simulation UUID
 * @param {object} [requestOptions] Generation and prompt parameters
 * @param {object} [executionContext] Execution context, drivers, and caller info
 * @returns {Promise<object>} Complete turn result with narrative, proposals, committed events, and turn metadata
 */
export async function generateSimulationTurn(simLwsId, requestOptions = {}, executionContext = {}) {
    // 1. Assemble Perspective-Isolated Context
    const assembledContext = buildPromptContext(simLwsId, requestOptions);

    // 2. Token Budgeting & Layer Trimming
    const maxTokens = requestOptions.maxTokens || requestOptions.max_tokens || 4096;
    const budgetedContext = allocateTokenBudget(assembledContext, maxTokens, requestOptions);

    // 3. Dispatch to LLM Driver / Mock
    let rawOutput = '';
    const mockResponse = requestOptions.mockResponse ?? requestOptions.mock_response;

    if (typeof mockResponse === 'string') {
        rawOutput = mockResponse;
    } else if (typeof executionContext.llmDriver === 'function') {
        rawOutput = await executionContext.llmDriver(budgetedContext.messages, {
            ...requestOptions,
            context: budgetedContext,
        });
    } else {
        // Fallback default output for headless execution
        rawOutput = `[Simulation narrative recorded for ${budgetedContext.character_name || 'Scene'}]`;
    }

    // 4. Parse Model Output
    const parsed = parseModelResponse(rawOutput, budgetedContext.output_contract_type);

    // 5. Consequential State Execution via 2-Transaction Savepoints
    const autoCommit = requestOptions.autoCommit !== false && requestOptions.auto_commit !== false;

    if (autoCommit && (parsed.has_proposals || parsed.narrative_prose)) {
        const turnInput = {
            user_input: requestOptions.userInput || requestOptions.user_input || requestOptions.prompt || null,
            raw_model_output: rawOutput,
            parsed_narrative: parsed.narrative_prose,
            model_info: {
                generation_mode: budgetedContext.generation_mode,
                character_id: budgetedContext.character_id,
                character_name: budgetedContext.character_name,
                output_contract_type: budgetedContext.output_contract_type,
                estimated_tokens: budgetedContext.token_budget?.total_estimated_tokens,
                truncated: budgetedContext.token_budget?.truncated,
            },
            proposals: parsed.proposals,
        };

        const turnResult = executeNarrativeTurn(simLwsId, turnInput, executionContext);

        return {
            success: turnResult.success,
            narrative: parsed.narrative_prose,
            proposals: parsed.proposals,
            parsing_errors: parsed.parsing_errors,
            turn: turnResult.turn,
            events: turnResult.events || [],
            error: turnResult.error ? { message: turnResult.error.message, code: turnResult.error.code } : null,
            context: budgetedContext,
        };
    }

    return {
        success: true,
        narrative: parsed.narrative_prose,
        proposals: parsed.proposals,
        parsing_errors: parsed.parsing_errors,
        turn: null,
        events: [],
        error: null,
        context: budgetedContext,
    };
}
