import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/living-world/migrations/index.js';
import { calculateProposalScore } from '../../src/living-world/cognition/deliberation.js';

describe('Phase 9 - Environment & Cognition Integration', () => {
    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        runMigrations(db);
    });

    afterEach(() => {
        if (db) db.close();
    });

    it('applies severe weather travel feasibility penalty in deliberation scoring', () => {
        const character = { lws_id: 'char-1', current_location_id: 1 };
        const proposal = { action_type: 'MOVE_CHARACTER', payload: { distance: 1 }, is_outdoor: true };

        // Normal weather context
        const normalContext = {
            environment: { weather: 'clear', lighting_level: 'bright' },
            operational_state: { access_status: 'open' },
        };
        const scoreNormal = calculateProposalScore(proposal, character, [], [], [], {}, {}, normalContext);

        // Storm weather context
        const stormContext = {
            environment: { weather: 'storm', lighting_level: 'dim' },
            operational_state: { access_status: 'open' },
        };
        const scoreStorm = calculateProposalScore(proposal, character, [], [], [], {}, {}, stormContext);

        // Storm score should have additional feasibility penalty (+20 penalty)
        expect(scoreStorm.details.penalty).toBeGreaterThan(scoreNormal.details.penalty);
        expect(scoreStorm.details.penalty - scoreNormal.details.penalty).toBe(20);
    });

    it('applies closed location access penalty in deliberation scoring', () => {
        const character = { lws_id: 'char-1', current_location_id: 1 };
        const proposal = { action_type: 'MOVE_CHARACTER', payload: { distance: 1 } };

        // Open access context
        const openContext = {
            environment: { weather: 'clear' },
            operational_state: { access_status: 'open' },
        };
        const scoreOpen = calculateProposalScore(proposal, character, [], [], [], {}, {}, openContext);

        // Closed access context
        const closedContext = {
            environment: { weather: 'clear' },
            operational_state: { access_status: 'closed' },
        };
        const scoreClosed = calculateProposalScore(proposal, character, [], [], [], {}, {}, closedContext);

        // Closed access should impose +100 penalty
        expect(scoreClosed.details.penalty - scoreOpen.details.penalty).toBe(100);
        expect(scoreClosed.score).toBeLessThan(scoreOpen.score);
    });
});
