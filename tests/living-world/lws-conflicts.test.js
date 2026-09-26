import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createFaction } from '../../src/living-world/authored/factions.js';
import { createScenario } from '../../src/living-world/authored/scenarios.js';
import { createAmbientArchetype } from '../../src/living-world/population/archetypes.js';
import {
    detectCollisions,
    generateDisambiguatedName,
    mergeTags,
    mergeExtensions,
    CONFLICT_TYPES,
} from '../../src/living-world/import/conflicts.js';

describe('LWS Conflict Detection & Resolution Policies', () => {
    beforeEach(() => {
        openDb(':memory:');
    });

    afterEach(() => {
        closeDb();
    });

    describe('Active Collision Detection', () => {
        it('detects active name collisions across characters, locations, factions, scenarios, and archetypes', () => {
            const db = getDb();
            const world = createWorld({ name: 'Conflict Realm' });

            createCharacter(world.lws_id, { name: 'Sir Galahad' });
            createLocation(world.lws_id, { name: 'Camelot' });
            createFaction(world.lws_id, { name: 'Round Table' });
            createScenario(world.lws_id, { name: 'Grail Quest' });
            createAmbientArchetype(db, world.lws_id, {
                archetype_key: 'peasant_farmer',
                entity_kind: 'person',
                role_title: 'Farmer',
                name_pool: ['John'],
                description_template: 'A farmer.',
            });

            const incomingCandidates = {
                characters: [{ name: 'sir galahad' }, { name: 'Merlin' }],
                locations: [{ name: 'Camelot' }, { name: 'Avalon' }],
                factions: [{ name: 'Round Table' }],
                scenarios: [{ name: 'Grail Quest' }],
                ambient_archetypes: [{ archetype_key: 'peasant_farmer' }, { archetype_key: 'castle_guard' }],
            };

            const conflicts = detectCollisions(db, world.lws_id, incomingCandidates);

            expect(conflicts).toHaveLength(5);
            expect(conflicts.some(c => c.colliding_entity.name === 'Sir Galahad')).toBe(true);
            expect(conflicts.some(c => c.colliding_entity.name === 'Camelot')).toBe(true);
            expect(conflicts.some(c => c.colliding_entity.name === 'Round Table')).toBe(true);
            expect(conflicts.some(c => c.colliding_entity.name === 'Grail Quest')).toBe(true);
            expect(conflicts.some(c => c.conflict_type === CONFLICT_TYPES.IDENTITY_COLLISION_KEY)).toBe(true);
        });

        it('returns zero conflicts when candidate names do not collide', () => {
            const db = getDb();
            const world = createWorld({ name: 'Fresh Realm' });

            const incomingCandidates = {
                characters: [{ name: 'Unique Char' }],
                locations: [{ name: 'Unique Loc' }],
            };

            const conflicts = detectCollisions(db, world.lws_id, incomingCandidates);
            expect(conflicts).toHaveLength(0);
        });
    });

    describe('Disambiguated Name Generation', () => {
        it('generates incremental disambiguated names (Import 2, Import 3)', () => {
            const db = getDb();
            const world = createWorld({ name: 'Disambiguation World' });

            createCharacter(world.lws_id, { name: 'Arthur' });
            createCharacter(world.lws_id, { name: 'Arthur (Import 2)' });

            const newName = generateDisambiguatedName(db, 'lws_characters', world.lws_id, 'Arthur');
            expect(newName).toBe('Arthur (Import 3)');
        });
    });

    describe('Merge Utilities (Tags & Extensions)', () => {
        it('merges tags as a set union without duplicate strings', () => {
            const existing = ['hero', 'magic', 'warrior'];
            const incoming = ['warrior', 'mage', 'hero', 'quest'];

            const merged = mergeTags(existing, incoming);
            expect(merged).toEqual(expect.arrayContaining(['hero', 'magic', 'warrior', 'mage', 'quest']));
            expect(merged).toHaveLength(5);
        });

        it('deep merges extensions objects while stripping dangerous keys', () => {
            const existing = {
                note: 'Original',
                nested: { a: 1, b: 2 },
            };
            const incoming = {
                note: 'Updated',
                nested: { b: 20, c: 30 },
                __proto__: { polluted: true },
            };

            const merged = mergeExtensions(existing, incoming);
            expect(merged.note).toBe('Updated');
            expect(merged.nested.a).toBe(1);
            expect(merged.nested.b).toBe(20);
            expect(merged.nested.c).toBe(30);
            expect({}.polluted).toBeUndefined();
        });
    });
});
