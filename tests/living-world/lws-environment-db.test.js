import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';

describe('Phase 9 - Database Schema, Triggers, and Constraints', () => {
    let db;
    let world;
    let location;
    let simulation;
    let simChar;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Test World' });
        location = createLocation(world.lws_id, { name: 'Test Loc' });
        const char = createCharacter(world.lws_id, { name: 'Test Char' });
        simulation = createSimulation(world.lws_id, { name: 'Test Sim', initial_fictional_time: '2026-01-01T08:00:00Z' });
        simChar = addSimulationCharacter(simulation.lws_id, { character_id: char.lws_id, initial_location_id: location.lws_id });
    });

    afterEach(() => {
        closeDb();
    });

    it('creates all 5 Phase 9 tables with expected schemas', () => {
        const tables = [
            'lws_location_environments',
            'lws_location_operational_states',
            'lws_ambient_archetypes',
            'lws_promoted_entity_records',
            'lws_simulation_character_tiers',
        ];

        for (const tableName of tables) {
            const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
            expect(row).toBeDefined();
            expect(row.name).toBe(tableName);
        }
    });

    it('enforces immutability triggers on lws_location_environments', () => {
        db.prepare(`
            INSERT INTO lws_location_environments (
                lws_id, simulation_id, location_id, weather, temperature_baseline,
                temperature_celsius, lighting_level, noise_level, is_indoor, air_quality,
                hazards, created_at, updated_at
            ) VALUES ('env1', 1, 1, 'clear', 20.0, 20.0, 'bright', 50, 0, 'clean', '[]', '2026-01-01', '2026-01-01')
        `).run();

        // Attempting to change immutable fields (lws_id, simulation_id, location_id) must fail
        expect(() => {
            db.prepare("UPDATE lws_location_environments SET lws_id = 'env2' WHERE lws_id = 'env1'").run();
        }).toThrow();

        expect(() => {
            db.prepare("UPDATE lws_location_environments SET simulation_id = 2 WHERE lws_id = 'env1'").run();
        }).toThrow();

        expect(() => {
            db.prepare("UPDATE lws_location_environments SET location_id = 2 WHERE lws_id = 'env1'").run();
        }).toThrow();

        // Updating mutable fields (weather, temperature_celsius) must succeed
        expect(() => {
            db.prepare("UPDATE lws_location_environments SET weather = 'rain', temperature_celsius = 18.5 WHERE lws_id = 'env1'").run();
        }).not.toThrow();

        const updated = db.prepare("SELECT * FROM lws_location_environments WHERE lws_id = 'env1'").get();
        expect(updated.weather).toBe('rain');
        expect(updated.temperature_celsius).toBe(18.5);
    });

    it('enforces immutability triggers on lws_location_operational_states', () => {
        db.prepare(`
            INSERT INTO lws_location_operational_states (
                lws_id, simulation_id, location_id, access_status, crowd_density,
                ambient_capacity, created_at, updated_at
            ) VALUES ('ops1', 1, 1, 'open', 'moderate', 10, '2026-01-01', '2026-01-01')
        `).run();

        expect(() => {
            db.prepare("UPDATE lws_location_operational_states SET lws_id = 'ops2' WHERE lws_id = 'ops1'").run();
        }).toThrow();

        expect(() => {
            db.prepare("UPDATE lws_location_operational_states SET access_status = 'closed', crowd_density = 'sparse' WHERE lws_id = 'ops1'").run();
        }).not.toThrow();

        const updated = db.prepare("SELECT * FROM lws_location_operational_states WHERE lws_id = 'ops1'").get();
        expect(updated.access_status).toBe('closed');
        expect(updated.crowd_density).toBe('sparse');
    });

    it('enforces append-only/no-delete trigger on lws_promoted_entity_records', () => {
        const nextSeq = db.prepare('SELECT COALESCE(MAX(sequence_number), 0) + 1 AS nextSeq FROM lws_events WHERE simulation_id = 1').get().nextSeq;
        const evt = db.prepare(`
            INSERT INTO lws_events (
                lws_id, simulation_id, sequence_number, event_type, fictional_time,
                actor_character_id, payload, provenance, created_at
            ) VALUES ('evt1', 1, ?, 'GENERAL_ACTION', '2026-01-01T08:00:00Z', 1, '{}', 'system', '2026-01-01')
        `).run(nextSeq);

        db.prepare(`
            INSERT INTO lws_promoted_entity_records (
                lws_id, simulation_id, simulation_character_id, source_archetype_key,
                source_transient_id, origin_location_id, promotion_reason, causal_event_id,
                promoted_to_tier, fictional_time, created_at
            ) VALUES ('rec1', 1, 1, 'baker', 'transient-123', 1, 'direct_interaction', ?, 'supporting', '2026-01-01T08:00:00Z', '2026-01-01')
        `).run(evt.lastInsertRowid);

        // Updating immutable fields or any field must fail
        expect(() => {
            db.prepare("UPDATE lws_promoted_entity_records SET promotion_reason = 'witness' WHERE lws_id = 'rec1'").run();
        }).toThrow();

        // Deleting must fail
        expect(() => {
            db.prepare("DELETE FROM lws_promoted_entity_records WHERE lws_id = 'rec1'").run();
        }).toThrow();
    });

    it('enforces character tiers constraints and triggers', () => {
        // Character tier row was already initialized by addSimulationCharacter
        const existing = db.prepare('SELECT * FROM lws_simulation_character_tiers WHERE simulation_id = 1 AND simulation_character_id = 1').get();
        expect(existing).toBeDefined();

        // Physical deletion must fail
        expect(() => {
            db.prepare('DELETE FROM lws_simulation_character_tiers WHERE id = ?').run(existing.id);
        }).toThrow();

        // Elevating/updating tier must succeed
        expect(() => {
            db.prepare("UPDATE lws_simulation_character_tiers SET tier = 'core', cognitive_budget = 'full' WHERE id = ?").run(existing.id);
        }).not.toThrow();

        const updated = db.prepare('SELECT * FROM lws_simulation_character_tiers WHERE id = ?').get(existing.id);
        expect(updated.tier).toBe('core');
        expect(updated.cognitive_budget).toBe('full');
    });
});

