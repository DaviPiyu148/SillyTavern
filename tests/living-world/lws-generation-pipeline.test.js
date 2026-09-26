import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    getDb,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    commitEvent,
    EVENT_TYPES,
    GENERATION_MODES,
    generateSimulationTurn,
    listNarrativeTurns,
} from '../../src/living-world/index.js';

describe('Phase 10 - Simulation Turn Generation & Savepoint Pipeline', () => {
    let world, charA, charB, locA, sim;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Turn Realm' });
        charA = createCharacter(world.lws_id, { name: 'Rowan', personality: 'Bold' });
        charB = createCharacter(world.lws_id, { name: 'Elora', personality: 'Cunning' });
        locA = createLocation(world.lws_id, { name: 'Great Hall', location_type: 'indoor' });
        sim = createSimulation(world.lws_id, { name: 'Turn Sim', initial_fictional_time: '1000-01-01T12:00:00Z' });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charA.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: { character_id: charA.lws_id, activity: 'standing watch' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charB.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: { character_id: charB.lws_id, activity: 'observing' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });
    });

    afterEach(() => {
        closeDb();
    });

    it('successfully commits turn with valid proposal and saves narrative turn', async () => {
        const mockModelResponse = `
<lws_proposal>
{
  "event_type": "COMMUNICATE",
  "actor_character_id": "${charA.lws_id}",
  "target_character_id": "${charB.lws_id}",
  "location_id": "${locA.lws_id}",
  "payload": {
    "channel": "direct",
    "content": "Stay alert, something is wrong."
  }
}
</lws_proposal>
Rowan stepped toward Elora, lowering his voice. "Stay alert, something is wrong," he warned quietly.`;

        const result = await generateSimulationTurn(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
            user_input: 'Rowan, what do you see?',
            mock_response: mockModelResponse,
        });

        expect(result.success).toBe(true);
        expect(result.narrative).toContain('Rowan stepped toward Elora');
        expect(result.proposals).toHaveLength(1);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].event_type).toBe('COMMUNICATE');
        expect(result.turn).toBeDefined();
        expect(result.turn.status).toBe('committed');
        expect(result.turn.parsed_narrative).toContain('Rowan stepped toward Elora');

        const turns = listNarrativeTurns(sim.lws_id);
        expect(turns).toHaveLength(1);
        expect(turns[0].status).toBe('committed');
    });

    it('records pure narrative turn without proposals as committed', async () => {
        const mockModelResponse = 'The wind howled outside the high stone walls, rattling the stained glass windows.';

        const result = await generateSimulationTurn(sim.lws_id, {
            generation_mode: GENERATION_MODES.WORLD_NARRATION,
            mock_response: mockModelResponse,
        });

        expect(result.success).toBe(true);
        expect(result.narrative).toBe(mockModelResponse);
        expect(result.proposals).toHaveLength(0);
        expect(result.events).toHaveLength(0);
        expect(result.turn).toBeDefined();
        expect(result.turn.status).toBe('committed');
    });

    it('rolls back to savepoint and records turn as rejected when proposal violates authority', async () => {
        // Character A proposes an invalid action: non-existent target or invalid event type
        const mockInvalidProposal = `
<lws_proposal>
{
  "event_type": "COMMUNICATE",
  "actor_character_id": "${charA.lws_id}",
  "target_character_id": "00000000-0000-0000-0000-000000000000",
  "location_id": "${locA.lws_id}",
  "payload": {
    "content": "Hello ghost"
  }
}
</lws_proposal>
Rowan called into the empty void.`;

        const result = await generateSimulationTurn(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
            mock_response: mockInvalidProposal,
        });

        expect(result.success).toBe(false);
        expect(result.turn).toBeDefined();
        expect(result.turn.status).toBe('rejected');
        expect(result.error).toBeDefined();

        // Database remains consistent: turn is recorded as rejected
        const turns = listNarrativeTurns(sim.lws_id);
        expect(turns).toHaveLength(1);
        expect(turns[0].status).toBe('rejected');
    });
});
