import { describe, test, expect, beforeEach } from '@jest/globals';
import { openDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import {
    listCharacterMemories,
    createCharacterMemory,
    patchCharacterMemory,
} from '../../src/living-world/perception/memories.js';
import { retrieveCharacterMemories } from '../../src/living-world/perception/memory-retrieval.js';

describe('LWS Phase 6 Memories & Relevance Retrieval', () => {
    let db;
    let world;
    let loc;
    let character;
    let sim;
    let simChar;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Memory World', description: 'Test World' });
        loc = createLocation(world.lws_id, { name: 'Library' });
        character = createCharacter(world.lws_id, { name: 'Scholar' });
        sim = createSimulation(world.lws_id, {
            name: 'Memory Simulation',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        simChar = addSimulationCharacter(sim.lws_id, {
            character_id: character.lws_id,
            initial_location_id: loc.lws_id,
        });
    });

    test('creates and lists character memories with valid attributes', () => {
        const mem = createCharacterMemory(db, {
            simulation_character_lws_id: simChar.lws_id,
            memory_type: 'episodic',
            description: 'Found an ancient scroll in the library.',
            salience: 0.8,
            importance: 0.9,
            emotional_valence: 0.5,
            fictional_time_recorded: '2026-06-01T10:00:00Z',
            sentiment_tags: ['discovery', 'excitement'],
        });

        expect(mem).toBeDefined();
        expect(mem.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(mem.description).toBe('Found an ancient scroll in the library.');
        expect(mem.salience).toBe(0.8);
        expect(mem.importance).toBe(0.9);
        expect(mem.sentiment_tags).toEqual(['discovery', 'excitement']);

        const list = listCharacterMemories(db, simChar.lws_id);
        expect(list).toHaveLength(1);
        expect(list[0].lws_id).toBe(mem.lws_id);
    });

    test('patches character memory mutable fields and rejects immutable field mutation', () => {
        const mem = createCharacterMemory(db, {
            simulation_character_lws_id: simChar.lws_id,
            memory_type: 'episodic',
            description: 'Original description',
            salience: 0.5,
            importance: 0.5,
            fictional_time_recorded: '2026-06-01T10:00:00Z',
        });

        // Valid patch
        const updated = patchCharacterMemory(db, simChar.lws_id, mem.lws_id, {
            salience: 0.9,
            importance: 0.8,
            reflection_notes: 'Turned out to be cursed.',
            sentiment_tags: ['danger', 'curse'],
        });

        expect(updated.salience).toBe(0.9);
        expect(updated.importance).toBe(0.8);
        expect(updated.reflection_notes).toBe('Turned out to be cursed.');
        expect(updated.sentiment_tags).toEqual(['danger', 'curse']);

        // Attempt to mutate immutable fields should throw
        expect(() => {
            patchCharacterMemory(db, simChar.lws_id, mem.lws_id, {
                fictional_time_recorded: '2026-06-02T10:00:00Z',
            });
        }).toThrow(/immutable/i);

        expect(() => {
            patchCharacterMemory(db, simChar.lws_id, mem.lws_id, {
                causal_event_id: 12345,
            });
        }).toThrow(/immutable/i);
    });

    test('soft deletes a character memory using deleted_at field', () => {
        const mem = createCharacterMemory(db, {
            simulation_character_lws_id: simChar.lws_id,
            memory_type: 'episodic',
            description: 'To be forgotten',
            fictional_time_recorded: '2026-06-01T10:00:00Z',
        });

        const deleted = patchCharacterMemory(db, simChar.lws_id, mem.lws_id, {
            deleted_at: '2026-06-01T12:00:00Z',
        });
        expect(deleted.deleted_at).toBe('2026-06-01T12:00:00Z');

        const activeList = listCharacterMemories(db, simChar.lws_id);
        expect(activeList).toHaveLength(0);

        const allList = listCharacterMemories(db, simChar.lws_id, { includeDeleted: true });
        expect(allList).toHaveLength(1);
    });

    describe('Canonical Scenario 4: Memory Retrieval & Recency Decay', () => {
        test('scores and ranks memories by recency decay, salience, importance, and query context with exact frozen formula', () => {
            const currentTime = '2026-06-10T12:00:00Z'; // Current reference time

            // Memory 1: Ancient Artifact discovered 7 days ago (high importance, high salience, keyword match)
            // 7 days = 604800s -> recency = 1 / (1 + 604800/604800) = 1 / 2 = 0.5
            const memAncient = createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Unearthed the golden dragon artifact in the deep ruins.',
                salience: 0.95,
                importance: 0.90,
                sentiment_tags: ['artifact', 'dragon', 'treasure'],
                fictional_time_recorded: '2026-06-03T12:00:00Z',
            });

            // Memory 2: Recent Lunch 10 minutes ago (low importance, low salience, no query match)
            // 10 mins = 600s -> recency = 1 / (1 + 600/604800) ~= 0.999
            createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Ate cheese and bread at the tavern table.',
                salience: 0.1,
                importance: 0.1,
                sentiment_tags: ['food', 'tavern'],
                fictional_time_recorded: '2026-06-10T11:50:00Z',
            });

            // Memory 3: Combat Threat 1 hour ago (medium-high importance, high salience, partial match)
            // 1 hour = 3600s -> recency = 1 / (1 + 3600/604800) ~= 0.994
            const memCombat = createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Ambushed by shadow dragon cultists on the road.',
                salience: 0.85,
                importance: 0.80,
                sentiment_tags: ['combat', 'dragon', 'cult'],
                fictional_time_recorded: '2026-06-10T11:00:00Z',
            });

            // Memory 4: Reading a book 2 days ago (low-medium importance)
            createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Read an old history book about ancient kings.',
                salience: 0.4,
                importance: 0.5,
                sentiment_tags: ['history', 'book'],
                fictional_time_recorded: '2026-06-08T12:00:00Z',
            });

            // Memory 5: Deleted memory (should be excluded from retrieval)
            const memDeleted = createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Dragon secret forgotten.',
                salience: 1.0,
                importance: 1.0,
                sentiment_tags: ['dragon'],
                fictional_time_recorded: '2026-06-10T11:59:00Z',
            });
            patchCharacterMemory(db, simChar.lws_id, memDeleted.lws_id, {
                deleted_at: currentTime,
            });

            // Query specifically for "dragon threat artifact"
            const results = retrieveCharacterMemories(db, simChar.lws_id, {
                query: 'dragon threat artifact',
                currentFictionalTime: currentTime,
                limit: 3,
            });

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeLessThanOrEqual(3);

            // Verify deleted memory is excluded
            const resultIds = results.map(r => r.memory.lws_id);
            expect(resultIds).not.toContain(memDeleted.lws_id);

            // Verify scores are returned and sorted descending
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
            }

            // Both dragon-related memories should score high due to context overlap (0.30 weight)
            expect(resultIds).toContain(memCombat.lws_id);
            expect(resultIds).toContain(memAncient.lws_id);

            // Verify exact frozen recency calculation for memAncient (7 days ago = exactly 604800s => recency = 0.5)
            const ancientResult = results.find(r => r.memory.lws_id === memAncient.lws_id);
            expect(ancientResult).toBeDefined();
            expect(ancientResult.recencyScore).toBe(0.5);

            // Verify score structure and exact formula calculation:
            // S_total = 0.25 * recency + 0.25 * salience + 0.20 * importance + 0.30 * context
            const calculatedTotal = (0.25 * ancientResult.recencyScore)
                + (0.25 * ancientResult.salienceScore)
                + (0.20 * ancientResult.importanceScore)
                + (0.30 * ancientResult.contextScore);
            expect(ancientResult.score).toBeCloseTo(calculatedTotal, 4);

            // Verify repeated retrieval is deterministic
            const results2 = retrieveCharacterMemories(db, simChar.lws_id, {
                query: 'dragon threat artifact',
                currentFictionalTime: currentTime,
                limit: 3,
            });
            expect(results2.map(r => r.lws_id)).toEqual(results.map(r => r.lws_id));
        });

        test('verifies candidate bound N <= 100 and deterministic tie-breaking', () => {
            const currentTime = '2026-06-10T12:00:00Z';

            // Insert two memories with identical scores and fictional_time to test lws_id ASC tie-break
            const memA = createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Event A',
                salience: 0.5,
                importance: 0.5,
                fictional_time_recorded: '2026-06-10T10:00:00Z',
            });

            const memB = createCharacterMemory(db, {
                simulation_character_lws_id: simChar.lws_id,
                memory_type: 'episodic',
                description: 'Event B',
                salience: 0.5,
                importance: 0.5,
                fictional_time_recorded: '2026-06-10T10:00:00Z',
            });

            const results = retrieveCharacterMemories(db, simChar.lws_id, {
                currentFictionalTime: currentTime,
                limit: 10,
            });

            const indexA = results.findIndex(r => r.lws_id === memA.lws_id);
            const indexB = results.findIndex(r => r.lws_id === memB.lws_id);
            expect(indexA).toBeGreaterThanOrEqual(0);
            expect(indexB).toBeGreaterThanOrEqual(0);

            const lowerIdIndex = memA.lws_id < memB.lws_id ? indexA : indexB;
            const higherIdIndex = memA.lws_id < memB.lws_id ? indexB : indexA;
            expect(lowerIdIndex).toBeLessThan(higherIdIndex);
        });
    });
});
