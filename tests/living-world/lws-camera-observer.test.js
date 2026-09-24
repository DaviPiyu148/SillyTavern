import { describe, test, expect, beforeEach } from '@jest/globals';
import { openDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import {
    getSimulationCamera,
    setSimulationCamera,
    buildSubjectivePerspective,
    buildObserverPerspective,
} from '../../src/living-world/perception/camera.js';
import { upsertCharacterKnowledge } from '../../src/living-world/perception/knowledge.js';
import { createCharacterMemory } from '../../src/living-world/perception/memories.js';
import { upsertCharacterBelief } from '../../src/living-world/perception/beliefs.js';

describe('LWS Phase 6 Camera, Perspectives & Observer API', () => {
    let db;
    let world;
    let locTavern;
    let locMarket;
    let charSarah;
    let charJohn;
    let sim;
    let simSarah;
    let simJohn;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Perspective World', description: 'Test World' });
        locTavern = createLocation(world.lws_id, { name: 'Tavern' });
        locMarket = createLocation(world.lws_id, { name: 'Marketplace' });
        charSarah = createCharacter(world.lws_id, { name: 'Sarah' });
        charJohn = createCharacter(world.lws_id, { name: 'John' });

        sim = createSimulation(world.lws_id, {
            name: 'Observation Simulation',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });

        simSarah = addSimulationCharacter(sim.lws_id, {
            character_id: charSarah.lws_id,
            initial_location_id: locTavern.lws_id,
        });

        simJohn = addSimulationCharacter(sim.lws_id, {
            character_id: charJohn.lws_id,
            initial_location_id: locMarket.lws_id,
        });
    });

    test('sets and gets simulation camera in follow_character, observe_location, and god_view modes', () => {
        // 1. follow_character mode
        const camFollow = setSimulationCamera(db, {
            sim_lws_id: sim.lws_id,
            camera_name: 'main',
            mode: 'follow_character',
            target_character_id: simSarah.lws_id,
        });
        expect(camFollow.mode).toBe('follow_character');
        expect(camFollow.target_character_lws_id).toBe(simSarah.lws_id);
        expect(camFollow.target_location_lws_id).toBeNull();

        // 2. observe_location mode (Frozen contract)
        const camLoc = setSimulationCamera(db, {
            sim_lws_id: sim.lws_id,
            camera_name: 'main',
            mode: 'observe_location',
            target_location_id: locTavern.lws_id,
        });
        expect(camLoc.mode).toBe('observe_location');
        expect(camLoc.target_location_lws_id).toBe(locTavern.lws_id);
        expect(camLoc.target_character_lws_id).toBeNull();

        // 3. god_view mode
        const camGod = setSimulationCamera(db, {
            sim_lws_id: sim.lws_id,
            camera_name: 'main',
            mode: 'god_view',
        });
        expect(camGod.mode).toBe('god_view');
        expect(camGod.target_character_lws_id).toBeNull();
        expect(camGod.target_location_lws_id).toBeNull();

        const fetched = getSimulationCamera(db, sim.lws_id, 'main');
        expect(fetched.lws_id).toBe(camGod.lws_id);
    });

    test('enforces camera invariants and rejects invalid modes including fixed_location', () => {
        // Reject invalid mode 'fixed_location' (frozen contract requires 'observe_location')
        expect(() => {
            setSimulationCamera(db, {
                sim_lws_id: sim.lws_id,
                camera_name: 'invalid_cam_mode',
                mode: 'fixed_location',
                target_location_id: locTavern.lws_id,
            });
        }).toThrow(/Invalid camera mode: 'fixed_location'/i);

        // Reject follow_character without target_character_id
        expect(() => {
            setSimulationCamera(db, {
                sim_lws_id: sim.lws_id,
                camera_name: 'invalid_cam1',
                mode: 'follow_character',
            });
        }).toThrow(/follow_character mode requires target_character_id/i);

        // Reject observe_location without target_location_id
        expect(() => {
            setSimulationCamera(db, {
                sim_lws_id: sim.lws_id,
                camera_name: 'invalid_cam2',
                mode: 'observe_location',
            });
        }).toThrow(/observe_location mode requires target_location_id/i);

        // Reject god_view with target
        expect(() => {
            setSimulationCamera(db, {
                sim_lws_id: sim.lws_id,
                camera_name: 'invalid_cam3',
                mode: 'god_view',
                target_character_id: simSarah.lws_id,
            });
        }).toThrow(/god_view mode requires NULL target_character_id/i);
    });

    describe('Canonical Scenario 5: Sarah & John Off-Camera Continuity & Perspective Isolation', () => {
        test('Sarah perspective sees only Tavern state while Observer sees full ground truth', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const sarahRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simSarah.lws_id);
            const johnRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simJohn.lws_id);

            // 1. Set Camera to follow Sarah
            setSimulationCamera(db, {
                sim_lws_id: sim.lws_id,
                camera_name: 'default',
                mode: 'follow_character',
                target_character_id: simSarah.lws_id,
            });

            // 2. Setup Sarah knowledge, memory, belief
            upsertCharacterKnowledge(db, {
                simulation_id: simRow.id,
                simulation_character_id: sarahRow.id,
                char_lws_id: simSarah.lws_id,
                fact_key: 'tavern_specialty',
                content: 'Dragon Ale',
                source_channel: 'backstory',
                fictional_time_acquired: '2026-06-01T09:00:00Z',
            });

            createCharacterMemory(db, {
                simulation_id: simRow.id,
                simulation_character_id: sarahRow.id,
                char_lws_id: simSarah.lws_id,
                summary: 'Enjoyed a drink at the counter',
                fictional_time: '2026-06-01T09:30:00Z',
            });

            upsertCharacterBelief(db, {
                simulation_id: simRow.id,
                simulation_character_id: sarahRow.id,
                char_lws_id: simSarah.lws_id,
                subject: 'Bartender',
                predicate: 'is_friendly',
                object_value: 'true',
                source_basis: 'observation',
                fictional_time_formed: '2026-06-01T09:30:00Z',
            });

            // 3. John performs actions off-camera in Marketplace
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.WORK,
                actor_character_id: simJohn.lws_id,
                location_id: locMarket.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: {
                    activity: 'selling apples',
                },
            }, { isAdmin: true });

            upsertCharacterKnowledge(db, {
                simulation_id: simRow.id,
                simulation_character_id: johnRow.id,
                char_lws_id: simJohn.lws_id,
                fact_key: 'apple_inventory',
                content: '50 apples',
                source_channel: 'evidence',
                fictional_time_acquired: '2026-06-01T10:00:00Z',
            });

            // 4. Inspect Subjective Perspective for Sarah
            const sarahPerspective = buildSubjectivePerspective(db, sim.lws_id, simSarah.lws_id);
            expect(sarahPerspective).toBeDefined();
            expect(sarahPerspective.character.lws_id).toBe(simSarah.lws_id);
            expect(sarahPerspective.current_location.lws_id).toBe(locTavern.lws_id);

            // Sarah sees only co-located entities in Tavern (John is in Market, so excluded)
            const coLocatedCharIds = sarahPerspective.co_located_characters.map(c => c.lws_id);
            expect(coLocatedCharIds).not.toContain(simJohn.lws_id);

            // Sarah's own epistemic state
            expect(sarahPerspective.knowledge.some(k => k.fact_key === 'tavern_specialty')).toBe(true);
            expect(sarahPerspective.knowledge.some(k => k.fact_key === 'apple_inventory')).toBe(false); // John's knowledge NOT leaked

            expect(sarahPerspective.memories).toHaveLength(1);
            expect(sarahPerspective.beliefs).toHaveLength(1);

            // 5. Inspect Observer Perspective (Privileged God View)
            const observerPerspective = buildObserverPerspective(db, sim.lws_id);
            expect(observerPerspective).toBeDefined();
            expect(observerPerspective.simulation.lws_id).toBe(sim.lws_id);
            expect(observerPerspective.camera.mode).toBe('follow_character');
            expect(observerPerspective.camera.target_character_lws_id).toBe(simSarah.lws_id);

            // Observer sees all characters across all locations with full continuity
            const allCharIds = observerPerspective.characters.map(c => c.lws_id);
            expect(allCharIds).toContain(simSarah.lws_id);
            expect(allCharIds).toContain(simJohn.lws_id);

            const johnObserved = observerPerspective.characters.find(c => c.lws_id === simJohn.lws_id);
            expect(johnObserved.current_location_id).toBe(locMarket.lws_id);
            expect(johnObserved.activity).toBe('selling apples');
        });
    });
});
