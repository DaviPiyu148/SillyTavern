/**
 * Living World Simulator (LWS) - Model Output Parser & Proposal Extractor
 */

import { OUTPUT_CONTRACT_TYPES } from './common.js';
import { safeJsonParse } from '../simulations/common.js';

/**
 * Attempts to repair mild JSON syntax issues (e.g. trailing commas).
 *
 * @param {string} text
 * @returns {string}
 */
function cleanJsonString(text) {
    if (!text) return '';
    return text
        .trim()
        .replace(/,\s*([}\]])/g, '$1') // remove trailing commas before closing braces/brackets
        .replace(/^[^{\[]*/, '') // strip any preceding non-json characters
        .replace(/[^}\]]*$/, ''); // strip any trailing non-json characters
}

/**
 * Parses raw LLM generation output into narrative prose and structured event proposals.
 *
 * @param {string} rawText The raw text output from the language model
 * @param {string} [expectedContract=OUTPUT_CONTRACT_TYPES.DUAL_BLOCK] Expected contract format
 * @returns {object} Extracted proposals, cleaned narrative prose, and parse diagnostics
 */
export function parseModelResponse(rawText, expectedContract = OUTPUT_CONTRACT_TYPES.DUAL_BLOCK) {
    if (typeof rawText !== 'string') {
        rawText = String(rawText || '');
    }

    const proposals = [];
    const parsingErrors = [];
    let cleanedNarrative = rawText;

    // ------------------------------------------------------------------------
    // 1. Extract <lws_proposal> ... </lws_proposal> XML-style blocks
    // ------------------------------------------------------------------------
    const xmlTagRegex = /<lws_proposal[\s\S]*?>([\s\S]*?)<\/lws_proposal>/gi;
    let tagMatch;

    while ((tagMatch = xmlTagRegex.exec(rawText)) !== null) {
        const rawBlock = tagMatch[1].trim();
        try {
            const parsed = JSON.parse(cleanJsonString(rawBlock));
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === 'object' && item.event_type) {
                        proposals.push(normalizeProposal(item, rawBlock));
                    }
                }
            } else if (parsed && typeof parsed === 'object' && parsed.event_type) {
                proposals.push(normalizeProposal(parsed, rawBlock));
            } else {
                parsingErrors.push({
                    block: rawBlock,
                    error: 'Parsed JSON is missing required "event_type" field',
                });
            }
        } catch (err) {
            parsingErrors.push({
                block: rawBlock,
                error: `Failed to parse JSON proposal: ${err.message}`,
            });
        }
    }

    // Strip XML blocks from narrative
    cleanedNarrative = cleanedNarrative.replace(xmlTagRegex, '');

    // ------------------------------------------------------------------------
    // 2. Extract Markdown Fenced Blocks (if no XML proposals or dual format)
    // ------------------------------------------------------------------------
    const fencedRegex = /```(?:json|lws_proposal)?\s*([\s\S]*?\{[\s\S]*?"event_type"[\s\S]*?\})\s*```/gi;
    let fenceMatch;

    while ((fenceMatch = fencedRegex.exec(rawText)) !== null) {
        const rawBlock = fenceMatch[1].trim();
        // Check if we already parsed this identical block via XML tags
        const alreadyParsed = proposals.some(p => p.raw_block === rawBlock);
        if (!alreadyParsed) {
            try {
                const parsed = JSON.parse(cleanJsonString(rawBlock));
                if (parsed && typeof parsed === 'object' && parsed.event_type) {
                    proposals.push(normalizeProposal(parsed, rawBlock));
                }
            } catch (err) {
                // Fenced blocks might just be example JSON in prose, only report error if expected proposal
                if (expectedContract === OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL) {
                    parsingErrors.push({
                        block: rawBlock,
                        error: `Failed to parse fenced JSON proposal: ${err.message}`,
                    });
                }
            }
        }
    }

    // Strip fenced proposal blocks from narrative
    cleanedNarrative = cleanedNarrative.replace(fencedRegex, '');

    // ------------------------------------------------------------------------
    // 3. Structured Proposal Fallback (Entire response is raw JSON)
    // ------------------------------------------------------------------------
    if (proposals.length === 0 && (expectedContract === OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL || rawText.trim().startsWith('{'))) {
        try {
            const rawParsed = JSON.parse(cleanJsonString(rawText));
            if (rawParsed && typeof rawParsed === 'object' && rawParsed.event_type) {
                proposals.push(normalizeProposal(rawParsed, rawText));
                cleanedNarrative = ''; // Structured proposal mode produces no narrative prose
            }
        } catch (err) {
            if (expectedContract === OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL) {
                parsingErrors.push({
                    block: rawText,
                    error: `Failed to parse direct JSON response: ${err.message}`,
                });
            }
        }
    }

    // Clean up prose whitespace
    cleanedNarrative = cleanedNarrative
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        raw_text: rawText,
        narrative_prose: cleanedNarrative,
        proposals,
        has_proposals: proposals.length > 0,
        parsing_errors: parsingErrors,
    };
}

/**
 * Normalizes a parsed proposal object to canonical fields.
 *
 * @param {object} parsed
 * @param {string} rawBlock
 * @returns {object}
 */
function normalizeProposal(parsed, rawBlock) {
    return {
        event_type: String(parsed.event_type || '').toUpperCase().trim(),
        actor_character_id: parsed.actor_character_id || parsed.actor_id || null,
        target_character_id: parsed.target_character_id || parsed.target_id || null,
        location_id: parsed.location_id || null,
        payload: (parsed.payload && typeof parsed.payload === 'object') ? parsed.payload : {},
        raw_block: rawBlock,
    };
}
