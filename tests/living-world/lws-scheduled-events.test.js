import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';

describe('LWS Phase 5 Scheduled Events and Reciprocal Supersession', () => {
    let app;
    let server;
    let baseUrl;
    let tempDir;
    let world;
    let loc;
    let sim;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-sched-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        openDb(dbPath);

        app = express();
        app.use(express.json());
        app.use('/api/living-world', lwsRouter);

        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });

        world = createWorld({ name: 'Scheduled Events World' });
        loc = createLocation(world.lws_id, { name: 'Town Square' });
        sim = createSimulation(world.lws_id, {
            name: 'Sim Scheduled',
            initial_fictional_time: '2026-06-01T12:00:00Z',
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

    test('POST /scheduled-events creates a scheduled event with HTTP 201', async () => {
        const payload = {
            title: 'Summer Solstice Feast',
            description: 'Annual village feast in town square',
            scheduled_fictional_time: '2026-06-01T18:00:00Z',
            target_location_id: loc.lws_id,
            payload: { feast_tier: 'grand' },
        };

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.lws_id).toBeDefined();
        expect(data.title).toBe('Summer Solstice Feast');
        expect(data.status).toBe('pending');
        expect(data.target_location_id).toBe(loc.lws_id);
        expect(data.commit_event).toBeDefined();
        expect(data.commit_event.event_type).toBe('SCHEDULE_WORLD_EVENT');
    });

    test('POST /scheduled-events rejects past fictional timestamp with HTTP 400', async () => {
        const payload = {
            title: 'Past Event',
            scheduled_fictional_time: '2026-06-01T10:00:00Z', // Before sim clock 12:00:00
        };

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        expect(res.status).toBe(400);
        const err = await res.json();
        expect(err.error).toMatch(/cannot precede simulation current fictional time/);
    });

    test('GET /scheduled-events lists and filters events', async () => {
        // Create 2 events at different times
        await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Event A',
                scheduled_fictional_time: '2026-06-01T14:00:00Z',
            }),
        });

        await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Event B',
                scheduled_fictional_time: '2026-06-01T20:00:00Z',
            }),
        });

        // Query all
        const listAll = await (await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`)).json();
        expect(listAll).toHaveLength(2);
        expect(listAll[0].title).toBe('Event A');
        expect(listAll[1].title).toBe('Event B');

        // Filter by to_time
        const filtered = await (await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events?to_time=2026-06-01T15:00:00Z`)).json();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].title).toBe('Event A');
    });

    test('POST /scheduled-events/:id/cancel cancels a pending event and rejects re-cancellation', async () => {
        const createRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Event to Cancel',
                scheduled_fictional_time: '2026-06-01T15:00:00Z',
            }),
        });
        const created = await createRes.json();

        // 1. Cancel
        const cancelRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${created.lws_id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Rain forecast' }),
        });
        expect(cancelRes.status).toBe(200);
        const cancelled = await cancelRes.json();
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancel_event).toBeDefined();

        // 2. Re-cancel must fail with HTTP 409
        const recancelRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${created.lws_id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Try again' }),
        });
        expect(recancelRes.status).toBe(409);
    });

    test('POST /scheduled-events/:id/supersede links predecessor and successor reciprocally', async () => {
        const createRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Original Event',
                scheduled_fictional_time: '2026-06-01T15:00:00Z',
            }),
        });
        const original = await createRes.json();

        // Supersede original event
        const supersedeRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${original.lws_id}/supersede`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Rescheduled Event',
                scheduled_fictional_time: '2026-06-01T17:00:00Z',
                description: 'Delayed by two hours',
            }),
        });

        expect(supersedeRes.status).toBe(201);
        const successor = await supersedeRes.json();
        expect(successor.status).toBe('pending');
        expect(successor.title).toBe('Rescheduled Event');
        expect(successor.supersedes_event_id).toBe(original.lws_id);

        // Fetch predecessor and verify reciprocal link and status
        const predRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${original.lws_id}`);
        const predecessor = await predRes.json();
        expect(predecessor.status).toBe('superseded');
        expect(predecessor.superseded_by_event_id).toBe(successor.lws_id);

        // Attempting to supersede again must fail with HTTP 409
        const resupRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/scheduled-events/${original.lws_id}/supersede`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Attempt Duplicate',
                scheduled_fictional_time: '2026-06-01T19:00:00Z',
            }),
        });
        expect(resupRes.status).toBe(409);
    });
});
