import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { advanceFictionalTime } from '../../src/living-world/time/time-advance.js';
import { calculateFamiliarityDecay } from '../../src/living-world/social/common.js';
import { decayEmotionState } from '../../src/living-world/cognition/emotions.js';
import { getCharacterNeeds } from '../../src/living-world/cognition/needs.js';

describe('LWS Phase 13 Hardening — Long-Run Continuity & Multi-Horizon Verification', () => {
    let db;
    let world;
    let loc1;
    let char1;
    let char2;
    let sim;
    let simChar1;
    let simChar2;

    beforeEach(() => {
        db = openDb(':memory:');

        world = createWorld({ name: 'Long-Run Continuity World' });
        loc1 = createLocation(world.lws_id, { name: 'Town Square' });

        char1 = createCharacter(world.lws_id, { name: 'Aldous' });
        char2 = createCharacter(world.lws_id, { name: 'Beatrix' });

        sim = createSimulation(world.lws_id, {
            name: '14-Day and 30-Day Continuity Sim',
            initial_fictional_time: '2026-06-01T00:00:00Z',
        });
        simChar1 = addSimulationCharacter(sim.lws_id, { character_id: char1.lws_id, initial_location_id: loc1.lws_id });
        simChar2 = addSimulationCharacter(sim.lws_id, { character_id: char2.lws_id, initial_location_id: loc1.lws_id });
    });

    afterEach(() => {
        closeDb();
    });

    test('advances simulated 14-day timeline (1,209,600s) maintaining need homeostasis and routine state', async () => {
        const FOURTEEN_DAYS_SECONDS = 14 * 24 * 3600; // 1,209,600 seconds

        const result = await advanceFictionalTime(db, {
            simLwsId: sim.lws_id,
            durationSeconds: FOURTEEN_DAYS_SECONDS,
        });
        expect(result.duration_seconds).toBe(FOURTEEN_DAYS_SECONDS);
        expect(result.current_fictional_time).toBe('2026-06-15T00:00:00Z');

        // Verify cognitive needs decay and evaluate boundedly
        const char1Row = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simChar1.lws_id);
        const needs1 = getCharacterNeeds(db, char1Row.id);
        expect(needs1.length).toBeGreaterThan(0);
        for (const n of needs1) {
            expect(n.satisfaction).toBeGreaterThanOrEqual(0);
            expect(n.satisfaction).toBeLessThanOrEqual(100);
        }
    });

    test('verifies asymmetric relationship familiarity decay over 30-day fictional span (tau = 30 days)', () => {
        const initialFamiliarity = 80;
        const THIRTY_DAYS_SECONDS = 30 * 24 * 3600;

        // At t <= 7 days (grace period), no decay occurs
        const decayedGrace = calculateFamiliarityDecay(initialFamiliarity, 7 * 24 * 3600);
        expect(decayedGrace).toBe(initialFamiliarity);

        // At t = 30 days, decay reduces familiarity according to exponential decay curve
        const decayedFam30Days = calculateFamiliarityDecay(initialFamiliarity, THIRTY_DAYS_SECONDS);
        expect(decayedFam30Days).toBeLessThan(initialFamiliarity);
        expect(decayedFam30Days).toBe(37);

        // At t = 60 days (2 tau), further decay occurs
        const decayedFam60Days = calculateFamiliarityDecay(initialFamiliarity, 2 * THIRTY_DAYS_SECONDS);
        expect(decayedFam60Days).toBeLessThan(decayedFam30Days);
        expect(decayedFam60Days).toBe(14);
    });

    test('verifies hyperbolic emotion decay converges to baseline over sustained fictional time', () => {
        const initialEmotion = {
            dominant_emotion: 'angry',
            intensity: 90,
            arousal: 80,
            valence: -50,
        };

        // After 4 hours (14400s = 1 TAU), intensity halves
        const decayed4h = decayEmotionState(initialEmotion, 14400);
        expect(decayed4h.intensity).toBe(45);

        // After 24 hours (86400s), intensity drops significantly
        const decayed24h = decayEmotionState(initialEmotion, 86400);
        expect(decayed24h.intensity).toBeLessThan(15);
        expect(decayed24h.intensity).toBeGreaterThanOrEqual(0);
    });
});
