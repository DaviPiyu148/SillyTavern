import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation, deleteLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';

describe('LWS Phase 5 Time Security, Provenance, and Boundary Isolation', () => {
    let app;
    let server;
    let baseUrl;
    let tempDir;
    let world;
    let loc1;
    let sim1;
    let sim2;
    let simChar1;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-security-test-'));
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

        world = createWorld({ name: 'Security World' });
        loc1 = createLocation(world.lws_id, { name: 'Gate' });

        sim1 = createSimulation(world.lws_id, {
            name: 'Sim 1',
            initial_fictional_time: '2026-06-01T08:00:00Z',
        });
        sim2 = createSimulation(world.lws_id, {
            name: 'Sim 2',
            initial_fictional_time: '2026-06-01T08:00:00Z',
        });

        const char1 = createCharacter(world.lws_id, { name: 'Guard' });
        simChar1 = addSimulationCharacter(sim1.lws_id, {
            character_id: char1.lws_id,
            current_location_id: loc1.lws_id,
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

    describe('One Authoritative Path: Generic POST /events Policy', () => {
        const phase5Events = [
            EVENT_TYPES.TIME_ADVANCE,
            EVENT_TYPES.SCHEDULE_WORLD_EVENT,
            EVENT_TYPES.CANCEL_SCHEDULED_EVENT,
            EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT,
            EVENT_TYPES.TRIGGER_SCHEDULED_EVENT,
            EVENT_TYPES.UPDATE_CHARACTER_ROUTINE,
        ];

        for (const eventType of phase5Events) {
            test(`generic POST /events rejects ${eventType} with HTTP 422 DEDICATED_ROUTE_REQUIRED`, async () => {
                const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/events`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: eventType,
                        fictional_time: '2026-06-01T08:00:00Z',
                        actor_character_id: simChar1.lws_id,
                        payload: {},
                    }),
                });
                expect(res.status).toBe(422);
                const err = await res.json();
                expect(err.code).toBe('DEDICATED_ROUTE_REQUIRED');
            });
        }
    });

    describe('Fictional Clock Authority & Future-Dating Prevention', () => {
        test('generic POST /events rejects direct future-dated event with HTTP 422 FICTIONAL_TIME_MISMATCH', async () => {
            // Simulation is at 08:00:00Z; caller proposes 09:00:00Z directly
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: EVENT_TYPES.MOVE_CHARACTER,
                    fictional_time: '2026-06-01T09:00:00Z', // Future-dated
                    actor_character_id: simChar1.lws_id,
                    location_id: loc1.lws_id,
                }),
            });
            expect(res.status).toBe(422);
            const err = await res.json();
            expect(err.code).toBe('FICTIONAL_TIME_MISMATCH');
        });
    });

    describe('Provenance Lockdown', () => {
        test('rejects external HTTP proposal asserting provenance system with HTTP 403', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: EVENT_TYPES.MOVE_CHARACTER,
                    fictional_time: '2026-06-01T08:00:00Z',
                    actor_character_id: simChar1.lws_id,
                    location_id: loc1.lws_id,
                    provenance: 'system',
                }),
            });
            expect(res.status).toBe(403);
            const err = await res.json();
            expect(err.code).toBe('FORBIDDEN_PROVENANCE');
        });

        test('rejects external HTTP proposal asserting provenance simulation_engine with HTTP 403', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_type: EVENT_TYPES.MOVE_CHARACTER,
                    fictional_time: '2026-06-01T08:00:00Z',
                    actor_character_id: simChar1.lws_id,
                    location_id: loc1.lws_id,
                    provenance: 'simulation_engine',
                }),
            });
            expect(res.status).toBe(403);
            const err = await res.json();
            expect(err.code).toBe('FORBIDDEN_PROVENANCE');
        });
    });

    describe('Cross-Simulation Isolation', () => {
        test('cannot assign routine to character belonging to another simulation (HTTP 404)', async () => {
            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim2.lws_id}/characters/${simChar1.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [{
                        block_id: 'cross_sim_routine',
                        day_of_week: 'daily',
                        start_time: '09:00:00',
                        end_time: '12:00:00',
                        activity: 'wandering',
                    }],
                }),
            });
            expect(res.status).toBe(404);
        });

        test('cannot cancel scheduled event belonging to another simulation (HTTP 404)', async () => {
            // Schedule event in Sim 1
            const schedRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Sim 1 Event',
                    scheduled_fictional_time: '2026-06-01T12:00:00Z',
                }),
            });
            const event1 = await schedRes.json();

            // Try to cancel via Sim 2 route
            const cancelRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim2.lws_id}/scheduled-events/${event1.lws_id}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'cross-sim attack' }),
            });
            expect(cancelRes.status).toBe(404);
        });
    });

    describe('Soft-Deleted Entity Protection', () => {
        test('rejects routine assignment referencing soft-deleted location (HTTP 400)', async () => {
            const tempLoc = createLocation(world.lws_id, { name: 'Temporary Depot' });
            deleteLocation(world.lws_id, tempLoc.lws_id);

            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/characters/${simChar1.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [{
                        block_id: 'deleted_loc_routine',
                        day_of_week: 'daily',
                        start_time: '09:00:00',
                        end_time: '12:00:00',
                        activity: 'scouting',
                        target_location_id: tempLoc.lws_id,
                    }],
                }),
            });
            expect(res.status).toBe(400);
            const err = await res.json();
            expect(err.error).toMatch(/soft-deleted/i);
        });

        test('rejects scheduled event referencing soft-deleted location (HTTP 400)', async () => {
            const tempLoc = createLocation(world.lws_id, { name: 'Demolished Shrine' });
            deleteLocation(world.lws_id, tempLoc.lws_id);

            const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim1.lws_id}/scheduled-events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Shrine Rite',
                    scheduled_fictional_time: '2026-06-01T12:00:00Z',
                    target_location_id: tempLoc.lws_id,
                }),
            });
            expect(res.status).toBe(400);
            const err = await res.json();
            expect(err.error).toMatch(/soft-deleted/i);
        });
    });
});
