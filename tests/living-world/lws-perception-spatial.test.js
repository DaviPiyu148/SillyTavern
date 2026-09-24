import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { calculateSpatialDistance, canCharacterPerceive } from '../../src/living-world/perception/spatial.js';
import { getEventPerceptions, getCharacterPerceptions } from '../../src/living-world/perception/perceptions.js';

describe('LWS Phase 6 Spatial Perception Engine', () => {
    let db;
    let world;
    let locFloor1;
    let locOffice;
    let locBasement;
    let locAttic;
    let charAlice;
    let charBob;
    let charCharlie;
    let charDan;
    let sim;
    let simAlice;
    let simBob;
    let simCharlie;
    let simDan;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        // Create authored world
        world = createWorld({ name: 'Perception World', description: 'Test World' });

        // Create hierarchical locations:
        // Floor 1 (root, depth 0)
        // -> Office (depth 1, child of Floor 1)
        // -> Basement (depth 1, child of Floor 1)
        // Sibling room distance: depth(Office)=1, depth(Basement)=1, depth(LCA)=0 => 1 + 1 - 0 = 2
        locFloor1 = createLocation(world.lws_id, {
            name: 'Floor 1',
            extensions: { parent_location_id: null },
        });

        locOffice = createLocation(world.lws_id, {
            name: 'Office',
            extensions: { parent_location_id: locFloor1.lws_id },
        });

        locBasement = createLocation(world.lws_id, {
            name: 'Basement',
            extensions: { parent_location_id: locFloor1.lws_id },
        });

        // Attic is child of Office (depth 2) => dist(Attic, Basement) = 2 + 1 - 0 = 3
        locAttic = createLocation(world.lws_id, {
            name: 'Attic',
            extensions: { parent_location_id: locOffice.lws_id },
        });

        // Create characters
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });
        charCharlie = createCharacter(world.lws_id, { name: 'Charlie' });
        charDan = createCharacter(world.lws_id, { name: 'Dan' });

        // Create simulation
        sim = createSimulation(world.lws_id, {
            name: 'Perception Simulation',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });

        // Add characters to simulation
        simAlice = addSimulationCharacter(sim.lws_id, {
            character_id: charAlice.lws_id,
            initial_location_id: locOffice.lws_id,
            activity: 'working',
        });

        simBob = addSimulationCharacter(sim.lws_id, {
            character_id: charBob.lws_id,
            initial_location_id: locOffice.lws_id,
            activity: 'reading',
        });

        simCharlie = addSimulationCharacter(sim.lws_id, {
            character_id: charCharlie.lws_id,
            initial_location_id: locBasement.lws_id,
            activity: 'resting',
        });

        simDan = addSimulationCharacter(sim.lws_id, {
            character_id: charDan.lws_id,
            initial_location_id: locOffice.lws_id,
            activity: 'sleeping',
            physical_condition: 'unconscious',
        });
    });

    afterEach(() => {
        closeDb();
    });

    describe('Tree LCA Distance Calculation', () => {
        test('calculates co-location distance as 0', () => {
            const locs = db.prepare('SELECT * FROM lws_locations WHERE world_id = (SELECT id FROM lws_worlds WHERE lws_id = ?)').all(world.lws_id);
            const locMap = new Map(locs.map(l => [l.id, l]));

            const officeRow = locs.find(l => l.lws_id === locOffice.lws_id);
            expect(calculateSpatialDistance(locMap, officeRow.id, officeRow.id)).toBe(0);
        });

        test('calculates sibling room distance under common parent as 2', () => {
            const locs = db.prepare('SELECT * FROM lws_locations WHERE world_id = (SELECT id FROM lws_worlds WHERE lws_id = ?)').all(world.lws_id);
            const locMap = new Map(locs.map(l => [l.id, l]));

            const officeRow = locs.find(l => l.lws_id === locOffice.lws_id);
            const basementRow = locs.find(l => l.lws_id === locBasement.lws_id);
            expect(calculateSpatialDistance(locMap, officeRow.id, basementRow.id)).toBe(2);
        });

        test('calculates distant room distance across levels as >= 3', () => {
            const locs = db.prepare('SELECT * FROM lws_locations WHERE world_id = (SELECT id FROM lws_worlds WHERE lws_id = ?)').all(world.lws_id);
            const locMap = new Map(locs.map(l => [l.id, l]));

            const atticRow = locs.find(l => l.lws_id === locAttic.lws_id);
            const basementRow = locs.find(l => l.lws_id === locBasement.lws_id);
            expect(calculateSpatialDistance(locMap, atticRow.id, basementRow.id)).toBe(3);
        });
    });

    describe('Canonical Scenario 1: Spatial Perception & Sibling Room Tree Distance', () => {
        test('normal speech is perceived by co-located Bob (visual) but not sibling room Charlie', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const ev = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.OBSERVE,
                actor_character_id: simAlice.lws_id,
                location_id: locOffice.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: { volume: 'normal' },
            }, { isAdmin: true });

            const perceptions = getEventPerceptions(db, ev.lws_id);

            // Alice (actor) perceives visually
            const aliceP = perceptions.find(p => p.character_lws_id === simAlice.lws_id);
            expect(aliceP).toBeDefined();
            expect(aliceP.sensory_modality).toBe('visual');

            // Bob (co-located dist=0) perceives visually (Option A precedence visual > auditory)
            const bobP = perceptions.find(p => p.character_lws_id === simBob.lws_id);
            expect(bobP).toBeDefined();
            expect(bobP.sensory_modality).toBe('visual');

            // Charlie in Basement (dist=2) does NOT perceive normal speech
            const charlieP = perceptions.find(p => p.character_lws_id === simCharlie.lws_id);
            expect(charlieP).toBeUndefined();
        });

        test('loud event propagates to sibling room Charlie with auditory modality', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const ev = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.GENERAL_ACTION,
                actor_character_id: simAlice.lws_id,
                location_id: locOffice.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: { volume: 'loud', action: 'Detonate small firecracker' },
            }, { isAdmin: true });

            const perceptions = getEventPerceptions(db, ev.lws_id);

            // Bob in Office (dist=0) receives visual
            const bobP = perceptions.find(p => p.character_lws_id === simBob.lws_id);
            expect(bobP).toBeDefined();
            expect(bobP.sensory_modality).toBe('visual');

            // Charlie in Basement (dist=2) receives auditory
            const charlieP = perceptions.find(p => p.character_lws_id === simCharlie.lws_id);
            expect(charlieP).toBeDefined();
            expect(charlieP.sensory_modality).toBe('auditory');
        });
    });

    describe('Canonical Scenario 2: Sensory Incapacitation (Unconscious Character Sensory Blocking)', () => {
        test('unconscious character Dan does not perceive co-located event', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const ev = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.OBSERVE,
                actor_character_id: simAlice.lws_id,
                location_id: locOffice.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: { volume: 'normal' },
            }, { isAdmin: true });

            const perceptions = getEventPerceptions(db, ev.lws_id);

            // Dan is unconscious -> 0 perceptions
            const danP = perceptions.find(p => p.character_lws_id === simDan.lws_id);
            expect(danP).toBeUndefined();

            // Check helper directly
            const danRow = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(simDan.lws_id);
            expect(canCharacterPerceive(danRow, 'visual')).toBe(false);
            expect(canCharacterPerceive(danRow, 'auditory')).toBe(false);
        });
    });

    describe('Option A Modality Precedence & Barriers', () => {
        test('tactile modality takes precedence for direct object interaction', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const ev = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.INTERACT_OBJECT,
                actor_character_id: simAlice.lws_id,
                location_id: locOffice.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: { object_id: 'ancient_cube', action: 'touch' },
            }, { isAdmin: true });

            const perceptions = getEventPerceptions(db, ev.lws_id);

            // Alice (actor manipulating object) gets tactile
            const aliceP = perceptions.find(p => p.character_lws_id === simAlice.lws_id);
            expect(aliceP).toBeDefined();
            expect(aliceP.sensory_modality).toBe('tactile');

            // Bob (co-located observer) gets visual
            const bobP = perceptions.find(p => p.character_lws_id === simBob.lws_id);
            expect(bobP).toBeDefined();
            expect(bobP.sensory_modality).toBe('visual');
        });

        test('character perception history query returns correctly formatted records', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.OBSERVE,
                actor_character_id: simAlice.lws_id,
                location_id: locOffice.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: {},
            }, { isAdmin: true });

            const bobHistory = getCharacterPerceptions(db, simBob.lws_id);
            expect(bobHistory.length).toBeGreaterThanOrEqual(1);
            expect(bobHistory[0].sensory_modality).toBe('visual');
            expect(bobHistory[0].event_type).toBe('OBSERVE');
        });
    });
});
