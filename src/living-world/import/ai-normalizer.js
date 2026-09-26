import { LwsValidationError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashString,
    createProvenance,
} from './common.js';
import { parseFreeformOutline } from './freeform-importer.js';

export const AI_NORMALIZATION_SYSTEM_INSTRUCTION = `You are a Living World Simulator knowledge extraction engine.
Your task is to extract structured entities strictly from the provided text.

Strict Invariants:
1. Extract ONLY facts explicitly stated in the source text.
2. DO NOT invent unmentioned locations, factions, characters, or rules.
3. If an optional property (e.g. personality, parent location) is not mentioned in the source, leave it as an empty string or null.
4. Output strict, valid JSON conforming to the candidate schema below.

JSON Schema:
{
  "world": {
    "name": "string (required)",
    "description": "string",
    "tags": ["string"]
  },
  "characters": [
    {
      "name": "string (required)",
      "description": "string",
      "personality": "string",
      "scenario_context": "string",
      "mes_example": "string",
      "tags": ["string"]
    }
  ],
  "locations": [
    {
      "name": "string (required)",
      "description": "string",
      "parent_location_name": "string or null",
      "tags": ["string"]
    }
  ],
  "factions": [
    {
      "name": "string (required)",
      "description": "string",
      "tags": ["string"]
    }
  ],
  "world_rules": [
    {
      "title": "string (required)",
      "body": "string"
    }
  ]
}`;

/**
 * Builds the AI normalization extraction prompt.
 *
 * @param {string} sourceText
 * @returns {string} Prompt string
 */
export function buildAiNormalizationPrompt(sourceText) {
    const cleanText = normalizeUnicode(sourceText.trim());
    return `${AI_NORMALIZATION_SYSTEM_INSTRUCTION}\n\n--- SOURCE TEXT ---\n${cleanText}\n--- END SOURCE TEXT ---\n\nExtract the JSON structure:`;
}

/**
 * Parses and sanitizes an AI model's JSON response, enforcing the negative no-invention contract.
 *
 * @param {string | object} rawModelResponse
 * @param {string} sourceText
 * @param {object} [options]
 * @returns {{
 *   candidate_entities: {
 *     world: object,
 *     characters: object[],
 *     locations: object[],
 *     factions: object[],
 *     world_rules: object[],
 *     lore_entries: object[]
 *   },
 *   ambiguity_flags: object[],
 *   provenance: object,
 *   warnings: string[]
 * }}
 */
export function parseAiNormalizedResponse(rawModelResponse, sourceText, options = {}) {
    let parsed = rawModelResponse;
    const warnings = [];
    const inferredFields = [];

    if (typeof rawModelResponse === 'string') {
        let cleanStr = rawModelResponse.trim();
        // Strip markdown code fences if present
        const jsonMatch = cleanStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch) {
            cleanStr = jsonMatch[1].trim();
        }

        try {
            parsed = JSON.parse(cleanStr);
        } catch (err) {
            const fallback = parseFreeformOutline(sourceText, options);
            fallback.warnings.push(`AI JSON parse failed (${err.message}). Falling back to heuristic text chunker.`);
            return fallback;
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        const fallback = parseFreeformOutline(sourceText, options);
        fallback.warnings.push('AI output is not a valid object. Falling back to heuristic text chunker.');
        return fallback;
    }

    parsed = sanitizePrototype(parsed);

    const sourceLower = sourceText.toLowerCase();

    // 1. World Root
    const rawWorld = parsed.world || {};
    const worldName = typeof rawWorld.name === 'string' && rawWorld.name.trim().length > 0
        ? normalizeUnicode(rawWorld.name.trim())
        : (options.filename ? options.filename.replace(/\.[^/.]+$/, '') : 'Imported World');

    const world = {
        name: worldName,
        description: normalizeUnicode(typeof rawWorld.description === 'string' ? rawWorld.description : ''),
        tags: Array.isArray(rawWorld.tags) ? rawWorld.tags.map(t => normalizeUnicode(String(t).trim())) : [],
    };

    // 2. Characters
    const characters = [];
    if (Array.isArray(parsed.characters)) {
        for (const c of parsed.characters) {
            if (!c || typeof c !== 'object') continue;
            const name = typeof c.name === 'string' ? normalizeUnicode(c.name.trim()) : '';
            if (!name) continue;

            // Negative no-invention check: verify character name appears in source text
            if (!sourceLower.includes(name.toLowerCase())) {
                inferredFields.push(`character:${name}`);
                warnings.push(`AI proposed character '${name}' which was not explicitly found in source text.`);
            }

            characters.push({
                name,
                description: normalizeUnicode(typeof c.description === 'string' ? c.description : ''),
                personality: normalizeUnicode(typeof c.personality === 'string' ? c.personality : ''),
                scenario_context: normalizeUnicode(typeof c.scenario_context === 'string' ? c.scenario_context : ''),
                mes_example: normalizeUnicode(typeof c.mes_example === 'string' ? c.mes_example : ''),
                tags: Array.isArray(c.tags) ? c.tags.map(t => normalizeUnicode(String(t).trim())) : [],
            });
        }
    }

    // 3. Locations
    const locations = [];
    if (Array.isArray(parsed.locations)) {
        for (const l of parsed.locations) {
            if (!l || typeof l !== 'object') continue;
            const name = typeof l.name === 'string' ? normalizeUnicode(l.name.trim()) : '';
            if (!name) continue;

            if (!sourceLower.includes(name.toLowerCase())) {
                inferredFields.push(`location:${name}`);
                warnings.push(`AI proposed location '${name}' which was not explicitly found in source text.`);
            }

            locations.push({
                name,
                description: normalizeUnicode(typeof l.description === 'string' ? l.description : ''),
                parent_location_name: typeof l.parent_location_name === 'string' ? normalizeUnicode(l.parent_location_name.trim()) : null,
                tags: Array.isArray(l.tags) ? l.tags.map(t => normalizeUnicode(String(t).trim())) : [],
            });
        }
    }

    // 4. Factions
    const factions = [];
    if (Array.isArray(parsed.factions)) {
        for (const f of parsed.factions) {
            if (!f || typeof f !== 'object') continue;
            const name = typeof f.name === 'string' ? normalizeUnicode(f.name.trim()) : '';
            if (!name) continue;

            if (!sourceLower.includes(name.toLowerCase())) {
                inferredFields.push(`faction:${name}`);
                warnings.push(`AI proposed faction '${name}' which was not explicitly found in source text.`);
            }

            factions.push({
                name,
                description: normalizeUnicode(typeof f.description === 'string' ? f.description : ''),
                tags: Array.isArray(f.tags) ? f.tags.map(t => normalizeUnicode(String(t).trim())) : [],
            });
        }
    }

    // 5. World Rules
    const worldRules = [];
    if (Array.isArray(parsed.world_rules)) {
        let order = 1;
        for (const r of parsed.world_rules) {
            if (!r || typeof r !== 'object') continue;
            const title = typeof r.title === 'string' ? normalizeUnicode(r.title.trim()) : '';
            if (!title) continue;

            worldRules.push({
                title,
                body: normalizeUnicode(typeof r.body === 'string' ? r.body : title),
                sort_order: order++,
            });
        }
    }

    const provenance = createProvenance({
        source_format: 'ai_assisted_extraction',
        source_filename: options.filename || null,
        canonical_object_hash: hashString(sourceText),
        inferred_fields: inferredFields,
        warnings,
    });

    return {
        candidate_entities: {
            world,
            characters,
            locations,
            factions,
            world_rules: worldRules,
            lore_entries: [],
        },
        ambiguity_flags: [],
        provenance,
        warnings,
    };
}

/**
 * Executes AI-assisted normalization over freeform text using a provided model caller function.
 *
 * @param {string} sourceText
 * @param {Function} [llmCaller] Async function (prompt) => Promise<string>
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function extractWithAi(sourceText, llmCaller = null, options = {}) {
    if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
        throw new LwsValidationError('sourceText is required for AI normalization', ['sourceText']);
    }

    if (typeof llmCaller !== 'function') {
        // Fallback to deterministic heuristic outline chunker when no LLM bridge is provided
        return parseFreeformOutline(sourceText, options);
    }

    const prompt = buildAiNormalizationPrompt(sourceText);

    let timerId = null;
    const timeoutMs = options.timeoutMs || 30000;
    const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('AI normalization timed out after 30 seconds')), timeoutMs);
    });

    try {
        const rawResponse = await Promise.race([
            llmCaller(prompt),
            timeoutPromise,
        ]);
        return parseAiNormalizedResponse(rawResponse, sourceText, options);
    } catch (err) {
        // Fallback to heuristic chunker on LLM error or timeout
        const result = parseFreeformOutline(sourceText, options);
        result.warnings.push(`AI extraction failed (${err.message}); fell back to heuristic text chunker.`);
        return result;
    } finally {
        if (timerId) {
            clearTimeout(timerId);
        }
    }
}
