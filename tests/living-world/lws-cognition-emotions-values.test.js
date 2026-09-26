import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createInMemoryTestDb } from './fixtures/test-db.js';
import {
    initCharacterEmotion,
    getCharacterEmotion,
    updateCharacterEmotion,
    calculateEmotionalDecay,
    getEmotionalAffinity,
    EMOTION_NAMES,
} from '../../src/living-world/cognition/emotions.js';
import {
    initCharacterValues,
    getCharacterValues,
    updateCharacterValue,
    calculateValueScore,
    hasMoralVeto,
    VALUE_DIMENSIONS,
} from '../../src/living-world/cognition/values.js';

describe('LWS Phase 7 — Emotions & Personality Values', () => {
    let db;
    let sim;
    let character;

    beforeEach(() => {
        db = createInMemoryTestDb();

        db.prepare(`
            INSERT INTO lws_worlds (id, lws_id, name, created_at, updated_at)
            VALUES (1, '10000000-0000-0000-0000-000000000001', 'Test World', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '20000000-0000-0000-0000-000000000001', 1, 'Bob', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES (1, '30000000-0000-0000-0000-000000000001', 1, 'Sim 1', 'active', '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, runtime_state, created_at, updated_at)
            VALUES (1, '40000000-0000-0000-0000-000000000001', 1, 1, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        sim = db.prepare('SELECT * FROM lws_simulations WHERE id = 1').get();
        character = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = 1').get();
    });

    afterEach(() => {
        if (db && db.open) db.close();
    });

    describe('Emotions & Hyperbolic Decay', () => {
        test('initializes emotion at neutral, intensity 0, arousal 50, valence 0', () => {
            initCharacterEmotion(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');

            const emo = getCharacterEmotion(db, character.id);
            expect(emo).toBeDefined();
            expect(emo.dominant_emotion).toBe('neutral');
            expect(emo.intensity).toBe(0);
            expect(emo.arousal).toBe(50);
            expect(emo.valence).toBe(0);
        });

        test('hyperbolic decay halves intensity after exactly 1 tau (14400 s)', () => {
            const currentEmotion = {
                dominant_emotion: 'fearful',
                intensity: 100,
                arousal: 100,
                valence: 0,
                last_updated_time: '2026-01-01T08:00:00Z',
            };

            const targetTime = '2026-01-01T12:00:00Z'; // 4 hours = 14400 seconds = 1 tau
            const decayed = calculateEmotionalDecay(currentEmotion, targetTime);

            expect(decayed.intensity).toBe(50); // 100 / (1 + 1) = 50
            expect(decayed.arousal).toBe(75); // 50 + round((100 - 50) / 2) = 75
            expect(decayed.valence).toBe(0);
            expect(decayed.dominant_emotion).toBe('fearful');
        });

        test('5-step normalization resets to neutral, A=50, V=0 when intensity decays to 0', () => {
            const currentEmotion = {
                dominant_emotion: 'angry',
                intensity: 1,
                arousal: 90,
                valence: -80,
                last_updated_time: '2026-01-01T08:00:00Z',
            };

            // 10 tau later -> intensity drops to 0
            const targetTime = '2026-01-02T20:00:00Z';
            const decayed = calculateEmotionalDecay(currentEmotion, targetTime);

            expect(decayed.intensity).toBe(0);
            expect(decayed.dominant_emotion).toBe('neutral');
            expect(decayed.arousal).toBe(50);
            expect(decayed.valence).toBe(0);
        });

        test('emotional affinity matrix matches frozen specifications', () => {
            expect(getEmotionalAffinity('joyful', 'AID_COMFORT')).toBe(1.0);
            expect(getEmotionalAffinity('angry', 'COMBAT_AGGR')).toBe(1.0);
            expect(getEmotionalAffinity('fearful', 'FLEEING')).toBe(1.0);
            expect(getEmotionalAffinity('fearful', 'COMBAT_AGGR')).toBe(-1.0);
            expect(getEmotionalAffinity('neutral', 'WORK')).toBe(0.0);
        });
    });

    describe('Personality Values & Moral Veto', () => {
        test('initializes all 6 values at strength 0', () => {
            initCharacterValues(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T00:00:00Z');

            const values = getCharacterValues(db, character.id);
            expect(values).toHaveLength(6);

            const dims = values.map(v => v.dimension);
            expect(dims).toEqual(['honesty', 'courage', 'compassion', 'ambition', 'loyalty', 'curiosity']);

            for (const v of values) {
                expect(v.strength).toBe(0);
            }
        });

        test('calculates value score correctly across dimensions', () => {
            const values = {
                honesty: 50,
                courage: 0,
                compassion: 0,
                ambition: 0,
                loyalty: 0,
                curiosity: 0,
            };

            // TRUTHFUL_COMMUNICATION: honesty match is 1.0, loyalty is 0.2
            // Score = 1/6 * (50 * 1.0) = 50 / 6 = 8.333
            const score = calculateValueScore(values, 'TRUTHFUL_COMMUNICATION');
            expect(score).toBeCloseTo(50 / 6, 2);
        });

        test('applies Moral Veto when honesty >= +75 on deceptive communication', () => {
            const honestValues = { honesty: 75 };
            const dishonestValues = { honesty: 74 };

            expect(hasMoralVeto(honestValues, 'DECEPTIVE_COMMUNICATION')).toBe(true);
            expect(hasMoralVeto(dishonestValues, 'DECEPTIVE_COMMUNICATION')).toBe(false);
            expect(hasMoralVeto(honestValues, 'TRUTHFUL_COMMUNICATION')).toBe(false);
        });

        test('updates character value with clamping in [-100, 100]', () => {
            initCharacterValues(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T00:00:00Z');

            updateCharacterValue(db, character.id, 'courage', 150, '2026-01-01T08:00:00Z');

            const values = getCharacterValues(db, character.id);
            const courage = values.find(v => v.dimension === 'courage');
            expect(courage.strength).toBe(100); // Clamped at 100
        });
    });
});
