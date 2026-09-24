import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import {
    simulationReducer,
    verifySimulationParity,
} from '../../src/living-world/events/replay.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';

describe('LWS Phase 5 Pure Replay & Deep Parity Verification', () => {
    describe('simulationReducer Unit Tests', () => {
        test('pure reducer handles all 6 Phase 5 events in-memory with zero SQL', () => {
            let state = {
                simulation: { status: 'active', current_fictional_time: '2026-06-01T08:00:00Z', settings: {} },
                characters: {
                    'char-1': {
                        lws_id: 'char-1',
                        activity: 'idle',
                        physical_condition: 'normal',
                        runtime_state: {},
                        routines: [],
                    },
                },
                scheduled_events: {},
            };

            // 1. UPDATE_CHARACTER_ROUTINE
            state = simulationReducer(state, {
                event_type: EVENT_TYPES.UPDATE_CHARACTER_ROUTINE,
                actor_character_id: 'char-1',
                fictional_time: '2026-06-01T08:00:00Z',
                payload: {
                    routines: [
                        {
                            block_id: 'morning_patrol',
                            day_of_week: 'monday',
                            start_time: '09:00:00',
                            end_time: '12:00:00',
                            activity: 'patrolling',
                        },
                    ],
                },
            });
            expect(state.characters['char-1'].routines.length).toBe(1);
            expect(state.characters['char-1'].routines[0].activity).toBe('patrolling');

            // 2. SCHEDULE_WORLD_EVENT
            state = simulationReducer(state, {
                event_type: EVENT_TYPES.SCHEDULE_WORLD_EVENT,
                fictional_time: '2026-06-01T08:00:00Z',
                payload: {
                    scheduled_event_id: 'ev-1',
                    scheduled_fictional_time: '2026-06-01T12:00:00Z',
                    title: 'Midday Announcement',
                    description: 'Public town hall announcement',
                    target_location_id: 'loc-1',
                },
            });
            expect(state.scheduled_events['ev-1']).toBeDefined();
            expect(state.scheduled_events['ev-1'].status).toBe('pending');
            expect(state.scheduled_events['ev-1'].title).toBe('Midday Announcement');

            // 3. SUPERSEDE_SCHEDULED_EVENT
            state = simulationReducer(state, {
                event_type: EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT,
                fictional_time: '2026-06-01T08:30:00Z',
                payload: {
                    predecessor_id: 'ev-1',
                    successor_id: 'ev-2',
                    scheduled_fictional_time: '2026-06-01T13:00:00Z',
                    title: 'Rescheduled Midday Announcement',
                },
            });
            expect(state.scheduled_events['ev-1'].status).toBe('superseded');
            expect(state.scheduled_events['ev-1'].superseded_by_event_id).toBe('ev-2');
            expect(state.scheduled_events['ev-2'].status).toBe('pending');
            expect(state.scheduled_events['ev-2'].supersedes_event_id).toBe('ev-1');

            // 4. CANCEL_SCHEDULED_EVENT
            state = simulationReducer(state, {
                lws_id: 'cancel-ev-tx',
                event_type: EVENT_TYPES.CANCEL_SCHEDULED_EVENT,
                fictional_time: '2026-06-01T08:45:00Z',
                payload: {
                    scheduled_event_id: 'ev-2',
                    reason: 'inclement weather',
                },
            });
            expect(state.scheduled_events['ev-2'].status).toBe('cancelled');
            expect(state.scheduled_events['ev-2'].cancel_event_id).toBe('cancel-ev-tx');

            // 5. TRIGGER_SCHEDULED_EVENT (on a new scheduled event)
            state = simulationReducer(state, {
                event_type: EVENT_TYPES.SCHEDULE_WORLD_EVENT,
                fictional_time: '2026-06-01T09:00:00Z',
                payload: {
                    scheduled_event_id: 'ev-3',
                    scheduled_fictional_time: '2026-06-01T10:00:00Z',
                    title: 'Bell Ringing',
                },
            });
            state = simulationReducer(state, {
                lws_id: 'trigger-ev-tx',
                event_type: EVENT_TYPES.TRIGGER_SCHEDULED_EVENT,
                fictional_time: '2026-06-01T10:00:00Z',
                payload: {
                    scheduled_event_id: 'ev-3',
                },
            });
            expect(state.scheduled_events['ev-3'].status).toBe('triggered');
            expect(state.scheduled_events['ev-3'].trigger_event_id).toBe('trigger-ev-tx');

            // 6. TIME_ADVANCE
            state = simulationReducer(state, {
                event_type: EVENT_TYPES.TIME_ADVANCE,
                fictional_time: '2026-06-01T18:00:00Z',
                payload: {
                    duration_seconds: 36000,
                },
            });
            expect(state.simulation.current_fictional_time).toBe('2026-06-01T18:00:00Z');
        });
    });

    describe('Canonical Proof Scenario 5: Multi-Day Replay Determinism & Parity', () => {
        let app;
        let server;
        let baseUrl;
        let world;
        let plaza;
        let market;
        let tavern;
        let sim;
        let simBob;
        let simAlice;
        let simCharlie;
        let simDiana;
        let tempDir;

        beforeEach(async () => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-replay-test-'));
            const dbPath = path.join(tempDir, 'test.db');
            openDb(dbPath);

            app = express();
            app.use(express.json());
            app.use('/api/living-world', lwsRouter);

            await new Promise((resolve) => {
                server = app.listen(0, '127.0.0.1', () => {
                    baseUrl = `http://127.0.0.1:${server.address().port}`;
                    resolve();
                });
            });

            world = createWorld({ name: 'Replay World' });
            plaza = createLocation(world.lws_id, { name: 'Plaza' });
            market = createLocation(world.lws_id, {
                name: 'Market',
                extensions: {
                    connections: {
                        [plaza.lws_id]: { duration_seconds: 300 },
                    },
                },
            });
            tavern = createLocation(world.lws_id, {
                name: 'Tavern',
                extensions: {
                    connections: {
                        [plaza.lws_id]: { duration_seconds: 300 },
                        [market.lws_id]: { duration_seconds: 300 },
                    },
                },
            });

            sim = createSimulation(world.lws_id, {
                name: 'Sim Replay',
                initial_fictional_time: '2026-06-01T08:00:00Z', // Monday 08:00
            });

            const charBob = createCharacter(world.lws_id, { name: 'Bob' });
            simBob = addSimulationCharacter(sim.lws_id, {
                character_id: charBob.lws_id,
                current_location_id: plaza.lws_id,
                activity: 'idle',
            });

            const charAlice = createCharacter(world.lws_id, { name: 'Alice' });
            simAlice = addSimulationCharacter(sim.lws_id, {
                character_id: charAlice.lws_id,
                current_location_id: tavern.lws_id,
                activity: 'idle',
            });

            const charCharlie = createCharacter(world.lws_id, { name: 'Charlie' });
            simCharlie = addSimulationCharacter(sim.lws_id, {
                character_id: charCharlie.lws_id,
                current_location_id: market.lws_id,
                activity: 'idle',
            });

            const charDiana = createCharacter(world.lws_id, { name: 'Diana' });
            simDiana = addSimulationCharacter(sim.lws_id, {
                character_id: charDiana.lws_id,
                current_location_id: plaza.lws_id,
                activity: 'idle',
            });
        });

        afterEach(async () => {
            if (server) {
                await new Promise((resolve) => server.close(resolve));
            }
            closeDb();
            if (tempDir) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_err) { /* ignore cleanup error */ }
            }
        });

        test('replays multi-day progression with 100% attribute parity via verifySimulationParity and POST /replay-verify', async () => {
            // 1. Assign Daily Routines to Bob (4 blocks across Plaza, Market, Tavern)
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simBob.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'bob_patrol_plaza',
                            day_of_week: 'daily',
                            start_time: '08:30:00',
                            end_time: '11:00:00',
                            activity: 'patrolling',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'bob_shop_market',
                            day_of_week: 'daily',
                            start_time: '11:30:00',
                            end_time: '14:00:00',
                            activity: 'shopping',
                            target_location_id: market.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'bob_eat_tavern',
                            day_of_week: 'daily',
                            start_time: '14:30:00',
                            end_time: '18:00:00',
                            activity: 'eating',
                            target_location_id: tavern.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'bob_guard_plaza',
                            day_of_week: 'daily',
                            start_time: '18:30:00',
                            end_time: '22:00:00',
                            activity: 'guarding',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // 2. Assign Daily Routines to Alice
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'alice_clean_tavern',
                            day_of_week: 'daily',
                            start_time: '08:00:00',
                            end_time: '11:00:00',
                            activity: 'cleaning',
                            target_location_id: tavern.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'alice_trade_plaza',
                            day_of_week: 'daily',
                            start_time: '11:30:00',
                            end_time: '14:30:00',
                            activity: 'trading',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'alice_sell_market',
                            day_of_week: 'daily',
                            start_time: '15:00:00',
                            end_time: '18:30:00',
                            activity: 'selling',
                            target_location_id: market.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'alice_rest_tavern',
                            day_of_week: 'daily',
                            start_time: '19:00:00',
                            end_time: '23:00:00',
                            activity: 'resting',
                            target_location_id: tavern.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // 3. Assign Daily Routines to Charlie
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simCharlie.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'charlie_craft_market',
                            day_of_week: 'daily',
                            start_time: '09:00:00',
                            end_time: '12:00:00',
                            activity: 'crafting',
                            target_location_id: market.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'charlie_lunch_tavern',
                            day_of_week: 'daily',
                            start_time: '12:30:00',
                            end_time: '15:00:00',
                            activity: 'eating',
                            target_location_id: tavern.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'charlie_social_plaza',
                            day_of_week: 'daily',
                            start_time: '15:30:00',
                            end_time: '19:00:00',
                            activity: 'socializing',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'charlie_sleep_market',
                            day_of_week: 'daily',
                            start_time: '19:30:00',
                            end_time: '23:30:00',
                            activity: 'sleeping',
                            target_location_id: market.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // 4. Assign Daily Routines to Diana
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simDiana.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [
                        {
                            block_id: 'diana_exercise_plaza',
                            day_of_week: 'daily',
                            start_time: '07:30:00',
                            end_time: '10:30:00',
                            activity: 'exercising',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'diana_inspect_market',
                            day_of_week: 'daily',
                            start_time: '11:00:00',
                            end_time: '14:00:00',
                            activity: 'inspecting',
                            target_location_id: market.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'diana_dine_tavern',
                            day_of_week: 'daily',
                            start_time: '14:30:00',
                            end_time: '17:30:00',
                            activity: 'dining',
                            target_location_id: tavern.lws_id,
                            priority: 50,
                        },
                        {
                            block_id: 'diana_watch_plaza',
                            day_of_week: 'daily',
                            start_time: '18:00:00',
                            end_time: '22:30:00',
                            activity: 'guarding',
                            target_location_id: plaza.lws_id,
                            priority: 50,
                        },
                    ],
                }),
            });

            // 5. Day 1: Schedule World Event and advance through Day 1 (to Day 2 08:00:00Z)
            const sched1Res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Day 1 Ceremony',
                    scheduled_fictional_time: '2026-06-01T15:00:00Z',
                    target_location_id: plaza.lws_id,
                }),
            });
            const sched1 = await sched1Res.json();
            expect(sched1.lws_id).toBeDefined();

            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-02T08:00:00Z',
                }),
            });

            // 6. Day 2: Schedule and Supersede Event, advance through Day 2 (to Day 3 08:00:00Z)
            const sched2Res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Day 2 Fair Initial',
                    scheduled_fictional_time: '2026-06-02T10:00:00Z',
                    target_location_id: market.lws_id,
                }),
            });
            const sched2 = await sched2Res.json();

            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${sched2.lws_id}/supersede`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Day 2 Fair Rescheduled',
                    scheduled_fictional_time: '2026-06-02T14:00:00Z',
                    target_location_id: market.lws_id,
                }),
            });

            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-03T08:00:00Z',
                }),
            });

            // 7. Day 3: Schedule tournament and cancelled event, advance through Day 3 (to Day 4 08:00:00Z - 72h total)
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Day 3 Tournament',
                    scheduled_fictional_time: '2026-06-03T16:00:00Z',
                    target_location_id: plaza.lws_id,
                }),
            });

            const cancelEvRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Day 3 Outdoor Concert',
                    scheduled_fictional_time: '2026-06-03T19:00:00Z',
                    target_location_id: plaza.lws_id,
                }),
            });
            const cancelEv = await cancelEvRes.json();
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${cancelEv.lws_id}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'inclement weather' }),
            });

            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-04T08:00:00Z',
                }),
            });

            // 8. Direct In-Memory Parity Verification across all 3 simulated days (100+ events)
            const parityResult = verifySimulationParity(sim.lws_id);
            expect(parityResult.verified).toBe(true);
            expect(parityResult.drift_detected).toBe(false);
            expect(parityResult.event_count).toBeGreaterThanOrEqual(100);
            expect(parityResult.scheduled_event_count).toBeGreaterThanOrEqual(4);

            // 9. REST API Parity Verification Endpoint (POST /replay-verify)
            const apiVerifyRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/replay-verify`, {
                method: 'POST',
            });
            expect(apiVerifyRes.status).toBe(200);
            const apiData = await apiVerifyRes.json();
            expect(apiData.verified).toBe(true);
            expect(apiData.drift_detected).toBe(false);
            expect(apiData.event_count).toBe(parityResult.event_count);
            expect(apiData.event_count).toBeGreaterThanOrEqual(100);
        });
    });
});
