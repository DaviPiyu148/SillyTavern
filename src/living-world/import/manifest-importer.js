import yaml from 'yaml';
import { LwsValidationError, LwsNotFoundError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashObject,
} from './common.js';
import { safeJsonParse, isoNow } from '../authored/common.js';

export const MANIFEST_SPEC = 'lws_world_manifest_v1';
export const MANIFEST_SPEC_VERSION = '1.0';

const MAX_CHARACTERS = 500;
const MAX_LOCATIONS = 500;
const MAX_FACTIONS = 100;
const MAX_RULES = 200;
const MAX_SCENARIOS = 100;
const MAX_ARCHETYPES = 100;
const MAX_LOCATION_DEPTH = 10;

/**
 * Safely parses a JSON or YAML string into a Manifest object.
 *
 * @param {string | object} input
 * @returns {object} Clean parsed manifest object
 */
export function parseManifestInput(input) {
    if (!input) {
        throw new LwsValidationError('Manifest input is required', ['input']);
    }

    if (typeof input === 'object' && input !== null) {
        return sanitizePrototype(input);
    }

    if (typeof input !== 'string') {
        throw new LwsValidationError('Manifest input must be a string or object', ['input']);
    }

    if (Buffer.byteLength(input, 'utf8') > 2 * 1024 * 1024) {
        throw new LwsValidationError('Manifest input exceeds maximum allowed size of 2 MB', ['input']);
    }

    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return sanitizePrototype(JSON.parse(trimmed));
        } catch (err) {
            throw new LwsValidationError(`Malformed JSON manifest: ${err.message}`, ['input']);
        }
    }

    try {
        const parsed = yaml.parse(trimmed, {
            customTags: [],
            maxAliasCount: 50,
            merge: true,
        });
        if (!parsed || typeof parsed !== 'object') {
            throw new LwsValidationError('Parsed YAML content is not an object', ['input']);
        }
        return sanitizePrototype(parsed);
    } catch (err) {
        throw new LwsValidationError(`Malformed YAML manifest: ${err.message}`, ['input']);
    }
}

/**
 * Validates a parsed World Manifest against structural bounds, schema constraints, and relational acyclicity.
 *
 * @param {object} rawManifest
 * @returns {{
 *   valid: boolean,
 *   manifest: object,
 *   summary: object,
 *   errors: string[],
 *   warnings: string[]
 * }}
 */
export function validateWorldManifest(rawManifest) {
    const errors = [];
    const warnings = [];

    if (!rawManifest || typeof rawManifest !== 'object') {
        return {
            valid: false,
            manifest: null,
            summary: {},
            errors: ['Manifest must be a non-null object'],
            warnings: [],
        };
    }

    const manifest = sanitizePrototype(rawManifest);

    const spec = manifest.spec || manifest.schema_version;
    if (spec !== MANIFEST_SPEC) {
        errors.push(`Invalid manifest spec '${spec}'. Expected '${MANIFEST_SPEC}'`);
    }

    if (!manifest.world || typeof manifest.world !== 'object') {
        errors.push('Manifest missing required root `world` object');
    } else {
        const worldName = manifest.world.name;
        if (typeof worldName !== 'string' || worldName.trim().length === 0) {
            errors.push('world.name is required and cannot be empty');
        } else if (worldName.trim().length > 255) {
            errors.push('world.name exceeds maximum length of 255 characters');
        }
    }

    const characters = Array.isArray(manifest.characters) ? manifest.characters : [];
    const locations = Array.isArray(manifest.locations) ? manifest.locations : [];
    const factions = Array.isArray(manifest.factions) ? manifest.factions : [];
    const worldRules = Array.isArray(manifest.world_rules) ? manifest.world_rules : [];
    const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
    const ambientArchetypes = Array.isArray(manifest.ambient_archetypes) ? manifest.ambient_archetypes : [];
    const characterFactions = Array.isArray(manifest.character_factions) ? manifest.character_factions : [];
    const scenarioCharacters = Array.isArray(manifest.scenario_characters) ? manifest.scenario_characters : [];

    // Cardinality limits
    if (characters.length > MAX_CHARACTERS) errors.push(`Character count (${characters.length}) exceeds limit of ${MAX_CHARACTERS}`);
    if (locations.length > MAX_LOCATIONS) errors.push(`Location count (${locations.length}) exceeds limit of ${MAX_LOCATIONS}`);
    if (factions.length > MAX_FACTIONS) errors.push(`Faction count (${factions.length}) exceeds limit of ${MAX_FACTIONS}`);
    if (worldRules.length > MAX_RULES) errors.push(`World rule count (${worldRules.length}) exceeds limit of ${MAX_RULES}`);
    if (scenarios.length > MAX_SCENARIOS) errors.push(`Scenario count (${scenarios.length}) exceeds limit of ${MAX_SCENARIOS}`);
    if (ambientArchetypes.length > MAX_ARCHETYPES) errors.push(`Ambient archetype count (${ambientArchetypes.length}) exceeds limit of ${MAX_ARCHETYPES}`);

    // Validate characters
    const charLwsIds = new Set();
    characters.forEach((c, idx) => {
        if (!c.name || typeof c.name !== 'string' || c.name.trim().length === 0) {
            errors.push(`characters[${idx}] missing required name`);
        }
        if (c.lws_id) charLwsIds.add(c.lws_id);
    });

    // Validate locations & hierarchy acyclicity
    const locLwsIds = new Set();
    const locParentMap = new Map(); // locLwsId -> parentLocLwsId
    locations.forEach((loc, idx) => {
        if (!loc.name || typeof loc.name !== 'string' || loc.name.trim().length === 0) {
            errors.push(`locations[${idx}] missing required name`);
        }
        if (loc.lws_id) {
            locLwsIds.add(loc.lws_id);
            const parentId = loc.parent_location_lws_id || loc.extensions?.parent_location_lws_id || null;
            if (parentId) {
                locParentMap.set(loc.lws_id, parentId);
            }
        }
    });

    // Check location hierarchy cycles and depth
    for (const [startId, parentId] of locParentMap.entries()) {
        let current = parentId;
        let depth = 1;
        const visited = new Set([startId]);

        while (current) {
            if (visited.has(current)) {
                errors.push(`Circular location hierarchy detected involving location '${current}'`);
                break;
            }
            visited.add(current);
            depth++;
            if (depth > MAX_LOCATION_DEPTH) {
                errors.push(`Location hierarchy exceeds maximum depth of ${MAX_LOCATION_DEPTH} levels`);
                break;
            }
            current = locParentMap.get(current);
        }
    }

    // Validate factions
    const factionLwsIds = new Set();
    factions.forEach((f, idx) => {
        if (!f.name || typeof f.name !== 'string' || f.name.trim().length === 0) {
            errors.push(`factions[${idx}] missing required name`);
        }
        if (f.lws_id) factionLwsIds.add(f.lws_id);
    });

    // Validate character_factions foreign keys if IDs are present
    characterFactions.forEach((cf, idx) => {
        if (cf.character_lws_id && charLwsIds.size > 0 && !charLwsIds.has(cf.character_lws_id)) {
            warnings.push(`character_factions[${idx}] references unknown character_lws_id '${cf.character_lws_id}'`);
        }
        if (cf.faction_lws_id && factionLwsIds.size > 0 && !factionLwsIds.has(cf.faction_lws_id)) {
            warnings.push(`character_factions[${idx}] references unknown faction_lws_id '${cf.faction_lws_id}'`);
        }
    });

    // Validate scenarios
    const scenarioLwsIds = new Set();
    scenarios.forEach((s, idx) => {
        if (!s.name || typeof s.name !== 'string' || s.name.trim().length === 0) {
            errors.push(`scenarios[${idx}] missing required name`);
        }
        if (s.lws_id) scenarioLwsIds.add(s.lws_id);
        if (s.starting_location_lws_id && locLwsIds.size > 0 && !locLwsIds.has(s.starting_location_lws_id)) {
            warnings.push(`scenarios[${idx}] starting_location_lws_id '${s.starting_location_lws_id}' not found in manifest locations`);
        }
    });

    const summary = {
        world_name: manifest.world?.name || '',
        characters: characters.length,
        locations: locations.length,
        factions: factions.length,
        world_rules: worldRules.length,
        scenarios: scenarios.length,
        ambient_archetypes: ambientArchetypes.length,
        character_factions: characterFactions.length,
        scenario_characters: scenarioCharacters.length,
    };

    return {
        valid: errors.length === 0,
        manifest,
        summary,
        errors,
        warnings,
    };
}

/**
 * Exports an entire World and all its active authored entities into a canonical `lws_world_manifest_v1` JSON structure.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string | number} worldIdentifier UUID string or integer ID
 * @returns {object} Canonical World Manifest
 */
export function exportWorldManifest(db, worldIdentifier) {
    if (!db || typeof db.prepare !== 'function') {
        throw new LwsValidationError('Valid database instance required for manifest export');
    }

    let worldRow;
    if (typeof worldIdentifier === 'number') {
        worldRow = db.prepare('SELECT id, lws_id, name, description, tags, extensions FROM lws_worlds WHERE id = ? AND deleted_at IS NULL').get(worldIdentifier);
    } else {
        worldRow = db.prepare('SELECT id, lws_id, name, description, tags, extensions FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL').get(worldIdentifier);
    }

    if (!worldRow) {
        throw new LwsNotFoundError(`World '${worldIdentifier}' not found`);
    }

    const worldId = worldRow.id;

    // 1. World Root
    const world = {
        lws_id: worldRow.lws_id,
        name: worldRow.name,
        description: worldRow.description || '',
        tags: safeJsonParse(worldRow.tags, []),
        extensions: safeJsonParse(worldRow.extensions, {}),
    };

    // 2. Characters
    const charRows = db.prepare(`
        SELECT lws_id, name, description, personality, scenario_context, mes_example,
               author_notes, system_prompt_override, source_version, tags, extensions
        FROM lws_characters
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    const characters = charRows.map(r => ({
        lws_id: r.lws_id,
        name: r.name,
        description: r.description || '',
        personality: r.personality || '',
        scenario_context: r.scenario_context || '',
        mes_example: r.mes_example || '',
        author_notes: r.author_notes || '',
        system_prompt_override: r.system_prompt_override || '',
        source_version: r.source_version || '',
        tags: safeJsonParse(r.tags, []),
        extensions: safeJsonParse(r.extensions, {}),
    }));

    // 3. Locations (with parent_location_lws_id from extensions or resolved)
    const locRows = db.prepare(`
        SELECT lws_id, name, description, tags, extensions
        FROM lws_locations
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    const locations = locRows.map(r => {
        const ext = safeJsonParse(r.extensions, {});
        return {
            lws_id: r.lws_id,
            name: r.name,
            description: r.description || '',
            parent_location_lws_id: ext.parent_location_lws_id || null,
            tags: safeJsonParse(r.tags, []),
            extensions: ext,
        };
    });

    // 4. Factions
    const factionRows = db.prepare(`
        SELECT lws_id, name, description, tags, extensions
        FROM lws_factions
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    const factions = factionRows.map(r => ({
        lws_id: r.lws_id,
        name: r.name,
        description: r.description || '',
        tags: safeJsonParse(r.tags, []),
        extensions: safeJsonParse(r.extensions, {}),
    }));

    // 5. Character Factions (Join Table)
    const charFactionRows = db.prepare(`
        SELECT c.lws_id AS character_lws_id, f.lws_id AS faction_lws_id, cf.role
        FROM lws_character_factions cf
        JOIN lws_characters c ON cf.character_id = c.id
        JOIN lws_factions f ON cf.faction_id = f.id
        WHERE c.world_id = ? AND c.deleted_at IS NULL AND f.deleted_at IS NULL
        ORDER BY c.lws_id ASC, f.lws_id ASC
    `).all(worldId);

    const characterFactions = charFactionRows.map(r => ({
        character_lws_id: r.character_lws_id,
        faction_lws_id: r.faction_lws_id,
        role: r.role || '',
    }));

    // 6. World Rules
    const ruleRows = db.prepare(`
        SELECT lws_id, sort_order, title, body
        FROM lws_world_rules
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
    `).all(worldId);

    const worldRules = ruleRows.map(r => ({
        lws_id: r.lws_id,
        sort_order: r.sort_order,
        title: r.title,
        body: r.body,
    }));

    // 7. Scenarios
    const scenarioRows = db.prepare(`
        SELECT s.lws_id, s.name, s.description, s.tags, s.extensions,
               loc.lws_id AS starting_location_lws_id
        FROM lws_scenarios s
        LEFT JOIN lws_locations loc ON s.starting_location_id = loc.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL
        ORDER BY s.name ASC, s.lws_id ASC
    `).all(worldId);

    const scenarios = scenarioRows.map(r => ({
        lws_id: r.lws_id,
        name: r.name,
        description: r.description || '',
        starting_location_lws_id: r.starting_location_lws_id || null,
        tags: safeJsonParse(r.tags, []),
        extensions: safeJsonParse(r.extensions, {}),
    }));

    // 8. Scenario Characters (Join Table)
    const scenCharRows = db.prepare(`
        SELECT s.lws_id AS scenario_lws_id, c.lws_id AS character_lws_id, sc.role
        FROM lws_scenario_characters sc
        JOIN lws_scenarios s ON sc.scenario_id = s.id
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY s.lws_id ASC, c.lws_id ASC
    `).all(worldId);

    const scenarioCharacters = scenCharRows.map(r => ({
        scenario_lws_id: r.scenario_lws_id,
        character_lws_id: r.character_lws_id,
        role: r.role || '',
    }));

    // 9. Ambient Archetypes
    const archRows = db.prepare(`
        SELECT lws_id, archetype_key, entity_kind, role_title, name_pool,
               description_template, default_activities, location_tags, time_windows,
               weather_compat, spawn_weight, max_concurrent_instances
        FROM lws_ambient_archetypes
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY archetype_key ASC, lws_id ASC
    `).all(worldId);

    const ambientArchetypes = archRows.map(r => ({
        lws_id: r.lws_id,
        archetype_key: r.archetype_key,
        entity_kind: r.entity_kind,
        role_title: r.role_title,
        name_pool: safeJsonParse(r.name_pool, []),
        description_template: r.description_template,
        default_activities: safeJsonParse(r.default_activities, []),
        location_tags: safeJsonParse(r.location_tags, []),
        time_windows: safeJsonParse(r.time_windows, []),
        weather_compat: safeJsonParse(r.weather_compat, null),
        spawn_weight: r.spawn_weight,
        max_concurrent_instances: r.max_concurrent_instances,
    }));

    // 10. Authored Prompt Config
    const promptConfigRow = db.prepare(`
        SELECT lws_id, style_notes, tone_notes, format_notes, extensions
        FROM lws_authored_prompt_configs
        WHERE world_id = ?
    `).get(worldId);

    const promptConfig = promptConfigRow ? {
        lws_id: promptConfigRow.lws_id,
        style_notes: promptConfigRow.style_notes || '',
        tone_notes: promptConfigRow.tone_notes || '',
        format_notes: promptConfigRow.format_notes || '',
        extensions: safeJsonParse(promptConfigRow.extensions, {}),
    } : null;

    return {
        spec: MANIFEST_SPEC,
        schema_version: MANIFEST_SPEC,
        spec_version: MANIFEST_SPEC_VERSION,
        exported_at: isoNow(),
        world,
        characters,
        locations,
        factions,
        character_factions: characterFactions,
        world_rules: worldRules,
        scenarios,
        scenario_characters: scenarioCharacters,
        ambient_archetypes: ambientArchetypes,
        prompt_config: promptConfig,
    };
}

/**
 * Checks round-trip parity between an exported manifest and a re-imported manifest according to Section 10.3 contract.
 *
 * @param {object} original
 * @param {object} reimported
 * @returns {{ match: boolean, discrepancies: string[] }}
 */
export function compareManifestParity(original, reimported) {
    const discrepancies = [];

    if (!original || !reimported) {
        return { match: false, discrepancies: ['One or both manifests are null/undefined'] };
    }

    // World root comparison
    if (normalizeUnicode(original.world?.name) !== normalizeUnicode(reimported.world?.name)) {
        discrepancies.push(`World name mismatch: '${original.world?.name}' vs '${reimported.world?.name}'`);
    }
    if (normalizeUnicode(original.world?.description || '') !== normalizeUnicode(reimported.world?.description || '')) {
        discrepancies.push(`World description mismatch`);
    }

    // Collections count check
    const checkCounts = [
        ['characters', original.characters?.length || 0, reimported.characters?.length || 0],
        ['locations', original.locations?.length || 0, reimported.locations?.length || 0],
        ['factions', original.factions?.length || 0, reimported.factions?.length || 0],
        ['world_rules', original.world_rules?.length || 0, reimported.world_rules?.length || 0],
        ['scenarios', original.scenarios?.length || 0, reimported.scenarios?.length || 0],
        ['ambient_archetypes', original.ambient_archetypes?.length || 0, reimported.ambient_archetypes?.length || 0],
    ];

    for (const [entityName, origCount, reimpCount] of checkCounts) {
        if (origCount !== reimpCount) {
            discrepancies.push(`${entityName} count mismatch: ${origCount} vs ${reimpCount}`);
        }
    }

    return {
        match: discrepancies.length === 0,
        discrepancies,
    };
}
