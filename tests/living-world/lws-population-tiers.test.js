import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import {
    getCharacterTier,
    setCharacterTier,
    elevateCharacterTier,
    listCharacterTiers,
} from '../../src/living-world/population/character-tiers.js';
import { createGoal } from '../../src/living-world/cognition/goals.js';
import { LwsConflictError, LwsInvalidStateTransitionError } from '../../src/living-world/errors.js';

describe('Phase 9 - Population Tiers & Cognitive Budgeting', () => {
    let db;
    let world;
    let location;
    let simulation;
    let char1;
    let char2;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Tier World', summary: 'World for tier tests' });
        location = createLocation(world.lws_id, { name: 'Town Hall', summary: 'Center of town' });
        simulation = createSimulation(world.lws_id, { name: 'Tier Sim', initial_fictional_time: '2026-06-15T10:00:00Z' });

        // Add character 1 (Core)
        const c1 = createCharacter(world.lws_id, { name: 'Core Hero', description: 'The protagonist', personality: 'Bold' });
        char1 = addSimulationCharacter(simulation.lws_id, { character_id: c1.lws_id, initial_location_id: location.lws_id });

        // Add character 2 (Supporting)
        const c2 = createCharacter(world.lws_id, { name: 'Supporting Villager', description: 'A bystander', personality: 'Quiet' });
        char2 = addSimulationCharacter(simulation.lws_id, { character_id: c2.lws_id, initial_location_id: location.lws_id });
        setCharacterTier(db, 1, 2, 'supporting', 1);
    });

    afterEach(() => {
        closeDb();
    });

    it('retrieves correct tiers and cognitive budgets for Core and Supporting characters', () => {
        const tier1 = getCharacterTier(db, 1, 1);
        expect(tier1.tier).toBe('core');
        expect(tier1.cognitive_budget).toBe('full');

        const tier2 = getCharacterTier(db, 1, 2);
        expect(tier2.tier).toBe('supporting');
        expect(tier2.cognitive_budget).toBe('lightweight');
    });

    it('allows elevating a Supporting character to Core tier', () => {
        elevateCharacterTier(db, 1, 2, 'core');

        const updatedTier2 = getCharacterTier(db, 1, 2);
        expect(updatedTier2.tier).toBe('core');
        expect(updatedTier2.cognitive_budget).toBe('full');
    });

    it('prohibits demoting a Core character to Supporting tier', () => {
        expect(() => {
            elevateCharacterTier(db, 1, 1, 'supporting');
        }).toThrow(LwsConflictError);
    });

    it('blocks goal creation for Supporting tier characters with LwsInvalidStateTransitionError', () => {
        // Goal creation on Core character should succeed
        expect(() => {
            createGoal(db, 1, 1, {
                title: 'Save the village',
                priority: 50,
            });
        }).not.toThrow();

        // Goal creation on Supporting character must fail
        expect(() => {
            createGoal(db, 1, 2, {
                title: 'Bake a thousand pies',
                priority: 50,
            });
        }).toThrow(LwsInvalidStateTransitionError);
    });
});
