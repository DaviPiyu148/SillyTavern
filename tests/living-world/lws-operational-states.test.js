import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import { evaluateOperatingHours } from '../../src/living-world/environment/common.js';
import {
    getLocationOperationalState,
    updateLocationOperationalState,
} from '../../src/living-world/environment/operational-states.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { advanceFictionalTime } from '../../src/living-world/time/time-advance.js';

describe('Phase 9 - Operational States & Access Control', () => {
    let db;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();
    });

    afterEach(() => {
        closeDb();
    });

    it('evaluates standard operating hours schedule accurately', () => {
        const schedule = {
            monday: { open: '09:00', close: '17:00' },
            tuesday: { open: '09:00', close: '17:00' },
            wednesday: { open: '09:00', close: '17:00' },
            thursday: { open: '09:00', close: '17:00' },
            friday: { open: '09:00', close: '17:00' },
            saturday: null,
            sunday: null,
        };

        // Monday 10:00 -> open
        expect(evaluateOperatingHours('2026-06-15T10:00:00.000Z', schedule)).toBe('open');

        // Monday 08:30 -> closed
        expect(evaluateOperatingHours('2026-06-15T08:30:00.000Z', schedule)).toBe('closed');

        // Monday 18:00 -> closed
        expect(evaluateOperatingHours('2026-06-15T18:00:00.000Z', schedule)).toBe('closed');

        // Sunday 12:00 -> closed
        expect(evaluateOperatingHours('2026-06-21T12:00:00.000Z', schedule)).toBe('closed');
    });

    it('evaluates overnight operating hours schedule correctly', () => {
        const tavernSchedule = {
            friday: { open: '18:00', close: '02:00' },
            saturday: { open: '18:00', close: '02:00' },
        };

        // Friday 23:00 -> open
        expect(evaluateOperatingHours('2026-06-19T23:00:00.000Z', tavernSchedule)).toBe('open');

        // Saturday 01:30 (Friday night spillover) -> open
        expect(evaluateOperatingHours('2026-06-20T01:30:00.000Z', tavernSchedule)).toBe('open');

        // Saturday 03:00 -> closed
        expect(evaluateOperatingHours('2026-06-20T03:00:00.000Z', tavernSchedule)).toBe('closed');
    });

    it('manages operational states, dynamic access transitions, and overrides across TIME_ADVANCE', async () => {
        const world = createWorld({ name: 'Ops World' });
        const loc1 = createLocation(world.lws_id, { name: 'Shop' });
        const loc2 = createLocation(world.lws_id, { name: 'Fortress' });
        const sim = createSimulation(world.lws_id, {
            name: 'Ops Sim',
            initial_fictional_time: '2026-06-15T08:00:00Z',
        });

        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const loc1Row = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(loc1.lws_id);
        const loc2Row = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(loc2.lws_id);

        const schedule = {
            monday: { open: '09:00', close: '17:00' },
        };

        // loc1: dynamic operating hours
        updateLocationOperationalState(db, simRow.id, loc1Row.id, {
            operating_hours: schedule,
            crowd_density: 'sparse',
            ambient_capacity: 15,
        }, '2026-06-15T08:00:00Z');

        // loc2: explicit barricaded override
        updateLocationOperationalState(db, simRow.id, loc2Row.id, {
            access_override: 'barricaded',
            crowd_density: 'empty',
            ambient_capacity: 0,
        }, '2026-06-15T08:00:00Z');

        // Initial state check at 08:00
        const initialOps1 = getLocationOperationalState(db, simRow.id, loc1Row.id, '2026-06-15T08:00:00Z');
        expect(initialOps1.access_status).toBe('closed');

        const initialOps2 = getLocationOperationalState(db, simRow.id, loc2Row.id, '2026-06-15T08:00:00Z');
        expect(initialOps2.access_status).toBe('barricaded');
        expect(initialOps2.access_override).toBe('barricaded');

        // Advance fictional time to Monday 11:00 (Shop should open, Fortress remains barricaded)
        await advanceFictionalTime(db, {
            simLwsId: sim.lws_id,
            targetFictionalTime: '2026-06-15T11:00:00Z',
        });

        const ops1After = getLocationOperationalState(db, simRow.id, loc1Row.id, '2026-06-15T11:00:00Z');
        expect(ops1After.access_status).toBe('open');

        const ops2After = getLocationOperationalState(db, simRow.id, loc2Row.id, '2026-06-15T11:00:00Z');
        expect(ops2After.access_status).toBe('barricaded');
        expect(ops2After.access_override).toBe('barricaded');
    });
});
