import { generateDeterministicUuid, getProposalTarget } from './common.js';
import { safeJsonParse } from '../simulations/common.js';
import { LwsValidationError, LwsNotFoundError, LwsConflictError } from '../errors.js';

export const NEED_NAMES = Object.freeze([
    'energy',
    'nourishment',
    'social',
    'safety',
    'morale',
]);

/**
 * 5.2 Complete Need Relevance Matrix (5 x 14 = 70 cells)
 * All cells not explicitly defined are strictly 0.00.
 */
export const NEED_RELEVANCE_MATRIX = Object.freeze({
    REST: { energy: 1.00, nourishment: 0.00, social: 0.00, safety: 0.00, morale: 0.20 },
    CONSUME_ITEM: { energy: 0.30, nourishment: 1.00, social: 0.00, safety: 0.00, morale: 0.20 },
    COMMUNICATE: { energy: 0.00, nourishment: 0.00, social: 0.80, safety: 0.00, morale: 0.40 },
    EMOTE: { energy: 0.00, nourishment: 0.00, social: 0.30, safety: 0.00, morale: 0.20 },
    TRANSFER_ITEM: { energy: 0.00, nourishment: 0.00, social: 0.40, safety: 0.00, morale: 0.30 },
    OBSERVE: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.20, morale: 0.10 },
    INTERACT_OBJECT: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.10, morale: 0.20 },
    WORK: { energy: 0.00, nourishment: 0.00, social: 0.10, safety: 0.00, morale: 0.20 },
    GENERAL_ACTION: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.00, morale: 0.10 },
    UPDATE_CHARACTER_ACTIVITY: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.00, morale: 0.00 },
    UPDATE_PHYSICAL_CONDITION: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.00, morale: 0.00 },
    UPDATE_RUNTIME_STATE: { energy: 0.00, nourishment: 0.00, social: 0.00, safety: 0.00, morale: 0.00 },
});

/**
 * Computes the relevance of an action to a specific need.
 * Handles contextual variations for MOVE_CHARACTER and COMBAT_ACTION.
 *
 * @param {string} needName
 * @param {object} proposal
 * @param {object} [context]
 * @returns {number} Value in [0.00, 1.00]
 */
export function getNeedRelevance(needName, proposal, context = {}) {
    const actionType = proposal.action_type || proposal.event_type;
    const payload = proposal.payload || {};

    if (actionType === 'MOVE_CHARACTER') {
        const isDestinationSafe = Boolean(context.isDestinationSafe ?? payload.is_destination_safe ?? false);
        const inCombat = Boolean(context.inCombat ?? payload.in_combat ?? false);

        if (isDestinationSafe && !inCombat) {
            if (needName === 'safety') return 0.90;
            if (needName === 'morale') return 0.10;
            return 0.00;
        }
        return 0.00;
    }

    if (actionType === 'COMBAT_ACTION') {
        const isSelfDefense = Boolean(payload.is_self_defense);
        if (isSelfDefense) {
            if (needName === 'safety') return 0.80;
            return 0.00;
        }
        return 0.00;
    }

    const mapping = NEED_RELEVANCE_MATRIX[actionType];
    if (mapping && typeof mapping[needName] === 'number') {
        return mapping[needName];
    }

    return 0.00;
}

/**
 * Checks if a character has a severe physical condition.
 *
 * @param {object} character
 * @returns {boolean}
 */
export function isSeverePhysicalCondition(character) {
    const cond = character?.physical_condition;
    return cond === 'exhausted' || cond === 'starving' || cond === 'incapacitated';
}

/**
 * Derives the interrupted activity when physical condition is severe.
 *
 * @param {object} character
 * @returns {string}
 */
export function deriveInterruptedActivity(character) {
    const cond = character?.physical_condition;
    if (cond === 'starving') return 'seeking_sustenance';
    if (cond === 'exhausted') return 'collapsing_to_rest';
    if (cond === 'incapacitated') return 'incapacitated';
    return 'resting';
}

/**
 * Initializes the 5 standard needs for a character in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number} simCharId
 * @param {string} simLwsId
 * @param {string} charLwsId
 * @param {string} fictionalTime
 * @param {string} createdAt
 */
export function initCharacterNeeds(db, simId, simCharId, simLwsId, charLwsId, fictionalTime, createdAt) {
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO lws_character_needs (
            lws_id, simulation_id, simulation_character_id, need_name,
            satisfaction, decay_rate, last_evaluated_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 100, 100, ?, ?, ?)
    `);

    for (const needName of NEED_NAMES) {
        const needLwsId = generateDeterministicUuid('need', simLwsId, charLwsId, needName);
        insertStmt.run(needLwsId, simId, simCharId, needName, fictionalTime, createdAt, createdAt);
    }
}

/**
 * Retrieves all 5 needs for a character from SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @returns {object[]}
 */
export function getCharacterNeeds(db, simCharId) {
    let charId = simCharId;
    if (typeof simCharId === 'string') {
        const c = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simCharId);
        if (!c) return [];
        charId = c.id;
    }
    return db.prepare(`
        SELECT * FROM lws_character_needs
        WHERE simulation_character_id = ?
        ORDER BY CASE need_name
            WHEN 'energy' THEN 1
            WHEN 'nourishment' THEN 2
            WHEN 'social' THEN 3
            WHEN 'safety' THEN 4
            WHEN 'morale' THEN 5
            ELSE 6
        END
    `).all(charId);
}


/**
 * Calculates effective decay rates and updates needs satisfaction across a time interval.
 * Pure mathematical helper used by both live simulation and replay.
 *
 * @param {object} currentNeeds Map of needName -> { satisfaction, decay_rate, last_evaluated_time }
 * @param {object} character Character state
 * @param {string} targetFictionalTime Target fictional time (ISO 8601)
 * @param {object} [context] Location tags, collocated characters, combat status
 * @returns {{ updatedNeeds: object, physicalConditionChange: string | null }}
 */
export function calculateNeedsDecay(currentNeeds, characterOrTargetTime, targetTimeOrContext, optionalContext = {}) {
    let character = {};
    let targetFictionalTime;
    let context = {};

    if (typeof characterOrTargetTime === 'string') {
        targetFictionalTime = characterOrTargetTime;
        context = targetTimeOrContext || {};
    } else {
        character = characterOrTargetTime || {};
        targetFictionalTime = targetTimeOrContext;
        context = optionalContext || {};
    }

    const updatedNeeds = {};
    const targetMs = new Date(targetFictionalTime).getTime();

    // 1. Calculate non-morale needs
    const nonMoraleNames = ['energy', 'nourishment', 'social', 'safety'];
    const postSegmentSatisfaction = {};

    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    const activity = character?.activity || 'idle';
    const isInTransit = runtimeState.travel?.status === 'in_transit';
    const collocatedCount = context.collocatedCount ?? 0;
    const locationTags = context.locationTags || [];
    const inCombat = runtimeState.combat?.in_combat === true || context.inCombat === true;

    for (const needName of nonMoraleNames) {
        const need = currentNeeds[needName] || { satisfaction: 100, decay_rate: 100, last_evaluated_time: targetFictionalTime };
        const lastMs = new Date(need.last_evaluated_time).getTime();
        const deltaSeconds = Math.max(0, Math.floor((targetMs - lastMs) / 1000));

        let rEff = 0;
        if (needName === 'energy') {
            const isResting = context.isResting === true || activity === 'sleeping' || activity === 'resting';
            if (isResting) {
                rEff = 15;
            } else if (activity === 'working' || isInTransit) {
                rEff = -8;
            } else {
                rEff = -3;
            }
        } else if (needName === 'nourishment') {
            rEff = -4;
        } else if (needName === 'social') {
            if (collocatedCount >= 1) {
                rEff = -1; // -1 pts/hr base + 0 modifier = -1 pts/hr
            } else {
                rEff = -2; // -1 pts/hr base + (-1) alone modifier = -2 pts/hr
            }
        } else if (needName === 'safety') {
            if (inCombat || locationTags.includes('hostile')) {
                rEff = -10;
            } else if (locationTags.includes('safe') && !inCombat) {
                rEff = 5;
            } else {
                rEff = 0;
            }
        }

        const deltaS = Math.round(rEff * (need.decay_rate / 100) * (deltaSeconds / 3600));
        const newSatisfaction = Math.max(0, Math.min(100, need.satisfaction + deltaS));

        postSegmentSatisfaction[needName] = newSatisfaction;
        updatedNeeds[needName] = {
            ...need,
            satisfaction: newSatisfaction,
            last_evaluated_time: targetFictionalTime,
        };
    }

    // 2. Post-segment Morale Sequencing (§5.3)
    const minNonMorale = Math.min(
        postSegmentSatisfaction.energy,
        postSegmentSatisfaction.nourishment,
        postSegmentSatisfaction.social,
        postSegmentSatisfaction.safety,
    );

    let rMorale = 0;
    if (minNonMorale <= 20) {
        rMorale = -1;
    } else if (minNonMorale > 60) {
        rMorale = 1;
    } else {
        rMorale = 0;
    }

    const moraleNeed = currentNeeds.morale || { satisfaction: 100, decay_rate: 100, last_evaluated_time: targetFictionalTime };
    const moraleLastMs = new Date(moraleNeed.last_evaluated_time).getTime();
    const moraleDeltaSeconds = Math.max(0, Math.floor((targetMs - moraleLastMs) / 1000));
    const deltaMorale = Math.round(rMorale * (moraleNeed.decay_rate / 100) * (moraleDeltaSeconds / 3600));
    const newMorale = Math.max(0, Math.min(100, moraleNeed.satisfaction + deltaMorale));

    updatedNeeds.morale = {
        ...moraleNeed,
        satisfaction: newMorale,
        last_evaluated_time: targetFictionalTime,
    };

    // 3. Physical condition mapping (§5.4)
    let physicalConditionChange = null;
    const energy = postSegmentSatisfaction.energy;
    const nourishment = postSegmentSatisfaction.nourishment;

    if (energy === 0 && nourishment === 0) {
        physicalConditionChange = 'starving';
    } else if (nourishment === 0) {
        physicalConditionChange = 'starving';
    } else if (energy === 0) {
        physicalConditionChange = 'exhausted';
    } else if (energy >= 20 && nourishment >= 20 && (character?.physical_condition === 'exhausted' || character?.physical_condition === 'starving')) {
        physicalConditionChange = 'normal';
    }

    return { updatedNeeds, physicalConditionChange };
}

/**
 * 9.4 Complete Acute-Need Lifecycle (10 Steps)
 * Evaluates satisfaction against threshold <= 20 and creates/updates acute goals.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} sim Simulation row or ID
 * @param {any} character Simulation character row or ID
 * @param {object[] | string} needsOrCurrentTime List of needs rows or currentTime string
 * @param {string} [maybeCurrentTime] Current fictional time (if needs passed as 4th arg)
 * @param {string} [causalEventLwsId] Optional causal event ID
 * @param {string} [createdAt] Timestamp
 * @returns {object | null} Created, updated, or completed acute goal info
 */
export function evaluateAcuteNeeds(db, sim, character, needsOrCurrentTime, maybeCurrentTime, causalEventLwsId = null, createdAt = new Date().toISOString()) {
    let simRow = sim;
    if (typeof sim === 'string') {
        simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim);
    } else if (typeof sim === 'number') {
        simRow = db.prepare('SELECT * FROM lws_simulations WHERE id = ?').get(sim);
    }

    let charRow = character;
    if (typeof character === 'string') {
        charRow = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(character);
    } else if (typeof character === 'number') {
        charRow = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = ?').get(character);
    }

    let needs;
    let currentTime;
    let causalId = causalEventLwsId;
    let created = createdAt;

    if (Array.isArray(needsOrCurrentTime)) {
        needs = needsOrCurrentTime;
        currentTime = maybeCurrentTime;
    } else {
        needs = getCharacterNeeds(db, charRow.id);
        currentTime = needsOrCurrentTime;
        causalId = maybeCurrentTime || null;
    }

    const acuteCandidates = needs.filter(n => n.satisfaction <= 20);

    // If no needs are <= 20, check if an existing acute goal needs to be completed
    if (acuteCandidates.length === 0) {
        const existingAcuteGoal = db.prepare(`
            SELECT * FROM lws_character_goals
            WHERE simulation_character_id = ? AND goal_type = 'acute_need' AND status = 'active' AND deleted_at IS NULL
        `).get(charRow.id);

        if (existingAcuteGoal) {
            // Complete acute goal (Step 10)
            db.prepare(`
                UPDATE lws_character_goals
                SET status = 'completed', progress = 100, updated_at = ?
                WHERE id = ?
            `).run(createdAt, existingAcuteGoal.id);

            // Complete child intentions
            db.prepare(`
                UPDATE lws_character_intentions
                SET status = 'completed', updated_at = ?
                WHERE goal_id = ? AND status IN ('active', 'executing')
            `).run(createdAt, existingAcuteGoal.id);

            return { action: 'completed', goal_id: existingAcuteGoal.lws_id };
        }
        return null;
    }

    // Tie-breaker priority order (Step 4): safety > nourishment > energy > morale > social
    const tieBreakRank = { safety: 1, nourishment: 2, energy: 3, morale: 4, social: 5 };

    acuteCandidates.sort((a, b) => {
        if (a.satisfaction !== b.satisfaction) {
            return a.satisfaction - b.satisfaction; // Lowest satisfaction first
        }
        return (tieBreakRank[a.need_name] ?? 99) - (tieBreakRank[b.need_name] ?? 99);
    });

    const winningNeed = acuteCandidates[0];
    const newPriority = 80 + Math.round(20 - winningNeed.satisfaction);

    const existingAcuteGoal = db.prepare(`
        SELECT * FROM lws_character_goals
        WHERE simulation_character_id = ? AND goal_type = 'acute_need' AND status = 'active' AND deleted_at IS NULL
    `).get(charRow.id);

    // Map winning need to objective action & title
    const goalConfig = {
        energy: { action: 'REST', title: 'Rest to recover energy' },
        nourishment: { action: 'CONSUME_ITEM', title: 'Find and consume sustenance' },
        safety: { action: 'MOVE_CHARACTER', title: 'Seek shelter and safety' },
        social: { action: 'COMMUNICATE', title: 'Seek social interaction' },
        morale: { action: 'COMMUNICATE', title: 'Engage with others to lift morale' },
    }[winningNeed.need_name] || { action: 'REST', title: 'Address acute need' };

    if (existingAcuteGoal) {
        // If the existing acute goal is for the same need/action, refresh priority (Step 6)
        if (existingAcuteGoal.objective_action_type === goalConfig.action) {
            db.prepare(`
                UPDATE lws_character_goals
                SET priority = ?, urgency = 100, updated_at = ?
                WHERE id = ?
            `).run(newPriority, created, existingAcuteGoal.id);

            return { action: 'refreshed', goal_id: existingAcuteGoal.lws_id, priority: newPriority };
        }

        // Supersession (Step 7): abandon old acute goal and cancel its intentions
        db.prepare(`
            UPDATE lws_character_goals
            SET status = 'abandoned', updated_at = ?
            WHERE id = ?
        `).run(created, existingAcuteGoal.id);

        db.prepare(`
            UPDATE lws_character_intentions
            SET status = 'cancelled', cancellation_reason = 'preempted_by_higher_priority', updated_at = ?
            WHERE goal_id = ? AND status IN ('active', 'executing')
        `).run(created, existingAcuteGoal.id);
    }

    // Step 8: Create new acute goal
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM lws_character_goals WHERE simulation_character_id = ?').get(charRow.id);
    const goalIndex = (countRow?.cnt || 0) + 1;

    let causalEventInternalId = null;
    if (causalId) {
        const evRow = db.prepare('SELECT id FROM lws_events WHERE lws_id = ? AND simulation_id = ?').get(causalId, simRow.id);
        if (evRow) causalEventInternalId = evRow.id;
    }

    const goalLwsId = generateDeterministicUuid('goal', simRow.lws_id, charRow.lws_id, causalId || 'authored', String(goalIndex));

    db.prepare(`
        INSERT INTO lws_character_goals (
            lws_id, simulation_id, simulation_character_id, client_goal_key,
            title, description, goal_type, status, priority, urgency, progress,
            objective_action_type, causal_event_id, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, '', 'acute_need', 'active', ?, 100, 0, ?, ?, ?, ?)
    `).run(
        goalLwsId,
        simRow.id,
        charRow.id,
        goalConfig.title,
        newPriority,
        goalConfig.action,
        causalEventInternalId,
        created,
        created,
    );

    return { action: 'created', goal_id: goalLwsId, priority: newPriority };
}

export const evaluateAcuteNeedLifecycle = evaluateAcuteNeeds;

