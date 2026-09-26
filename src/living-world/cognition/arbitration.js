import { isSeverePhysicalCondition, deriveInterruptedActivity } from './needs.js';
import { safeJsonParse } from '../simulations/common.js';
import { calculateLocationDistance } from './deliberation.js';

/**
 * Derives the goal category (4 > 3 > 2 > 1) for an active goal.
 *
 * @param {object | null} goal
 * @returns {number}
 */
export function getGoalCategory(goal) {
    if (!goal) return 1;
    if (goal.goal_type === 'acute_need') return 3;
    if (goal.goal_type === 'routine_override') return 2;
    if (goal.priority >= 60) return 2;
    return 1;
}

/**
 * 11.4 Deterministic Intention Selection Hierarchy
 *
 * @param {object[]} activeIntentions
 * @param {object[]} activeGoals
 * @returns {object | null} Winning intention
 */
export function selectWinningIntention(activeIntentions, activeGoals) {
    if (!Array.isArray(activeIntentions) || activeIntentions.length === 0) {
        return null;
    }

    const sorted = [...activeIntentions].sort((a, b) => {
        const pgA = activeGoals.find(g => String(g.id) === String(a.goal_id) || String(g.lws_id) === String(a.goal_id)) ?? null;
        const pgB = activeGoals.find(g => String(g.id) === String(b.goal_id) || String(g.lws_id) === String(b.goal_id)) ?? null;

        // 1. Parent goal category DESC (4 > 3 > 2 > 1)
        const catA = getGoalCategory(pgA);
        const catB = getGoalCategory(pgB);
        if (catA !== catB) return catB - catA;

        // 2. Effective priority DESC
        const effA = pgA ? (0.60 * (pgA.priority ?? 50) + 0.40 * (pgA.urgency ?? 50)) : (a.priority ?? 50);
        const effB = pgB ? (0.60 * (pgB.priority ?? 50) + 0.40 * (pgB.urgency ?? 50)) : (b.priority ?? 50);
        if (effA !== effB) return effB - effA;

        // 3. Status precedence DESC: executing (2) > active (1)
        const statusA = a.status === 'executing' ? 2 : 1;
        const statusB = b.status === 'executing' ? 2 : 1;
        if (statusA !== statusB) return statusB - statusA;

        // 4. Lexical tie-breaker: lws_id ASC
        return String(a.lws_id || '').localeCompare(String(b.lws_id || ''));
    });

    return sorted[0];
}

/**
 * Finds the active routine block for a given fictional time.
 *
 * @param {object[]} routines
 * @param {string} fictionalTime ISO 8601 string
 * @returns {object | null}
 */
export function getRoutineAtTime(routines, fictionalTime) {
    if (!Array.isArray(routines) || routines.length === 0 || !fictionalTime) {
        return null;
    }

    const date = new Date(fictionalTime);
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()];
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}:${seconds}`;

    for (const r of routines) {
        if (r.enabled === 0 || r.enabled === false || Boolean(r.deleted_at)) continue;
        if (r.day_of_week && r.day_of_week !== dayOfWeek && r.day_of_week !== 'all') continue;

        if (r.fictional_start_time && r.fictional_end_time) {
            const startMs = new Date(r.fictional_start_time).getTime();
            const endMs = new Date(r.fictional_end_time).getTime();
            const currMs = date.getTime();
            if (currMs >= startMs && currMs < endMs) return r;
        }

        const start = r.start_time;
        const end = r.end_time;

        if (start && end) {
            if (start <= end) {
                if (timeStr >= start && timeStr < end) return r;
            } else {
                // Over midnight
                if (timeStr >= start || timeStr < end) return r;
            }
        }
    }

    return null;
}

/**
 * 11.3 Complete 6-Tier Routine Hierarchy
 *
 * @param {object} character Simulation character
 * @param {object} world Authored world
 * @param {string} TFictional Fictional time ISO 8601
 * @param {object} [options] { activeGoals: object[], activeIntentions: object[], routines: object[] }
 * @returns {object} { tier, ...details }
 */
export function arbitrateRoutine(character, world, TFictional, options = {}) {
    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    // Tier 1: Director Override
    if (runtimeState.director_override?.active === true) {
        return { tier: 'DIRECTOR_OVERRIDE', ...runtimeState.director_override };
    }

    // Tier 2: Interrupted (severe physical condition)
    if (isSeverePhysicalCondition(character)) {
        return { tier: 'INTERRUPTED', activity: deriveInterruptedActivity(character) };
    }

    // Tier 3: Goal Pursuit
    const rawGoals = options.activeGoals || character.goals || runtimeState.goals || [];
    const rawIntentions = options.activeIntentions || character.intentions || runtimeState.intentions || [];

    const activeGoals = rawGoals.filter(g => g.status === 'active' && !g.deleted_at);
    const activeIntentions = rawIntentions.filter(i => i.status === 'active' || i.status === 'executing');
    const activeAcuteGoal = activeGoals.find(g => g.goal_type === 'acute_need');

    const routines = options.routines || character.routines || [];
    const routineBlock = getRoutineAtTime(routines, TFictional);

    const hasRoutineOverride = activeIntentions.some(i => {
        const pg = activeGoals.find(g => String(g.id) === String(i.goal_id) || String(g.lws_id) === String(i.goal_id));
        return pg?.goal_type === 'routine_override';
    });

    const hasHighPriorityGoal = activeIntentions.some(i => {
        const pg = activeGoals.find(g => String(g.id) === String(i.goal_id) || String(g.lws_id) === String(i.goal_id));
        const effPriority = pg ? (0.60 * (pg.priority ?? 50) + 0.40 * (pg.urgency ?? 50)) : (i.priority ?? 50);
        return effPriority >= 60;
    });

    // Routine Gap: enters Goal Pursuit iff at least one active goal or intention exists
    const isRoutineGap = (routineBlock === null);
    const hasAnyActiveGoalOrIntention = (activeIntentions.length > 0 || activeGoals.length > 0);
    const qualifiesInRoutineGap = isRoutineGap && hasAnyActiveGoalOrIntention;

    if (activeAcuteGoal || hasRoutineOverride || hasHighPriorityGoal || qualifiesInRoutineGap) {
        // If we don't have active intentions but have active goals, synthesize candidates from active goals
        let intentionsToArbitrate = [...activeIntentions];
        if (intentionsToArbitrate.length === 0 && activeGoals.length > 0) {
            intentionsToArbitrate = activeGoals.map(g => ({
                lws_id: g.lws_id,
                goal_id: g.id || g.lws_id,
                action_type: g.objective_action_type || 'GENERAL_ACTION',
                priority: g.priority,
                status: 'active',
            }));
        }

        const winner = selectWinningIntention(intentionsToArbitrate, activeGoals);
        if (winner) {
            return {
                tier: 'GOAL_PURSUIT',
                intention: winner,
                goal: winner.goal_id ? activeGoals.find(g => String(g.id) === String(winner.goal_id) || String(g.lws_id) === String(winner.goal_id)) : null,
            };
        }
    }

    // Tier 4: Travel
    if (runtimeState.travel?.status === 'in_transit') {
        return { tier: 'TRAVEL', travel: runtimeState.travel };
    }

    // Tier 5: Routine
    if (routineBlock !== null) {
        return { tier: 'ROUTINE', block: routineBlock };
    }

    // Tier 6: Idle
    return { tier: 'IDLE' };
}

/**
 * Calculates planned departure fictional time for a routine block.
 * T_dep = addSeconds(T_start, -travel_duration_seconds)
 *
 * @param {string} TStart ISO 8601 fictional time
 * @param {number} distanceHops Topological distance
 * @param {number} [baseEdgeDistanceMeters] World constant (default 500m)
 * @param {number} [travelSpeedMps] Character speed (default 1.4 m/s)
 * @returns {string} ISO 8601 fictional time
 */
export function calculatePlannedDeparture(TStart, distanceHops, baseEdgeDistanceMeters = 500, travelSpeedMps = 1.4) {
    const travelDurationSeconds = Math.round((distanceHops * baseEdgeDistanceMeters) / travelSpeedMps);
    const date = new Date(TStart);
    date.setUTCSeconds(date.getUTCSeconds() - travelDurationSeconds);
    return date.toISOString().replace('.000Z', 'Z');
}

