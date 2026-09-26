import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/living-world/migrations/index.js';
import {
    generateAmbientPopulation,
} from '../../src/living-world/population/ambient-generator.js';
import {
    buildTransientId,
    parseTransientId,
    getTimeBucket,
} from '../../src/living-world/population/common.js';

describe('Phase 9 - Contextual Ambient Population Generation', () => {
    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        runMigrations(db);
    });

    afterEach(() => {
        if (db) db.close();
    });

    const mockArchetypes = [
        {
            lws_id: 'arch-baker',
            archetype_key: 'baker',
            name: 'Town Baker',
            description: 'A cheerful baker covered in flour.',
            roles: ['baker', 'merchant'],
            weight: 50,
            location_filter_tags: ['market', 'shop'],
            time_filter_buckets: ['morning', 'afternoon'],
            activity_pool: ['baking', 'kneading dough', 'serving customers'],
            dialogue_pool: ['Fresh bread here!', 'Care for a warm pastry?'],
        },
        {
            lws_id: 'arch-guard',
            archetype_key: 'town_guard',
            name: 'City Guard',
            description: 'A vigilant guard in iron armor.',
            roles: ['guard'],
            weight: 80,
            location_filter_tags: [],
            time_filter_buckets: [],
            activity_pool: ['patrolling', 'standing watch'],
            dialogue_pool: ['Move along, citizen.', 'All is quiet.'],
        },
        {
            lws_id: 'arch-patron',
            archetype_key: 'tavern_patron',
            name: 'Tavern Patron',
            description: 'A local drinking ale.',
            roles: ['patron'],
            weight: 60,
            location_filter_tags: ['tavern'],
            time_filter_buckets: ['evening', 'night'],
            activity_pool: ['drinking', 'singing'],
            dialogue_pool: ['Another round!'],
        },
    ];

    it('generates deterministic entities with exact same parameters', () => {
        const simLwsId = 'sim-test-123';
        const locLwsId = 'loc-market-456';
        const timeBucket = 'morning';
        const worldId = 'world-789';

        const env = { weather: 'clear', lighting_level: 'bright', noise_level: 'moderate' };
        const ops = { access_status: 'open', crowd_density: 'normal', ambient_capacity: 5 };

        const run1 = generateAmbientPopulation(simLwsId, locLwsId, timeBucket, worldId, env, ops, mockArchetypes, []);
        const run2 = generateAmbientPopulation(simLwsId, locLwsId, timeBucket, worldId, env, ops, mockArchetypes, []);

        expect(run1.length).toBeGreaterThan(0);
        expect(run1).toEqual(run2);

        // Check transient ID structure
        const first = run1[0];
        expect(first.transient_id).toBeDefined();
        const parsed = parseTransientId(first.transient_id);
        expect(parsed).toBeDefined();
        expect(parsed.simLwsId).toBe(simLwsId);
        expect(parsed.locLwsId).toBe(locLwsId);
        expect(parsed.timeBucket).toBe(timeBucket);
    });

    it('filters archetypes by location tags and time bucket', () => {
        const simLwsId = 'sim-test-123';
        const locLwsId = 'loc-tavern-456';
        const worldId = 'world-789';
        const env = { weather: 'clear', lighting_level: 'dim', noise_level: 'loud' };
        const ops = { access_status: 'open', crowd_density: 'dense', ambient_capacity: 10 };

        // Evening in Tavern -> Tavern Patron should spawn
        const eveningPop = generateAmbientPopulation(
            simLwsId,
            locLwsId,
            'evening',
            worldId,
            env,
            ops,
            mockArchetypes,
            [],
            { tags: ['tavern'] },
        );

        const hasPatron = eveningPop.some(e => e.archetype_key === 'tavern_patron');
        expect(hasPatron).toBe(true);

        // Morning in Tavern -> Tavern Patron should NOT spawn
        const morningPop = generateAmbientPopulation(
            simLwsId,
            locLwsId,
            'morning',
            worldId,
            env,
            ops,
            mockArchetypes,
            [],
            { tags: ['tavern'] },
        );

        const hasMorningPatron = morningPop.some(e => e.archetype_key === 'tavern_patron');
        expect(hasMorningPatron).toBe(false);
    });

    it('suppresses duplicate role when active core/supporting character is present', () => {
        const simLwsId = 'sim-test-123';
        const locLwsId = 'loc-bakery-456';
        const worldId = 'world-789';
        const env = { weather: 'clear', lighting_level: 'bright', noise_level: 'moderate' };
        const ops = { access_status: 'open', crowd_density: 'normal', ambient_capacity: 5 };

        // Active character with role 'baker' is present at this location
        const activeChars = [
            { lws_id: 'char-master-baker', name: 'Master Pierre', role: 'baker' },
        ];

        const pop = generateAmbientPopulation(
            simLwsId,
            locLwsId,
            'morning',
            worldId,
            env,
            ops,
            mockArchetypes,
            activeChars,
            { tags: ['market', 'shop'] },
        );

        // Ambient baker should be suppressed
        const hasAmbientBaker = pop.some(e => e.archetype_key === 'baker');
        expect(hasAmbientBaker).toBe(false);
    });

    it('returns empty population when location access is closed or capacity is zero', () => {
        const simLwsId = 'sim-test-123';
        const locLwsId = 'loc-shop-456';
        const worldId = 'world-789';
        const env = { weather: 'clear', lighting_level: 'bright', noise_level: 'quiet' };

        // Closed access
        const closedOps = { access_status: 'closed', crowd_density: 'normal', ambient_capacity: 5 };
        const popClosed = generateAmbientPopulation(simLwsId, locLwsId, 'morning', worldId, env, closedOps, mockArchetypes, []);
        expect(popClosed).toEqual([]);

        // Zero capacity
        const emptyOps = { access_status: 'open', crowd_density: 'empty', ambient_capacity: 0 };
        const popEmpty = generateAmbientPopulation(simLwsId, locLwsId, 'morning', worldId, env, emptyOps, mockArchetypes, []);
        expect(popEmpty).toEqual([]);
    });
});
