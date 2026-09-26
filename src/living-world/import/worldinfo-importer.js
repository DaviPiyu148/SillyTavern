import { LwsValidationError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashObject,
    hashString,
    createProvenance,
} from './common.js';

const RULE_KEYWORDS = ['always', 'cannot', 'must', 'law of', 'physics', 'system rule', 'forbidden', 'mechanic', 'stat', 'mandatory', 'never allow', 'universal rule'];
const LOCATION_KEYWORDS = ['room', 'city', 'tavern', 'castle', 'forest', 'district', 'located at', 'north of', 'south of', 'building', 'street', 'valley', 'dungeon', 'temple', 'mountain', 'island', 'ocean', 'palace'];
const FACTION_KEYWORDS = ['guild', 'order', 'army', 'clan', 'syndicate', 'alliance', 'kingdom', 'cult', 'faction', 'members', 'brotherhood', 'council', 'regiment', 'corps', 'dynasty'];
const ARCHETYPE_KEYWORDS = ['guards', 'patrons', 'merchants', 'villagers', 'bandits', 'citizens', 'crowd', 'nameless', 'ambient', 'townsfolk', 'pedestrians', 'travelers', 'sailors', 'thugs'];
const CHARACTER_PRONOUNS = ['he is', 'she is', 'they are', 'his life', 'her life', 'their background', 'born in', 'personality:', 'dialogue:'];

/**
 * Evaluates 5D structural classification scores for a single lorebook entry.
 *
 * @param {object} entry
 * @returns {{
 *   scores: { rule: number, location: number, faction: number, archetype: number, character: number },
 *   topCategory: 'rule' | 'location' | 'faction' | 'archetype' | 'character' | 'lore',
 *   maxScore: number,
 *   margin: number,
 *   isAmbiguous: boolean
 * }}
 */
export function classifyLoreEntry(entry) {
    const text = [
        entry.comment || '',
        entry.key || '',
        Array.isArray(entry.keys) ? entry.keys.join(' ') : (entry.keys || ''),
        Array.isArray(entry.secondary_keys) ? entry.secondary_keys.join(' ') : (entry.secondary_keys || ''),
        entry.content || '',
    ].join(' ').toLowerCase();

    // 1. Rule score (S_rule)
    let sRule = 0;
    const ruleMatchCount = RULE_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (ruleMatchCount > 0) sRule += Math.min(0.35, ruleMatchCount * 0.15);
    if (entry.constant === true || entry.selective === false) sRule += 0.35;
    if (text.includes('->') || /rule/i.test(text) || /law/i.test(text) || text.includes('must') || text.includes('cannot')) sRule += 0.30;
    sRule = Math.min(1.0, sRule);

    // 2. Location score (S_loc)
    let sLoc = 0;
    const locMatchCount = LOCATION_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (locMatchCount > 0) sLoc += Math.min(0.40, locMatchCount * 0.20);
    if (text.includes('inside') || text.includes('located') || text.includes('north') || text.includes('south') || text.includes('capital of') || text.includes('stationed')) sLoc += 0.30;
    if (Array.isArray(entry.keys) && entry.keys.some(k => LOCATION_KEYWORDS.some(kw => String(k).toLowerCase().includes(kw)))) sLoc += 0.30;
    sLoc = Math.min(1.0, sLoc);

    // 3. Faction score (S_fac)
    let sFac = 0;
    const facMatchCount = FACTION_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (facMatchCount > 0) sFac += Math.min(0.40, facMatchCount * 0.20);
    if (text.includes('leader') || text.includes('rank') || text.includes('headquarters') || text.includes('founded by')) sFac += 0.30;
    if (Array.isArray(entry.keys) && entry.keys.some(k => FACTION_KEYWORDS.some(kw => String(k).toLowerCase().includes(kw)))) sFac += 0.30;
    sFac = Math.min(1.0, sFac);

    // 4. Archetype score (S_arch)
    let sArch = 0;
    const archMatchCount = ARCHETYPE_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (archMatchCount > 0) sArch += Math.min(0.40, archMatchCount * 0.20);
    if (text.includes('spawns') || text.includes('patrol') || text.includes('wanders') || text.includes('generic') || text.includes('stationed')) sArch += 0.30;
    if (text.includes('guards') || text.includes('merchants') || text.includes('villagers') || text.includes('patrons')) sArch += 0.30;
    sArch = Math.min(1.0, sArch);

    // 5. Character score (S_char)
    let sChar = 0;
    const charMatchCount = CHARACTER_PRONOUNS.filter(kw => text.includes(kw)).length;
    if (charMatchCount > 0) sChar += Math.min(0.50, charMatchCount * 0.25);
    if (text.includes('personality') || text.includes('appearance') || text.includes('dialogue') || text.includes('likes') || text.includes('dislikes')) sChar += 0.50;
    sChar = Math.min(1.0, sChar);

    const scores = {
        rule: Number(sRule.toFixed(2)),
        location: Number(sLoc.toFixed(2)),
        faction: Number(sFac.toFixed(2)),
        archetype: Number(sArch.toFixed(2)),
        character: Number(sChar.toFixed(2)),
    };

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const maxScore = sorted[0][1];
    const secondScore = sorted[1][1];
    const margin = Number((maxScore - secondScore).toFixed(2));

    let topCategory = 'lore';
    let isAmbiguous = false;

    if (maxScore >= 0.80 && margin >= 0.20) {
        topCategory = sorted[0][0];
        isAmbiguous = false;
    } else if (maxScore >= 0.50 && margin < 0.20) {
        topCategory = sorted[0][0];
        isAmbiguous = true;
    } else {
        topCategory = 'lore';
        isAmbiguous = false;
    }

    return {
        scores,
        topCategory,
        maxScore,
        margin,
        isAmbiguous,
    };
}

/**
 * Extracts entry title or name from keys, comment, or first sentence.
 *
 * @param {object} entry
 * @returns {string}
 */
export function extractEntryName(entry) {
    if (typeof entry.comment === 'string' && entry.comment.trim().length > 0) {
        return normalizeUnicode(entry.comment.trim());
    }
    if (Array.isArray(entry.keys) && entry.keys.length > 0 && typeof entry.keys[0] === 'string' && entry.keys[0].trim().length > 0) {
        return normalizeUnicode(entry.keys[0].trim());
    }
    if (typeof entry.key === 'string' && entry.key.trim().length > 0) {
        return normalizeUnicode(entry.key.trim());
    }
    if (typeof entry.content === 'string' && entry.content.trim().length > 0) {
        const firstLine = entry.content.trim().split('\n')[0].trim();
        return normalizeUnicode(firstLine.slice(0, 100));
    }
    return 'Unnamed Entry';
}

/**
 * Normalizes a World Info / Lorebook JSON payload into classified candidate entities.
 *
 * @param {object | string} rawInput
 * @param {object} [options]
 * @param {string} [options.filename]
 * @returns {{
 *   summary: {
 *     total_entries: number,
 *     classified_rules: number,
 *     classified_locations: number,
 *     classified_factions: number,
 *     classified_archetypes: number,
 *     classified_characters: number,
 *     lore_entries: number,
 *     ambiguous_entries: number
 *   },
 *   candidate_entities: {
 *     world_rules: object[],
 *     locations: object[],
 *     factions: object[],
 *     ambient_archetypes: object[],
 *     characters: object[],
 *     lore_entries: object[]
 *   },
 *   ambiguity_flags: object[],
 *   provenance: object,
 *   warnings: string[]
 * }}
 */
export function normalizeWorldInfo(rawInput, options = {}) {
    let book = rawInput;
    if (typeof rawInput === 'string') {
        try {
            book = JSON.parse(rawInput);
        } catch (err) {
            throw new LwsValidationError(`Malformed Lorebook JSON: ${err.message}`, ['rawInput']);
        }
    }

    if (!book || typeof book !== 'object') {
        throw new LwsValidationError('Lorebook input must be an object', ['rawInput']);
    }

    book = sanitizePrototype(book);

    // Extract entries list
    let entries = [];
    if (Array.isArray(book.entries)) {
        entries = book.entries;
    } else if (book.entries && typeof book.entries === 'object') {
        entries = Object.values(book.entries);
    } else if (Array.isArray(book)) {
        entries = book;
    } else if (book.character_book?.entries) {
        entries = Array.isArray(book.character_book.entries) ? book.character_book.entries : Object.values(book.character_book.entries);
    }

    if (entries.length > 1000) {
        throw new LwsValidationError(`Lorebook exceeds maximum limit of 1000 entries (found ${entries.length})`, ['entries']);
    }

    const candidateEntities = {
        world_rules: [],
        locations: [],
        factions: [],
        ambient_archetypes: [],
        characters: [],
        lore_entries: [],
    };

    const ambiguityFlags = [];
    const warnings = [];

    let sortOrder = 1;

    for (let i = 0; i < entries.length; i++) {
        const rawEntry = entries[i];
        if (!rawEntry || typeof rawEntry !== 'object') continue;

        const entryUid = rawEntry.uid ?? rawEntry.id ?? `entry_${i}`;
        const name = extractEntryName(rawEntry);
        const content = normalizeUnicode(typeof rawEntry.content === 'string' ? rawEntry.content : '');
        const classification = classifyLoreEntry(rawEntry);

        if (classification.isAmbiguous) {
            ambiguityFlags.push({
                entry_uid: String(entryUid),
                name,
                candidate_types: Object.entries(classification.scores)
                    .filter(([_, score]) => score >= 0.50)
                    .map(([cat]) => cat),
                scores: classification.scores,
                source_entry: rawEntry,
            });
            // Ambiguous entries are placed in lore_entries until user resolves them
            candidateEntities.lore_entries.push({
                uid: String(entryUid),
                name,
                content,
                keys: rawEntry.keys || [],
                raw_entry: rawEntry,
                ambiguous: true,
            });
            continue;
        }

        switch (classification.topCategory) {
            case 'rule': {
                candidateEntities.world_rules.push({
                    title: name,
                    body: content || name,
                    sort_order: sortOrder++,
                    source_uid: String(entryUid),
                });
                break;
            }
            case 'location': {
                candidateEntities.locations.push({
                    name,
                    description: content,
                    tags: Array.isArray(rawEntry.keys) ? rawEntry.keys.map(k => String(k).trim()) : [],
                    extensions: { source_uid: String(entryUid) },
                });
                break;
            }
            case 'faction': {
                candidateEntities.factions.push({
                    name,
                    description: content,
                    tags: Array.isArray(rawEntry.keys) ? rawEntry.keys.map(k => String(k).trim()) : [],
                    extensions: { source_uid: String(entryUid) },
                });
                break;
            }
            case 'archetype': {
                const archetypeKey = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) || `archetype_${i}`;
                candidateEntities.ambient_archetypes.push({
                    archetype_key: archetypeKey,
                    entity_kind: 'person',
                    role_title: name,
                    description_template: content || `${name} in the world`,
                    name_pool: [name],
                    default_activities: ['patrolling', 'wandering'],
                    location_tags: Array.isArray(rawEntry.keys) ? rawEntry.keys.map(k => String(k).trim()) : [],
                    time_windows: ['morning', 'afternoon', 'evening'],
                    spawn_weight: 50,
                    max_concurrent_instances: 5,
                    source_uid: String(entryUid),
                });
                break;
            }
            case 'character': {
                candidateEntities.characters.push({
                    name,
                    description: content,
                    personality: '',
                    scenario_context: '',
                    mes_example: '',
                    tags: Array.isArray(rawEntry.keys) ? rawEntry.keys.map(k => String(k).trim()) : [],
                    extensions: { source_uid: String(entryUid) },
                });
                break;
            }
            default: {
                // Default lore fallback (preserves "Lore is not physical reality")
                candidateEntities.lore_entries.push({
                    uid: String(entryUid),
                    name,
                    content,
                    keys: rawEntry.keys || [],
                    raw_entry: rawEntry,
                });
                break;
            }
        }
    }

    if (ambiguityFlags.length > 0) {
        warnings.push(`Found ${ambiguityFlags.length} ambiguous entries requiring user review`);
    }

    const summary = {
        total_entries: entries.length,
        classified_rules: candidateEntities.world_rules.length,
        classified_locations: candidateEntities.locations.length,
        classified_factions: candidateEntities.factions.length,
        classified_archetypes: candidateEntities.ambient_archetypes.length,
        classified_characters: candidateEntities.characters.length,
        lore_entries: candidateEntities.lore_entries.length,
        ambiguous_entries: ambiguityFlags.length,
    };

    const provenance = createProvenance({
        source_format: 'worldinfo_v1',
        source_filename: options.filename || null,
        canonical_object_hash: hashObject(book),
        warnings,
    });

    return {
        summary,
        candidate_entities: candidateEntities,
        ambiguity_flags: ambiguityFlags,
        provenance,
        warnings,
    };
}
