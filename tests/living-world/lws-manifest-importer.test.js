import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createFaction, addFactionMember } from '../../src/living-world/authored/factions.js';
import { createScenario, addScenarioCharacter } from '../../src/living-world/authored/scenarios.js';
import { createWorldRule } from '../../src/living-world/authored/world-rules.js';
import { createPromptConfig } from '../../src/living-world/authored/prompt-configs.js';
import { createAmbientArchetype } from '../../src/living-world/population/archetypes.js';
import {
    parseManifestInput,
    validateWorldManifest,
    exportWorldManifest,
    compareManifestParity,
    MANIFEST_SPEC,
} from '../../src/living-world/import/manifest-importer.js';

describe('LWS Canonical Manifest Importer & Exporter (lws_world_manifest_v1)', () => {
    beforeEach(() => {
        openDb(':memory:');
    });

    afterEach(() => {
        closeDb();
    });

    describe('Manifest Parsing (JSON & YAML)', () => {
        it('parses valid JSON manifest correctly', () => {
            const json = JSON.stringify({
                spec: MANIFEST_SPEC,
                spec_version: '1.0',
                world: { name: 'Aethelgard' },
            });
            const manifest = parseManifestInput(json);
            expect(manifest.spec).toBe(MANIFEST_SPEC);
            expect(manifest.world.name).toBe('Aethelgard');
        });

        it('parses valid safe YAML manifest correctly', () => {
            const yamlStr = `
spec: lws_world_manifest_v1
spec_version: "1.0"
world:
  name: "Valoria"
  description: "A realm of magic and machines."
`;
            const manifest = parseManifestInput(yamlStr);
            expect(manifest.spec).toBe(MANIFEST_SPEC);
            expect(manifest.world.name).toBe('Valoria');
            expect(manifest.world.description).toBe('A realm of magic and machines.');
        });
    });

    describe('Manifest Schema & Acyclicity Validation', () => {
        it('validates a well-formed manifest with full relational graph', () => {
            const manifest = {
                spec: MANIFEST_SPEC,
                spec_version: '1.0',
                world: { name: 'Kingdom of Eldoria' },
                characters: [
                    { lws_id: 'c1', name: 'Sir Galahad' },
                    { lws_id: 'c2', name: 'Lady Guinevere' },
                ],
                locations: [
                    { lws_id: 'l1', name: 'Capital City' },
                    { lws_id: 'l2', name: 'Royal Palace', parent_location_lws_id: 'l1' },
                ],
                factions: [
                    { lws_id: 'f1', name: 'Knights of the Realm' },
                ],
                character_factions: [
                    { character_lws_id: 'c1', faction_lws_id: 'f1', role: 'Captain' },
                ],
                world_rules: [
                    { title: 'Chivalric Code', body: 'Protect the weak.' },
                ],
            };

            const val = validateWorldManifest(manifest);
            expect(val.valid).toBe(true);
            expect(val.errors).toHaveLength(0);
            expect(val.summary.characters).toBe(2);
            expect(val.summary.locations).toBe(2);
        });

        it('detects and rejects circular location hierarchies', () => {
            const cyclicManifest = {
                spec: MANIFEST_SPEC,
                spec_version: '1.0',
                world: { name: 'Cyclic Realm' },
                locations: [
                    { lws_id: 'loc_a', name: 'Location A', parent_location_lws_id: 'loc_b' },
                    { lws_id: 'loc_b', name: 'Location B', parent_location_lws_id: 'loc_a' },
                ],
            };

            const val = validateWorldManifest(cyclicManifest);
            expect(val.valid).toBe(false);
            expect(val.errors.some(e => e.includes('Circular location hierarchy'))).toBe(true);
        });

        it('rejects manifests missing required world name or invalid spec', () => {
            const badSpec = { spec: 'invalid_spec', world: { name: 'Test' } };
            expect(validateWorldManifest(badSpec).valid).toBe(false);

            const missingName = { spec: MANIFEST_SPEC, world: { name: '' } };
            expect(validateWorldManifest(missingName).valid).toBe(false);
        });
    });

    describe('Symmetric World Export Serializer', () => {
        it('exports a complete world with all 10 authored tables into canonical manifest', () => {
            const db = getDb();
            const world = createWorld({ name: 'Export Test World', description: 'Testing symmetric export' });

            const char = createCharacter(world.lws_id, {
                name: 'Theron',
                description: 'A master archer',
                personality: 'Quiet and observant',
            });

            const loc1 = createLocation(world.lws_id, { name: 'Great Forest' });
            const loc2 = createLocation(world.lws_id, {
                name: 'Elven Camp',
                extensions: { parent_location_lws_id: loc1.lws_id },
            });

            const faction = createFaction(world.lws_id, { name: 'Rangers of the Wild' });
            addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Scout' });

            createWorldRule(world.lws_id, { sort_order: 1, title: 'Forest Law', body: 'Harm no ancient trees.' });
            createPromptConfig(world.lws_id, { style_notes: 'Mythic and lyrical' });

            const scenario = createScenario(world.lws_id, {
                name: 'The Hunt',
                starting_location_lws_id: loc2.lws_id,
            });
            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char.lws_id, role: 'Protagonist' });

            createAmbientArchetype(db, world.lws_id, {
                archetype_key: 'forest_ranger',
                entity_kind: 'person',
                role_title: 'Ranger',
                name_pool: ['Robin', 'Faye'],
                description_template: 'A woodland ranger.',
            });

            const exported = exportWorldManifest(db, world.lws_id);

            expect(exported.spec).toBe(MANIFEST_SPEC);
            expect(exported.world.name).toBe('Export Test World');
            expect(exported.characters).toHaveLength(1);
            expect(exported.characters[0].name).toBe('Theron');
            expect(exported.locations).toHaveLength(2);
            expect(exported.factions).toHaveLength(1);
            expect(exported.character_factions).toHaveLength(1);
            expect(exported.character_factions[0].role).toBe('Scout');
            expect(exported.world_rules).toHaveLength(1);
            expect(exported.scenarios).toHaveLength(1);
            expect(exported.scenario_characters).toHaveLength(1);
            expect(exported.ambient_archetypes).toHaveLength(1);
            expect(exported.prompt_config.style_notes).toBe('Mythic and lyrical');

            // Verify parity check
            const parity = compareManifestParity(exported, exported);
            expect(parity.match).toBe(true);
            expect(parity.discrepancies).toHaveLength(0);
        });
    });
});
