import { LwsValidationError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashString,
    createProvenance,
} from './common.js';

/**
 * Chunks and extracts candidate authored entities from unstructured freeform text or Markdown outlines.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.filename]
 * @returns {{
 *   candidate_entities: {
 *     world: object | null,
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
export function parseFreeformOutline(text, options = {}) {
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw new LwsValidationError('Freeform text input is required and cannot be empty', ['text']);
    }

    const normText = normalizeUnicode(text.trim());
    const lines = normText.split(/\r?\n/);

    const candidates = {
        world: null,
        characters: [],
        locations: [],
        factions: [],
        world_rules: [],
        lore_entries: [],
    };

    const ambiguityFlags = [];
    const warnings = [];

    let currentSection = 'general';
    let currentEntity = null;
    let ruleSortOrder = 1;

    function flushCurrentEntity() {
        if (!currentEntity) return;

        const name = currentEntity.name?.trim();
        const desc = currentEntity.body?.join('\n').trim() || '';

        if (!name && !desc) {
            currentEntity = null;
            return;
        }

        const safeName = name || (desc.slice(0, 50) + '...');

        switch (currentEntity.type) {
            case 'character':
                candidates.characters.push({
                    name: safeName,
                    description: desc,
                    personality: '',
                    scenario_context: '',
                    mes_example: '',
                    tags: [],
                });
                break;
            case 'location':
                candidates.locations.push({
                    name: safeName,
                    description: desc,
                    tags: [],
                });
                break;
            case 'faction':
                candidates.factions.push({
                    name: safeName,
                    description: desc,
                    tags: [],
                });
                break;
            case 'rule':
                candidates.world_rules.push({
                    title: safeName,
                    body: desc || safeName,
                    sort_order: ruleSortOrder++,
                });
                break;
            case 'world':
                candidates.world = {
                    name: safeName,
                    description: desc,
                    tags: [],
                };
                break;
            default:
                candidates.lore_entries.push({
                    name: safeName,
                    content: desc,
                });
                break;
        }
        currentEntity = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Check top-level headings (# Header)
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            flushCurrentEntity();
            const level = headingMatch[1].length;
            const headingTitle = headingMatch[2].trim();
            const lowerTitle = headingTitle.toLowerCase();

            if (lowerTitle.startsWith('world:') || lowerTitle.startsWith('world -') || lowerTitle === 'world' || lowerTitle === 'setting') {
                currentSection = 'world';
                const namePart = headingTitle.replace(/^world[:\s-]+/i, '').trim();
                currentEntity = { type: 'world', name: namePart || 'Unnamed World', body: [] };
            } else if (lowerTitle.startsWith('character:') || lowerTitle.startsWith('npc:')) {
                currentSection = 'characters';
                const namePart = headingTitle.replace(/^(character|npc)[:\s-]+/i, '').trim();
                currentEntity = { type: 'character', name: namePart || 'Unnamed Character', body: [] };
            } else if (lowerTitle.startsWith('location:') || lowerTitle.startsWith('place:')) {
                currentSection = 'locations';
                const namePart = headingTitle.replace(/^(location|place)[:\s-]+/i, '').trim();
                currentEntity = { type: 'location', name: namePart || 'Unnamed Location', body: [] };
            } else if (lowerTitle.startsWith('faction:') || lowerTitle.startsWith('guild:') || lowerTitle.startsWith('order:')) {
                currentSection = 'factions';
                const namePart = headingTitle.replace(/^(faction|guild|order)[:\s-]+/i, '').trim();
                currentEntity = { type: 'faction', name: namePart || 'Unnamed Faction', body: [] };
            } else if (lowerTitle.startsWith('rule:') || lowerTitle.startsWith('law:')) {
                currentSection = 'rules';
                const namePart = headingTitle.replace(/^(rule|law)[:\s-]+/i, '').trim();
                currentEntity = { type: 'rule', name: namePart || 'Unnamed Rule', body: [] };
            } else if (lowerTitle.includes('character') || lowerTitle.includes('npc') || lowerTitle.includes('cast')) {
                currentSection = 'characters';
            } else if (lowerTitle.includes('location') || lowerTitle.includes('places') || lowerTitle.includes('geography')) {
                currentSection = 'locations';
            } else if (lowerTitle.includes('faction') || lowerTitle.includes('guild') || lowerTitle.includes('organizations')) {
                currentSection = 'factions';
            } else if (lowerTitle.includes('rule') || lowerTitle.includes('laws') || lowerTitle.includes('mechanics')) {
                currentSection = 'rules';
            } else if (level >= 2 && currentSection !== 'general') {
                // Sub-heading under a known section
                const entityType = currentSection === 'characters' ? 'character'
                    : currentSection === 'locations' ? 'location'
                    : currentSection === 'factions' ? 'faction'
                    : currentSection === 'rules' ? 'rule' : 'lore';
                currentEntity = { type: entityType, name: headingTitle, body: [] };
            } else {
                currentSection = 'general';
                currentEntity = { type: 'lore', name: headingTitle, body: [] };
            }
            continue;
        }

        // Bullet point item (- Item: Description or * Item: Description)
        const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
            const content = bulletMatch[1].trim();
            const colonIdx = content.indexOf(':');

            if (colonIdx > 0 && colonIdx < 60) {
                flushCurrentEntity();
                const itemTitle = content.slice(0, colonIdx).trim();
                const itemDesc = content.slice(colonIdx + 1).trim();

                const entityType = currentSection === 'characters' ? 'character'
                    : currentSection === 'locations' ? 'location'
                    : currentSection === 'factions' ? 'faction'
                    : currentSection === 'rules' ? 'rule' : 'lore';

                currentEntity = {
                    type: entityType,
                    name: itemTitle,
                    body: itemDesc ? [itemDesc] : [],
                };
                flushCurrentEntity();
                continue;
            }
        }

        if (currentEntity) {
            currentEntity.body.push(line);
        } else {
            // General paragraph
            currentEntity = { type: 'lore', name: line.slice(0, 50), body: [line] };
        }
    }

    flushCurrentEntity();

    // Default world if none extracted
    if (!candidates.world) {
        candidates.world = {
            name: options.filename ? options.filename.replace(/\.[^/.]+$/, '') : 'Imported World',
            description: 'Created from freeform text import.',
            tags: ['freeform_import'],
        };
    }

    const provenance = createProvenance({
        source_format: 'freeform',
        source_filename: options.filename || null,
        canonical_object_hash: hashString(normText),
        warnings,
    });

    return {
        candidate_entities: candidates,
        ambiguity_flags: ambiguityFlags,
        provenance,
        warnings,
    };
}
