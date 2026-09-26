import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { createAmbientArchetype } from '../../src/living-world/population/archetypes.js';
import { validateTransientIdExistence, listPromotedEntities } from '../../src/living-world/population/promotion.js';
import { buildTransientId, getTimeBucket } from '../../src/living-world/population/common.js';
import { commitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { getCharacterTier } from '../../src/living-world/population/character-tiers.js';

describe('Phase 9 - Dynamic Entity Promotion Pipeline', () => {
    let db;
    let world;
    let location;
    let simulation;
    let archetype;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Test World', summary: 'World for promotion tests' });
        location = createLocation(world.lws_id, { name: 'Market Square', summary: 'Open marketplace' });
        simulation = createSimulation(world.lws_id, { name: 'Test Sim', initial_fictional_time: '2026-06-15T10:00:00Z' });

        archetype = createAmbientArchetype(db, world.lws_id, {
            archetype_key: 'baker',
            name: 'Market Baker',
            description: 'A local baker selling bread.',
            roles: ['baker'],
            weight: 50,
            location_filter_tags: [],
            time_filter_buckets: [],
        });
    });

    afterEach(() => {
        closeDb();
    });

    it('validates transient ID existence proof accurately', () => {
        const timeBucket = getTimeBucket('2026-06-15T10:00:00Z');
        const validTransientId = buildTransientId(simulation.lws_id, location.lws_id, timeBucket, 'baker', 0);

        // Validation against matching state should succeed
        const validation = validateTransientIdExistence(db, 1, validTransientId, '2026-06-15T10:00:00Z');
        expect(validation.valid).toBe(true);
        expect(validation.archetype_key).toBe('baker');

        // Validation with fabricated archetype should fail
        const fakeTransientId = buildTransientId(simulation.lws_id, location.lws_id, timeBucket, 'dragon_slayer', 0);
        const fakeValidation = validateTransientIdExistence(db, 1, fakeTransientId, '2026-06-15T10:00:00Z');
        expect(fakeValidation.valid).toBe(false);
        expect(fakeValidation.reason).toContain('not found');
    });

    it('executes atomic CHARACTER_JOIN promotion and records promotion provenance', () => {
        const timeBucket = getTimeBucket('2026-06-15T10:00:00Z');
        const transientId = buildTransientId(simulation.lws_id, location.lws_id, timeBucket, 'baker', 0);

        // Create authored character row for promoted entity
        const char = createCharacter(world.lws_id, {
            name: 'Barnaby the Baker',
            description: 'The promoted market baker',
            personality: 'Warm and jovial',
        });
        const charLwsId = char.lws_id;

        // Commit CHARACTER_JOIN event with promotion payload
        const event = commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charLwsId,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T10:00:00Z',
            payload: {
                character_id: charLwsId,
                tier: 'supporting',
                promotion: {
                    source_archetype_key: 'baker',
                    source_transient_id: transientId,
                    promotion_reason: 'direct_interaction',
                    promoted_to_tier: 'supporting',
                },
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true, db });

        expect(event).toBeDefined();

        // Verify simulation character exists in Supporting tier
        const simChar = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(event.actor_character_id);
        expect(simChar).toBeDefined();

        const tier = getCharacterTier(db, 1, simChar.id);
        expect(tier.tier).toBe('supporting');
        expect(tier.cognitive_budget).toBe('lightweight');
        expect(tier.is_promoted).toBe(1);

        // Verify promotion record created
        const promotedRecords = listPromotedEntities(db, 1);
        expect(promotedRecords.length).toBe(1);
        expect(promotedRecords[0].source_transient_id).toBe(transientId);
        expect(promotedRecords[0].source_archetype_key).toBe('baker');
        expect(promotedRecords[0].promotion_reason).toBe('direct_interaction');
        expect(promotedRecords[0].promoted_to_tier).toBe('supporting');
    });
});
