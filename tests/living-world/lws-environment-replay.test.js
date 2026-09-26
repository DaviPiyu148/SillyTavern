import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { commitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { verifySimulationParity } from '../../src/living-world/events/replay.js';
import { advanceFictionalTime } from '../../src/living-world/time/time-advance.js';

describe('Phase 9 - Pure In-Memory Replay Parity Across 14 Tables', () => {
    let db;
    let world;
    let location;
    let simulation;
    let heroChar;
    let bakerChar;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Replay World', summary: 'World for replay parity' });
        location = createLocation(world.lws_id, { name: 'Village Square', summary: 'Main square' });
        simulation = createSimulation(world.lws_id, { name: 'Replay Sim', initial_fictional_time: '2026-06-15T08:00:00Z' });

        heroChar = createCharacter(world.lws_id, { name: 'Hero', description: 'The hero', personality: 'Brave' });
        bakerChar = createCharacter(world.lws_id, { name: 'Baker', description: 'The baker', personality: 'Kind' });
    });

    afterEach(() => {
        closeDb();
    });

    it('achieves 100% canonical replay parity after complex sequence of Phase 9 events', async () => {
        // 1. Join Core character
        const join1 = commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T08:00:00Z',
            payload: {
                character_id: heroChar.lws_id,
                tier: 'core',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        // 2. Join Promoted Supporting character
        const join2 = commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T08:00:00Z',
            payload: {
                character_id: bakerChar.lws_id,
                tier: 'supporting',
                promotion: {
                    source_archetype_key: 'baker',
                    source_transient_id: 'transient-baker-1',
                    promotion_reason: 'direct_interaction',
                    promoted_to_tier: 'supporting',
                },
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        // 3. Update environment & operational state via UPDATE_RUNTIME_STATE
        commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: join1.actor_character_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T08:00:00Z',
            payload: {
                environment: {
                    weather: 'clear',
                    temperature_baseline: 22.0,
                },
                operational_state: {
                    access_status: 'open',
                    crowd_density: 'moderate',
                    ambient_capacity: 12,
                },
            },
            provenance: 'simulation_engine',
        }, { isInternalEngine: true, isAdmin: true, db });

        // 4. Advance time to midday
        await advanceFictionalTime(db, {
            simLwsId: simulation.lws_id,
            targetFictionalTime: '2026-06-15T12:00:00Z',
        });

        // 5. Elevate Baker to Core tier via DIRECTOR_MODIFY_STATE
        commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: join2.actor_character_id,
            fictional_time: '2026-06-15T12:00:00Z',
            payload: {
                target: 'character_tier',
                target_id: join2.actor_character_id,
                tier_elevation: 'core',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true, db });

        // Parity verification must succeed with 0 differences
        const result = verifySimulationParity(simulation.lws_id);
        expect(result.verified).toBe(true);
        expect(result.drift_detected).toBe(false);
    });

    it('detects intentional state drift in environment tables', () => {
        const join = commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T08:00:00Z',
            payload: { character_id: heroChar.lws_id },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true, db });

        commitEvent(simulation.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: join.actor_character_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-15T08:00:00Z',
            payload: {
                environment: {
                    weather: 'clear',
                },
            },
            provenance: 'simulation_engine',
        }, { isInternalEngine: true, isAdmin: true, db });

        // Manually tamper with weather in DB behind event engine's back
        db.prepare(`
            UPDATE lws_location_environments
            SET weather = 'blizzard'
            WHERE simulation_id = (SELECT id FROM lws_simulations WHERE lws_id = ?)
        `).run(simulation.lws_id);

        // Calling verifySimulationParity should catch the drift
        expect(() => {
            verifySimulationParity(simulation.lws_id);
        }).toThrow();
    });
});
