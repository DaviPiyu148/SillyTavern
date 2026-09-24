import { LwsValidationError } from '../errors.js';
import { safeJsonParse } from '../authored/common.js';

export const SEVERE_PHYSICAL_CONDITIONS = Object.freeze(new Set([
    'unconscious',
    'comatose',
    'critically_injured',
    'incapacitated',
    'paralyzed',
    'dying',
    'dead',
]));

export const VALID_DAYS_OF_WEEK = Object.freeze([
    'daily',
    'weekday',
    'weekend',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
]);

export const VALID_FLEXIBILITY = Object.freeze(['strict', 'flexible', 'optional']);

const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const BLOCK_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Checks whether a character currently has a severe physical condition.
 *
 * @param {object} character
 * @returns {boolean}
 */
export function isSeverePhysicalCondition(character) {
    if (!character) return false;

    const conditionStr = String(character.physical_condition || '').toLowerCase().trim();
    if (SEVERE_PHYSICAL_CONDITIONS.has(conditionStr)) {
        return true;
    }

    const runtimeState = typeof character.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character.runtime_state || {});

    if (runtimeState.condition?.severity === 'severe' || runtimeState.condition?.severity === 'critical') {
        return true;
    }

    return false;
}

/**
 * Computes day specificity score for tie-breaking:
 * - Specific day (monday..sunday): 3
 * - Category (weekday, weekend): 2
 * - Generic (daily): 1
 *
 * @param {string} dayOfWeek
 * @returns {number}
 */
export function getDaySpecificity(dayOfWeek) {
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(dayOfWeek)) {
        return 3;
    }
    if (dayOfWeek === 'weekday' || dayOfWeek === 'weekend') {
        return 2;
    }
    return 1;
}

/**
 * Validates a single routine definition payload.
 *
 * @param {object} routine
 * @param {number} [index]
 * @returns {object} Normalized routine
 */
export function validateRoutineBlock(routine, index = 0) {
    const prefix = `routines[${index}]`;

    if (!routine || typeof routine !== 'object') {
        throw new LwsValidationError(`${prefix} must be an object`, [prefix]);
    }

    if (typeof routine.block_id !== 'string' || !BLOCK_ID_REGEX.test(routine.block_id.trim())) {
        throw new LwsValidationError(
            `${prefix}.block_id must be alphanumeric with underscores/hyphens (1-64 chars)`,
            [`${prefix}.block_id`],
        );
    }
    const blockId = routine.block_id.trim();

    if (!VALID_DAYS_OF_WEEK.includes(routine.day_of_week)) {
        throw new LwsValidationError(
            `${prefix}.day_of_week must be one of: ${VALID_DAYS_OF_WEEK.join(', ')}`,
            [`${prefix}.day_of_week`],
        );
    }
    const dayOfWeek = routine.day_of_week;

    if (typeof routine.start_time !== 'string' || !TIME_REGEX.test(routine.start_time.trim())) {
        throw new LwsValidationError(
            `${prefix}.start_time must be in HH:MM:SS format (00:00:00 to 23:59:59)`,
            [`${prefix}.start_time`],
        );
    }
    const startTime = routine.start_time.trim();

    if (typeof routine.end_time !== 'string' || !TIME_REGEX.test(routine.end_time.trim())) {
        throw new LwsValidationError(
            `${prefix}.end_time must be in HH:MM:SS format (00:00:00 to 23:59:59)`,
            [`${prefix}.end_time`],
        );
    }
    const endTime = routine.end_time.trim();

    if (startTime === endTime) {
        throw new LwsValidationError(
            `${prefix} has empty interval: start_time and end_time cannot be equal (${startTime})`,
            [`${prefix}.end_time`],
        );
    }

    if (typeof routine.activity !== 'string' || !routine.activity.trim() || routine.activity.trim().length > 100) {
        throw new LwsValidationError(
            `${prefix}.activity must be a non-empty string up to 100 chars`,
            [`${prefix}.activity`],
        );
    }
    const activity = routine.activity.trim();

    let priority = 50;
    if (routine.priority !== undefined) {
        const p = Number(routine.priority);
        if (!Number.isInteger(p) || p < 1 || p > 100) {
            throw new LwsValidationError(
                `${prefix}.priority must be an integer between 1 and 100`,
                [`${prefix}.priority`],
            );
        }
        priority = p;
    }

    let flexibility = 'flexible';
    if (routine.flexibility !== undefined) {
        if (!VALID_FLEXIBILITY.includes(routine.flexibility)) {
            throw new LwsValidationError(
                `${prefix}.flexibility must be one of: ${VALID_FLEXIBILITY.join(', ')}`,
                [`${prefix}.flexibility`],
            );
        }
        flexibility = routine.flexibility;
    }

    let enabled = 1;
    if (routine.enabled !== undefined) {
        enabled = (routine.enabled === 1 || routine.enabled === true) ? 1 : 0;
    }

    return {
        lws_id: routine.lws_id || null,
        block_id: blockId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        activity,
        target_location_id: routine.target_location_id || null,
        priority,
        flexibility,
        enabled,
    };
}

/**
 * Checks whether a routine block matches the given ISO fictional timestamp.
 * Supports same-day intervals and overnight intervals crossing midnight.
 *
 * @param {object} routine
 * @param {string} fictionalTimestamp
 * @returns {boolean}
 */
export function matchesRoutineTime(routine, fictionalTimestamp) {
    if (routine.enabled === 0 || routine.enabled === false) return false;

    const date = new Date(fictionalTimestamp);
    if (isNaN(date.getTime())) return false;

    const dayIndex = date.getUTCDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[dayIndex];
    const isWeekday = dayIndex >= 1 && dayIndex <= 5;
    const isWeekend = dayIndex === 0 || dayIndex === 6;

    const timeStr = fictionalTimestamp.slice(11, 19);
    const { start_time, end_time, day_of_week } = routine;

    const matchesDayCategory = (cat, day, weekday, weekend) => {
        if (cat === 'daily') return true;
        if (cat === 'weekday') return weekday;
        if (cat === 'weekend') return weekend;
        return cat === day;
    };

    // Case 1: Same-day interval (start_time < end_time)
    if (start_time < end_time) {
        if (matchesDayCategory(day_of_week, currentDay, isWeekday, isWeekend)) {
            return timeStr >= start_time && timeStr < end_time;
        }
        return false;
    }

    // Case 2: Overnight interval (start_time > end_time)
    // Subcase 2a: Started today, runs until midnight
    if (matchesDayCategory(day_of_week, currentDay, isWeekday, isWeekend)) {
        if (timeStr >= start_time) return true;
    }

    // Subcase 2b: Started yesterday, continues into today before end_time
    const yesterdayIndex = (dayIndex + 6) % 7;
    const yesterdayDay = dayNames[yesterdayIndex];
    const wasYesterdayWeekday = yesterdayIndex >= 1 && yesterdayIndex <= 5;
    const wasYesterdayWeekend = yesterdayIndex === 0 || yesterdayIndex === 6;

    if (matchesDayCategory(day_of_week, yesterdayDay, wasYesterdayWeekday, wasYesterdayWeekend)) {
        if (timeStr < end_time) return true;
    }

    return false;
}

/**
 * Evaluates all routines for a character and returns the winning routine at the timestamp,
 * applying the deterministic tie-breaking rules:
 * 1. Priority desc
 * 2. Day specificity desc
 * 3. block_id asc
 *
 * @param {Array<object>} routines
 * @param {string} fictionalTimestamp
 * @returns {object|null} Winning routine or null
 */
export function getRoutineAtTime(routines, fictionalTimestamp) {
    if (!Array.isArray(routines) || routines.length === 0) return null;

    const matching = routines.filter(r => matchesRoutineTime(r, fictionalTimestamp));
    if (matching.length === 0) return null;

    matching.sort((a, b) => {
        if (b.priority !== a.priority) {
            return b.priority - a.priority;
        }
        const specA = getDaySpecificity(a.day_of_week);
        const specB = getDaySpecificity(b.day_of_week);
        if (specB !== specA) {
            return specB - specA;
        }
        return a.block_id.localeCompare(b.block_id);
    });

    return matching[0];
}

/**
 * Six-tier activity arbitration hierarchy for a character at a fictional timestamp:
 * Tier 1: DIRECTOR_OVERRIDE
 * Tier 2: INTERRUPTED (severe physical condition)
 * Tier 3: GOAL_PURSUIT (reserved for Phase 7)
 * Tier 4: TRAVEL (active travel in transit)
 * Tier 5: ROUTINE (matching routine block)
 * Tier 6: IDLE (fallback)
 *
 * @param {object} character
 * @param {Array<object>} routines
 * @param {string} fictionalTimestamp
 * @returns {{ tier: string, activity: string, routine?: object, reason: string }}
 */
export function arbitrateCharacterActivity(character, routines, fictionalTimestamp) {
    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    // Tier 1: DIRECTOR_OVERRIDE
    if (runtimeState.director_override?.active) {
        return {
            tier: 'DIRECTOR_OVERRIDE',
            activity: runtimeState.director_override.activity || character.activity || 'idle',
            reason: 'director_override',
        };
    }

    // Tier 2: INTERRUPTED
    if (isSeverePhysicalCondition(character)) {
        return {
            tier: 'INTERRUPTED',
            activity: character.physical_condition || 'incapacitated',
            reason: 'severe_physical_condition',
        };
    }

    // Tier 3: GOAL_PURSUIT - Reserved for Phase 7

    // Tier 4: TRAVEL
    if (runtimeState.travel?.status === 'in_transit') {
        return {
            tier: 'TRAVEL',
            activity: 'travelling',
            travel: runtimeState.travel,
            reason: 'travel_in_transit',
        };
    }

    // Tier 5: ROUTINE
    const activeRoutine = getRoutineAtTime(routines, fictionalTimestamp);
    if (activeRoutine) {
        return {
            tier: 'ROUTINE',
            activity: activeRoutine.activity,
            routine: activeRoutine,
            target_location_id: activeRoutine.target_location_id,
            reason: 'routine_match',
        };
    }

    // Tier 6: IDLE
    return {
        tier: 'IDLE',
        activity: 'idle',
        reason: 'no_matching_routine',
    };
}
