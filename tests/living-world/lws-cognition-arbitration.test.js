import { describe, test, expect } from '@jest/globals';
import {
    arbitrateRoutine,
    selectWinningIntention,
    calculatePlannedDeparture,
} from '../../src/living-world/cognition/arbitration.js';

describe('LWS Phase 7 — Autonomous Scheduling & Routine Arbitration', () => {
    const mockWorld = { id: 1, base_edge_distance_meters: 1000 };

    test('Tier 1: Director override takes highest precedence', () => {
        const character = {
            runtime_state: {
                director_override: { active: true, activity: 'guarding_gate' },
            },
            routines: [],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T08:00:00Z');
        expect(result.tier).toBe('DIRECTOR_OVERRIDE');
        expect(result.activity).toBe('guarding_gate');
    });

    test('Tier 2: Interrupted takes precedence when severe physical condition present', () => {
        const character = {
            physical_condition: 'exhausted',
            runtime_state: {},
            routines: [{ fictional_start_time: '2026-01-01T08:00:00Z', fictional_end_time: '2026-01-01T12:00:00Z', activity: 'working' }],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T09:00:00Z');
        expect(result.tier).toBe('INTERRUPTED');
        expect(result.activity).toBe('collapsing_to_rest');
    });

    test('Tier 3: Goal pursuit activates for acute need goal', () => {
        const character = {
            runtime_state: {
                goals: [{ id: 1, lws_id: 'g-1', goal_type: 'acute_need', status: 'active', priority: 90, urgency: 100 }],
                intentions: [{ id: 1, lws_id: 'i-1', goal_id: 1, status: 'active', priority: 90, action_type: 'REST' }],
            },
            routines: [{ fictional_start_time: '2026-01-01T08:00:00Z', fictional_end_time: '2026-01-01T12:00:00Z', activity: 'working' }],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T09:00:00Z');
        expect(result.tier).toBe('GOAL_PURSUIT');
        expect(result.intention.lws_id).toBe('i-1');
    });

    test('Tier 3: Routine gap enters Goal Pursuit if goals exist', () => {
        const character = {
            runtime_state: {
                goals: [{ id: 1, lws_id: 'g-1', goal_type: 'short_term', status: 'active', priority: 40, urgency: 50 }],
                intentions: [{ id: 1, lws_id: 'i-1', goal_id: 1, status: 'active', priority: 40, action_type: 'WORK' }],
            },
            routines: [], // Gap
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T14:00:00Z');
        expect(result.tier).toBe('GOAL_PURSUIT');
    });

    test('Tier 4: Travel tier activates when in transit', () => {
        const character = {
            runtime_state: {
                travel: { status: 'in_transit', destination_location_id: 2 },
            },
            routines: [],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T08:00:00Z');
        expect(result.tier).toBe('TRAVEL');
        expect(result.travel.destination_location_id).toBe(2);
    });

    test('Tier 5: Routine block executes during active routine window', () => {
        const routineBlock = {
            fictional_start_time: '2026-01-01T08:00:00Z',
            fictional_end_time: '2026-01-01T12:00:00Z',
            activity: 'farming',
        };
        const character = {
            runtime_state: {},
            routines: [routineBlock],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T09:00:00Z');
        expect(result.tier).toBe('ROUTINE');
        expect(result.block.activity).toBe('farming');
    });

    test('Tier 6: Idle fallback when no routine block and no active goals', () => {
        const character = {
            runtime_state: {},
            routines: [],
        };

        const result = arbitrateRoutine(character, mockWorld, '2026-01-01T14:00:00Z');
        expect(result.tier).toBe('IDLE');
    });

    test('calculates planned departure timestamp T_dep correctly', () => {
        // Routine starts at 09:00:00Z, distance 2 edges, base distance 1000m, travel speed 1.5 mps
        // travel_duration_seconds = round((2 * 1000) / 1.5) = round(1333.33) = 1333 s = 22m 13s
        // T_dep = 09:00:00 - 1333s = 08:37:47Z
        const T_dep = calculatePlannedDeparture('2026-01-01T09:00:00Z', 2, 1000, 1.5);
        expect(T_dep).toBe('2026-01-01T08:37:47Z');
    });
});
