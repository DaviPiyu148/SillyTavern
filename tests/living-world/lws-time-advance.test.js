import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { verifySimulationParity } from '../../src/living-world/events/replay.js';

describe('LWS Phase 5 Time Advance and Timeline Resolution', () => {
    let app;
    let server;
    let baseUrl;
    let tempDir;
    let world;
    let townSquare;
    let forge;
    let sim;

    beforeAll(async () => {
        app = express();
        app.use(express.json());
        app.use('/api/living-world', lwsRouter);

        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    });

    afterAll(async () => {
        if (server) {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        }
    });

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-advance-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        openDb(dbPath);

        world = createWorld({ name: 'Time Advance World' });
        townSquare = createLocation(world.lws_id, { name: 'Town Square' });
        forge = createLocation(world.lws_id, { name: 'Forge' });
        sim = createSimulation(world.lws_id, {
            name: 'Sim Advance',
            initial_fictional_time: '2026-06-01T08:00:00Z', // Monday 08:00
        });
    });

    afterEach(() => {
        closeDb();
        if (tempDir) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_err) { /* ignore cleanup error */ }
        }
    });

    describe('Input Validation & Clock Drift Concurrency', () => {
        test('rejects request with neither duration nor target time', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const err = await res.json();
            expect(err.error).toMatch(/target_fictional_time or duration_seconds/);
        });

        test('rejects target_fictional_time preceding current simulation clock', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-01T07:00:00Z',
                }),
            });
            expect(res.status).toBe(400);
            const err = await res.json();
            expect(err.error).toMatch(/cannot precede/);
        });

        test('detects clock drift and rejects with HTTP 409 when expected_fictional_time mismatches', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    duration_seconds: 3600,
                    expected_fictional_time: '2026-06-01T07:00:00Z', // Mismatch
                }),
            });
            expect(res.status).toBe(409);
            const err = await res.json();
            expect(err.error).toMatch(/clock drift/i);
        });

        test('zero-duration advance idempotence: zero ledger mutations when no transitions due', async () => {
            const db = getDb();
            const countBefore = db.prepare('SELECT COUNT(*) AS c FROM lws_events WHERE simulation_id = ?').get(1).c;

            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    duration_seconds: 0,
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.current_fictional_time).toBe('2026-06-01T08:00:00Z');
            expect(data.intermediate_event_count).toBe(0);
            expect(data.root_event).toBeNull();

            const countAfter = db.prepare('SELECT COUNT(*) AS c FROM lws_events WHERE simulation_id = ?').get(1).c;
            expect(countAfter).toBe(countBefore); // 0 ledger mutations!
        });
    });

    describe('Canonical Proof Scenarios', () => {
        test('Canonical Proof Scenario 1: Eight-Hour Daily Progression with monotonic sequence', async () => {
            const charAlice = createCharacter(world.lws_id, { name: 'Alice' });
            const simAlice = addSimulationCharacter(sim.lws_id, {
                character_id: charAlice.lws_id,
                current_location_id: forge.lws_id,
                activity: 'idle',
            });

            const charBob = createCharacter(world.lws_id, { name: 'Bob' });
            const simBob = addSimulationCharacter(sim.lws_id, {
                character_id: charBob.lws_id,
                current_location_id: townSquare.lws_id,
                activity: 'idle',
            });

            // Alice routines (Forge worker): Monday 09:00 - 12:00 smithing, 12:00 - 13:00 eating
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'morning_smith',
                            day_of_week: 'monday',
                            start_time: '09:00:00',
                            end_time: '12:00:00',
                            activity: 'smithing',
                            target_location_id: forge.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'lunch',
                            day_of_week: 'monday',
                            start_time: '12:00:00',
                            end_time: '13:00:00',
                            activity: 'eating',
                            target_location_id: forge.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // Bob routines (Market patroller): Monday 11:00 - 15:00 patrolling
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simBob.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'market_patrol',
                            day_of_week: 'monday',
                            start_time: '11:00:00',
                            end_time: '15:00:00',
                            activity: 'patrolling',
                            target_location_id: townSquare.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // Advance 8 hours (28800 seconds) from 08:00:00Z to 16:00:00Z
            const advRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    duration_seconds: 28800,
                    expected_fictional_time: '2026-06-01T08:00:00Z',
                }),
            });
            expect(advRes.status).toBe(200);
            const advData = await advRes.json();

            expect(advData.current_fictional_time).toBe('2026-06-01T16:00:00Z');

            // Assert intermediate events occur at exact boundaries: 09:00, 11:00, 12:00
            const ev09 = advData.intermediate_events.find(e => e.fictional_time === '2026-06-01T09:00:00Z');
            expect(ev09).toBeDefined();
            expect(ev09.event_type).toBe(EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY);
            expect(ev09.payload.activity).toBe('smithing');

            const ev11 = advData.intermediate_events.find(e => e.fictional_time === '2026-06-01T11:00:00Z');
            expect(ev11).toBeDefined();
            expect(ev11.event_type).toBe(EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY);
            expect(ev11.payload.activity).toBe('patrolling');

            const ev12 = advData.intermediate_events.find(e => e.fictional_time === '2026-06-01T12:00:00Z');
            expect(ev12).toBeDefined();
            expect(ev12.event_type).toBe(EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY);
            expect(ev12.payload.activity).toBe('eating');

            // Assert root TIME_ADVANCE exists at exactly target time
            expect(advData.root_event).toBeDefined();
            expect(advData.root_event.event_type).toBe(EVENT_TYPES.TIME_ADVANCE);
            expect(advData.root_event.fictional_time).toBe('2026-06-01T16:00:00Z');

            // Assert strict monotonic sequence numbers
            const allEvents = [...advData.intermediate_events, advData.root_event];
            for (let i = 1; i < allEvents.length; i++) {
                expect(allEvents[i].sequence_number).toBe(allEvents[i - 1].sequence_number + 1);
            }

            // Assert pure replay parity is 100%
            const parity = verifySimulationParity(sim.lws_id);
            expect(parity.verified).toBe(true);
            expect(parity.drift_detected).toBe(false);
        });

        test('Canonical Proof Scenario 2: Overnight Rollover Across Midnight', async () => {
            const charClara = createCharacter(world.lws_id, { name: 'Clara' });
            const simClara = addSimulationCharacter(sim.lws_id, {
                character_id: charClara.lws_id,
                current_location_id: townSquare.lws_id,
                activity: 'idle',
            });

            // Clara sleep routine: Monday 22:00:00 to 06:00:00 sleeping
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simClara.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'sleep_block',
                            day_of_week: 'monday',
                            start_time: '22:00:00',
                            end_time: '06:00:00',
                            activity: 'sleeping',
                            target_location_id: townSquare.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // Fast forward to Monday 21:00:00Z first
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-01T21:00:00Z',
                }),
            });

            // Now advance from Monday 21:00:00Z to Tuesday 03:00:00Z (6 hours)
            const advRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-02T03:00:00Z',
                }),
            });
            expect(advRes.status).toBe(200);
            const advData = await advRes.json();

            // Transition to sleeping occurs at 22:00 Monday
            const sleepEv = advData.intermediate_events.find(e => e.fictional_time === '2026-06-01T22:00:00Z');
            expect(sleepEv).toBeDefined();
            expect(sleepEv.payload.activity).toBe('sleeping');

            // At 03:00 Tuesday, Clara is still sleeping under Monday-start overnight block ownership
            const db = getDb();
            const charRow = db.prepare('SELECT activity FROM lws_simulation_characters WHERE lws_id = ?').get(simClara.lws_id);
            expect(charRow.activity).toBe('sleeping');

            // Verify pure replay parity is 100%
            const parity = verifySimulationParity(sim.lws_id);
            expect(parity.verified).toBe(true);
            expect(parity.drift_detected).toBe(false);
        });

        test('Canonical Proof Scenario 3: Scheduled World Event Execution & Terminal Immutability', async () => {
            // Fast forward simulation clock to Monday 12:00:00Z to explicitly test the 12:00 -> 16:00 interval
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-01T12:00:00Z',
                }),
            });

            // Schedule Market Festival for Monday 14:00:00Z
            const schedRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Market Festival',
                    scheduled_fictional_time: '2026-06-01T14:00:00Z',
                    target_location_id: townSquare.lws_id,
                }),
            });
            expect(schedRes.status).toBe(201);
            const schedData = await schedRes.json();
            const eventId = schedData.lws_id;

            // Advance from 12:00:00Z to 16:00:00Z
            const advRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-01T16:00:00Z',
                    expected_fictional_time: '2026-06-01T12:00:00Z',
                }),
            });
            expect(advRes.status).toBe(200);
            const advData = await advRes.json();

            // Assert TRIGGER_SCHEDULED_EVENT fired at exactly 14:00:00Z
            const triggerEv = advData.intermediate_events.find(e => e.fictional_time === '2026-06-01T14:00:00Z');
            expect(triggerEv).toBeDefined();
            expect(triggerEv.event_type).toBe(EVENT_TYPES.TRIGGER_SCHEDULED_EVENT);
            expect(triggerEv.payload.scheduled_event_id).toBe(eventId);

            // Verify scheduled event status is now 'triggered'
            const getRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${eventId}`);
            expect(getRes.status).toBe(200);
            const triggeredRow = await getRes.json();
            expect(triggeredRow.status).toBe('triggered');

            // Attempt to cancel triggered event aborts with 422
            const cancelRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${eventId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'cancel after trigger' }),
            });
            expect(cancelRes.status).toBe(422);

            // Attempt to supersede triggered event aborts with 422
            const supersedeRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${eventId}/supersede`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Late Festival',
                    scheduled_fictional_time: '2026-06-01T18:00:00Z',
                }),
            });
            expect(supersedeRes.status).toBe(422);

            // Verify pure replay parity is 100%
            const parity = verifySimulationParity(sim.lws_id);
            expect(parity.verified).toBe(true);
            expect(parity.drift_detected).toBe(false);
        });
    });
});
