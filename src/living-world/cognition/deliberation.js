import {
    getProposalTarget,
    calculateGoalAlignment,
    getActionClass,
    computeTieBreakHash,
    isInCombat,
    isUnderAttack,
    isFleeing,
    PROPOSABLE_ACTION_TYPES_14,
    generateDeterministicUuid,
} from './common.js';
import { getNeedRelevance } from './needs.js';
import { getEmotionAffinity } from './emotions.js';
import { calculateValueScore, hasMoralVeto } from './values.js';
import { createCharacterIntention, updateCharacterIntentionStatus, allocateAttemptIndex } from './intentions.js';
import { getDb } from '../db.js';
import { LwsValidationError, LwsAuthorityError, LwsNotFoundError } from '../errors.js';
import { safeJsonParse, ensureActiveSimulation, isoNow } from '../simulations/common.js';
import { evaluateAuthority } from '../events/authority.js';
import { internalCommitEvent } from '../events/events.js';

/**
 * Computes topological distance D(L_actor, L_dest) in the world location hierarchy.
 * D = depth(L_actor) + depth(L_dest) - 2 * depth(LCA(L_actor, L_dest))
 *
 * @param {string | number | null} actorLocId
 * @param {string | number | null} destLocId
 * @param {Map<number | string, object> | object} locationsById
 * @returns {number}
 */
export function calculateLocationDistance(actorLocId, destLocId, locationsById) {
    if (!actorLocId || !destLocId || String(actorLocId) === String(destLocId)) {
        return 0;
    }

    const getLoc = (id) => {
        if (!id) return null;
        if (locationsById instanceof Map) return locationsById.get(id) || locationsById.get(Number(id)) || null;
        return locationsById[id] || locationsById[Number(id)] || null;
    };

    const getAncestry = (startId) => {
        const path = [];
        let curr = getLoc(startId);
        const visited = new Set();
        while (curr && !visited.has(curr.id)) {
            visited.add(curr.id);
            path.push(curr);
            curr = curr.parent_location_id ? getLoc(curr.parent_location_id) : null;
        }
        return path;
    };

    const pathA = getAncestry(actorLocId);
    const pathB = getAncestry(destLocId);

    if (pathA.length === 0 || pathB.length === 0) {
        return 1; // Default hop if locations not fully resolved
    }

    const depthA = pathA.length - 1;
    const depthB = pathB.length - 1;

    // Find LCA
    const setA = new Set(pathA.map(l => l.id));
    let lcaDepth = 0;
    for (let i = 0; i < pathB.length; i++) {
        if (setA.has(pathB[i].id)) {
            lcaDepth = pathB.length - 1 - i;
            break;
        }
    }

    return depthA + depthB - 2 * lcaDepth;
}

/**
 * Calculates ResourceDeficit penalty in {0, 40} (§8.2).
 *
 * @param {object} proposal
 * @param {object} character
 * @param {object} [location]
 * @returns {number} 0 or 40
 */
export function calculateResourceDeficit(proposal, character, location = {}) {
    const actionType = proposal.action_type || proposal.event_type;
    const payload = proposal.payload || {};

    if (actionType !== 'CONSUME_ITEM' && actionType !== 'TRANSFER_ITEM' && actionType !== 'INTERACT_OBJECT') {
        return 0;
    }

    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    const requiredQty = payload.quantity !== undefined ? Math.max(1, Math.round(payload.quantity)) : 1;

    if (actionType === 'CONSUME_ITEM' || actionType === 'TRANSFER_ITEM') {
        const itemId = payload.item_id ?? payload.object_id ?? proposal.target_entity_id;
        if (!itemId) return 40;

        const inventory = Array.isArray(runtimeState.inventory) ? runtimeState.inventory : [];
        const item = inventory.find(i => String(i.id) === String(itemId));
        if (!item || (item.quantity ?? 1) < requiredQty) {
            return 40;
        }
        return 0;
    }

    if (actionType === 'INTERACT_OBJECT') {
        const objectId = payload.object_id ?? payload.target_object_id ?? proposal.target_entity_id;
        if (!objectId) return 40;

        const locRuntime = typeof location?.runtime_state === 'string'
            ? safeJsonParse(location.runtime_state, {})
            : (location?.runtime_state || {});

        const objects = Array.isArray(locRuntime.objects) ? locRuntime.objects : [];
        const obj = objects.find(o => String(o.id) === String(objectId));
        if (!obj || obj.interactable === false) {
            return 40;
        }
        return 0;
    }

    return 0;
}

/**
 * Calculates TravelTimeCost penalty in [0, 50] (§8.3).
 *
 * @param {object} proposal
 * @param {object} character
 * @param {Map<string | number, object> | object} locationsById
 * @returns {number}
 */
export function calculateTravelTimeCost(proposal, character = {}, locationsById = {}) {
    const actionType = proposal.action_type || proposal.event_type;
    if (actionType !== 'MOVE_CHARACTER') {
        return 0;
    }

    if (typeof proposal.payload?.distance === 'number') {
        return Math.min(50, Math.round(10 * proposal.payload.distance));
    }

    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    if (runtimeState.travel?.status === 'in_transit') {
        return 0;
    }

    const target = getProposalTarget(proposal);
    const targetLocId = target.type === 'location' ? target.id : null;
    const currentLocId = character.current_location_id || character.location_id || null;

    if (!targetLocId || String(targetLocId) === String(currentLocId)) {
        return 0;
    }

    const dist = calculateLocationDistance(currentLocId, targetLocId, locationsById);
    return Math.min(50, Math.round(10 * dist));
}

/**
 * Calculates ProcrastinationPenalty in [0, 45] (§8.3).
 *
 * @param {object} proposal
 * @param {object} character
 * @param {string} actionClass
 * @param {object | object[]} values
 * @param {object | object[]} needs
 * @returns {number}
 */
export function calculateProcrastinationPenalty(proposal, character, actionClass, values, needs) {
    const actionType = proposal.action_type || proposal.event_type;
    const isHighEffort = actionType === 'WORK' || actionClass === 'AUTONOMOUS_GOAL_PURSUIT';

    if (!isHighEffort) {
        return 0;
    }

    let ambition = 0;
    if (Array.isArray(values)) {
        const v = values.find(val => val.dimension === 'ambition');
        if (v) ambition = v.strength;
    } else if (values && typeof values === 'object') {
        ambition = values.ambition ?? 0;
    }

    let energy = 100;
    if (Array.isArray(needs)) {
        const n = needs.find(nd => nd.need_name === 'energy');
        if (n) energy = n.satisfaction;
    } else if (needs && typeof needs === 'object') {
        energy = needs.energy?.satisfaction ?? needs.energy ?? 100;
    }

    let basePenalty = 0;
    if (ambition < 0) {
        basePenalty = Math.round((Math.abs(ambition) / 100) * 30);
    }

    const fatiguePenalty = energy < 40 ? 15 : 0;
    return basePenalty + fatiguePenalty;
}

/**
 * 8.4 Action Priority Category Partitioning
 * Categories: 4 (Emergency Defense) > 3 (Acute Need Satisfaction) > 2 (Active Goal Milestone) > 1 (Routine / Idle)
 *
 * @param {object} proposal
 * @param {object} character
 * @param {object | object[]} needs
 * @param {object | object[]} goals
 * @param {object} [context]
 * @returns {number} 1, 2, 3, or 4
 */
export function evaluateActionPriorityCategory(proposal, character, needs, goals, context = {}) {
    const actionType = proposal.action_type || proposal.event_type;

    // Category 4: Emergency Defense
    const inCombatOrUnderAttack = isInCombat(character) || isUnderAttack(character) || context.inCombat === true;
    if (inCombatOrUnderAttack) {
        if (actionType === 'COMBAT_ACTION' || (actionType === 'MOVE_CHARACTER' && isFleeing(proposal))) {
            return 4;
        }
    }

    // Category 3: Acute Need Satisfaction
    const needsList = Array.isArray(needs) ? needs : Object.entries(needs || {}).map(([need_name, val]) => ({
        need_name,
        satisfaction: typeof val === 'object' ? val.satisfaction : val,
    }));

    for (const need of needsList) {
        if (need.need_name !== 'morale' && need.satisfaction <= 20) {
            const rel = getNeedRelevance(need.need_name, proposal, context);
            if (rel >= 0.80) {
                return 3;
            }
        }
    }

    // Category 2: Active Goal Milestone
    const activeGoals = (Array.isArray(goals) ? goals : []).filter(g => g.status === 'active' && !g.deleted_at);
    for (const g of activeGoals) {
        if (calculateGoalAlignment(g, proposal) >= 0.70) {
            return 2;
        }
    }

    // Category 1: Routine / Idle
    return 1;
}

/**
 * Calculates the complete utility score and decision details for an action proposal.
 *
 * @param {object} proposal
 * @param {object} character
 * @param {object | object[]} needs
 * @param {object | object[]} goals
 * @param {object | object[]} values
 * @param {object} emotion
 * @param {Map<string | number, object> | object} locationsById
 * @param {object} [context]
 * @returns {object} { score, category, actionClass, details, tieBreakHash }
 */
export function calculateProposalScore(proposal, characterOrState, needsArg, goalsArg, valuesArg, emotionArg, locationsByIdArg = {}, contextArg = {}) {
    let character = characterOrState;
    let needs = needsArg;
    let goals = goalsArg;
    let values = valuesArg;
    let emotion = emotionArg;
    let locationsById = locationsByIdArg;
    let context = contextArg;

    if (characterOrState && (
        characterOrState.needs !== undefined ||
        characterOrState.values !== undefined ||
        characterOrState.relationships !== undefined ||
        characterOrState.emotions !== undefined ||
        characterOrState.goals !== undefined
    )) {
        character = characterOrState.character || { lws_id: 'test-char' };
        needs = characterOrState.needs || [];
        goals = characterOrState.goals || [];
        values = characterOrState.values || [];
        emotion = characterOrState.emotions || characterOrState.emotion || {};
        locationsById = characterOrState.locationsById || {};
        context = { ...characterOrState, ...(characterOrState.context || {}) };
    }

    const actionType = proposal.action_type || proposal.event_type;

    // 1. Context Goal Resolution (§7.3)
    const activeGoals = (Array.isArray(goals) ? goals : []).filter(g => g.status === 'active' && !g.deleted_at);
    let contextGoal = null;
    if (activeGoals.length > 0) {
        const sortedGoals = [...activeGoals].sort((a, b) => {
            const effA = 0.60 * (a.priority ?? 50) + 0.40 * (a.urgency ?? 50);
            const effB = 0.60 * (b.priority ?? 50) + 0.40 * (b.urgency ?? 50);
            if (effA !== effB) return effB - effA;
            return String(a.lws_id || '').localeCompare(String(b.lws_id || ''));
        });
        contextGoal = sortedGoals[0];
    }

    const actionClass = getActionClass(proposal, contextGoal, character);

    // Moral Veto Check (§7.4) and Moral Conflict threshold (>= 75)
    if (proposal.moral_conflict >= 75 || hasMoralVeto(values, actionClass)) {
        const hash = computeTieBreakHash(actionType, getProposalTarget(proposal).id, character.lws_id);
        const reason = proposal.moral_conflict >= 75 ? 'Moral conflict threshold exceeded (>= 75)' : 'MORAL_VETO_HONESTY';
        return {
            score: -100,
            total_score: -100,
            category: 1,
            actionClass,
            vetoed: true,
            vetoReason: reason,
            veto_reason: reason,
            tieBreakHash: hash,
            utility_breakdown: {
                u_need: 0,
                u_goal: 0,
                u_social: 0,
                a_value: -100,
                b_emotion: 0,
                penalty: 0,
                uNeed: 0,
                uGoal: 0,
                uSocial: 0,
                aValue: -100,
                bEmotion: 0,
            },
            details: { uNeed: 0, uGoal: 0, uSocial: 0, aValue: -100, bEmotion: 0, penalty: 0 },
        };
    }

    // 2. U_need
    const needsList = Array.isArray(needs) ? needs : Object.entries(needs || {}).map(([need_name, val]) => ({
        need_name,
        satisfaction: typeof val === 'object' ? val.satisfaction : val,
    }));

    let maxNeedRelevance = 0;
    for (const need of needsList) {
        const deficit = Math.max(0, 100 - (need.satisfaction ?? 100));
        const relevance = getNeedRelevance(need.need_name, proposal, context);
        const term = deficit * relevance;
        if (term > maxNeedRelevance) {
            maxNeedRelevance = term;
        }
    }

    if (proposal.expected_need_satisfactions && typeof proposal.expected_need_satisfactions === 'object') {
        for (const [_, satDelta] of Object.entries(proposal.expected_need_satisfactions)) {
            const satVal = typeof satDelta === 'number' ? satDelta : 0;
            if (satVal > maxNeedRelevance) {
                maxNeedRelevance = satVal;
            }
        }
    }

    const uNeed = maxNeedRelevance;

    // 3. U_goal
    let maxGoalAlignment = 0;
    for (const g of activeGoals) {
        const effP = 0.60 * (g.priority ?? 50) + 0.40 * (g.urgency ?? 50);
        const align = calculateGoalAlignment(g, proposal);
        const term = effP * align;
        if (term > maxGoalAlignment) {
            maxGoalAlignment = term;
        }
    }
    const uGoal = maxGoalAlignment;

    // 4. A_value
    const aValue = calculateValueScore(values, actionClass);

    // 5. B_emotion
    const dominantEmotion = emotion?.dominant_emotion || 'neutral';
    const arousal = emotion?.arousal ?? 50;
    const affinity = getEmotionAffinity(dominantEmotion, actionClass);
    const bEmotion = (arousal / 100) * affinity * 100;

    // 6. Penalties
    const currentLoc = locationsById instanceof Map
        ? (locationsById.get(character.current_location_id) || {})
        : (locationsById[character.current_location_id] || {});

    const resourceDeficit = calculateResourceDeficit(proposal, character, currentLoc);
    const travelTimeCost = calculateTravelTimeCost(proposal, character, locationsById);
    const procrastinationPenalty = calculateProcrastinationPenalty(proposal, character, actionClass, values, needs);
    const penalty = resourceDeficit + travelTimeCost + procrastinationPenalty;

    // 7. Social Utility U_social (Phase 8)
    const target = getProposalTarget(proposal);
    let uSocial = 0;
    if (target.type === 'character' && target.id) {
        let rel = null;
        if (context.relationships) {
            if (Array.isArray(context.relationships)) {
                rel = context.relationships.find(r => (
                    String(r.target_character_id) === String(target.id) ||
                    String(r.target_character_lws_id) === String(target.id) ||
                    String(r.target_id) === String(target.id)
                ));
            } else if (typeof context.relationships === 'object') {
                rel = context.relationships[target.id] || Object.values(context.relationships).find(r => (
                    String(r.target_character_id) === String(target.id) ||
                    String(r.target_character_lws_id) === String(target.id) ||
                    String(r.target_id) === String(target.id)
                ));
            }
        }
        const trust = rel?.trust ?? 0;
        const affection = rel?.affection ?? 0;
        const respect = rel?.respect ?? 0;
        const loyalty = rel?.loyalty ?? 0;
        const sameFactionBonus = (rel?.sameFaction === true || rel?.same_faction === true) ? 10 : 0;

        const isHostile = actionType === 'COMBAT_ACTION' || actionType === 'MURDER' || actionType === 'ATTACK' || actionClass === 'DECEIVE' || actionClass === 'BETRAY' || actionClass === 'STEAL' || proposal.is_hostile === true;
        const isProSocial = actionType === 'COMMUNICATE' || actionType === 'TALK' || actionType === 'ASSIST' || actionType === 'TRANSFER_ITEM' || actionClass === 'COMMUNICATE_HONEST' || actionClass === 'AID' || actionClass === 'GIFT' || actionClass === 'COOPERATE' || actionClass === 'REST_TOGETHER' || proposal.is_pro_social === true;

        if (isHostile) {
            uSocial = -0.40 * affection - 0.40 * trust - 0.20 * loyalty - sameFactionBonus;
        } else if (isProSocial) {
            uSocial = 0.35 * affection + 0.35 * trust + 0.20 * loyalty + 0.10 * respect + sameFactionBonus;
        }
        uSocial = Math.max(-100, Math.min(100, uSocial));
    }

    // 8. Total Utility & Category
    const uAction = 0.35 * uNeed + 0.30 * uGoal + uSocial + 0.20 * aValue + 0.15 * bEmotion - penalty;
    const uFinal = Math.max(-100, Math.min(100, Math.round(uAction)));
    const category = evaluateActionPriorityCategory(proposal, character, needsList, activeGoals, context);

    const hash = computeTieBreakHash(actionType, target.id, character.lws_id);

    return {
        score: uFinal,
        total_score: uFinal,
        rawScore: uAction,
        category,
        actionClass,
        vetoed: false,
        vetoReason: null,
        veto_reason: null,
        tieBreakHash: hash,
        utility_breakdown: {
            u_need: uNeed,
            u_goal: uGoal,
            u_social: uSocial,
            a_value: aValue,
            b_emotion: bEmotion,
            penalty,
            uNeed,
            uGoal,
            uSocial,
            aValue,
            bEmotion,
        },
        details: {
            uNeed,
            uGoal,
            uSocial,
            aValue,
            bEmotion,
            resourceDeficit,
            travelTimeCost,
            procrastinationPenalty,
            penalty,
        },
    };
}

/**
 * Generates viable baseline candidate proposals for a character given current state and goals.
 *
 * @param {object} character
 * @param {object | object[]} goals
 * @param {object | object[]} needs
 * @param {object} [context]
 * @returns {object[]}
 */
export function generateCandidateProposals(character, goals = [], needs = [], context = {}) {
    const candidates = [];

    // Basic actions
    candidates.push({ action_type: 'REST', payload: {} });
    candidates.push({ action_type: 'WORK', payload: {} });
    candidates.push({ action_type: 'OBSERVE', payload: {} });
    candidates.push({ action_type: 'GENERAL_ACTION', payload: {} });

    // Inventory items for CONSUME_ITEM
    const runtimeState = typeof character?.runtime_state === 'string'
        ? safeJsonParse(character.runtime_state, {})
        : (character?.runtime_state || {});

    const inventory = Array.isArray(runtimeState.inventory) ? runtimeState.inventory : [];
    for (const item of inventory) {
        if (item && item.id) {
            candidates.push({
                action_type: 'CONSUME_ITEM',
                payload: { item_id: item.id, quantity: 1 },
                target_entity_id: item.id,
            });
        }
    }

    // Collocated characters for COMMUNICATE
    const collocatedCharacters = Array.isArray(context.collocatedCharacters) ? context.collocatedCharacters : [];
    for (const otherChar of collocatedCharacters) {
        if (otherChar && otherChar.lws_id && otherChar.lws_id !== character.lws_id) {
            candidates.push({
                action_type: 'COMMUNICATE',
                target_character_id: otherChar.lws_id,
                payload: { intent: 'chat' },
            });
        }
    }

    // Goal-directed proposals
    const activeGoals = (Array.isArray(goals) ? goals : []).filter(g => g.status === 'active' && !g.deleted_at);
    for (const g of activeGoals) {
        if (g.objective_action_type) {
            const prop = {
                action_type: g.objective_action_type,
                payload: { goal_id: g.lws_id },
            };
            if (g.target_location_id) prop.location_id = g.target_location_id;
            if (g.target_character_id) prop.target_character_id = g.target_character_id;
            if (g.target_object_id) prop.payload.object_id = g.target_object_id;
            candidates.push(prop);
        }
    }

    return candidates;
}

/**
 * Runs a deliberation cycle for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} sim Simulation row
 * @param {object} character SimulationCharacter row
 * @param {object} [options] { execute: boolean, candidates: object[], fictionalTime: string }
 * @returns {object}
 */
export function deliberateCharacter(db, sim, character, options = {}) {
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

    if (!simRow) throw new LwsNotFoundError('Simulation not found');
    if (!charRow) throw new LwsNotFoundError('Character not found');

    const execute = Boolean(options.execute ?? options.executeChosenAction ?? options.execute_chosen_action ?? false);

    // If execute mode and simulation is paused -> reject transport level (§14.1, §14.2)
    if (execute && simRow.status === 'paused') {
        throw new LwsValidationError('Simulation is paused; cannot execute deliberate action', ['SIMULATION_IS_PAUSED', 'status']);
    }

    // Load character cognition components
    const needs = db.prepare('SELECT * FROM lws_character_needs WHERE simulation_character_id = ?').all(charRow.id);
    const goals = db.prepare('SELECT * FROM lws_character_goals WHERE simulation_character_id = ? AND deleted_at IS NULL').all(charRow.id);
    const values = db.prepare('SELECT * FROM lws_character_values WHERE simulation_character_id = ?').all(charRow.id);
    const emotion = db.prepare('SELECT * FROM lws_character_emotions WHERE simulation_character_id = ?').get(charRow.id) || {
        dominant_emotion: 'neutral',
        intensity: 0,
        arousal: 50,
        valence: 0,
    };

    const worldLocations = db.prepare('SELECT * FROM lws_locations WHERE world_id = ?').all(simRow.world_id);
    const locationsById = new Map(worldLocations.map(l => [l.id, l]));

    const collocatedChars = db.prepare(`
        SELECT sc.id, sc.lws_id, sc.character_id
        FROM lws_simulation_characters sc
        WHERE sc.simulation_id = ? AND sc.current_location_id = ? AND sc.id != ? AND sc.deleted_at IS NULL
    `).all(simRow.id, charRow.current_location_id, charRow.id);

    const relationships = db.prepare(`
        SELECT r.*, sc2.lws_id AS target_character_lws_id
        FROM lws_character_relationships r
        JOIN lws_simulation_characters sc2 ON r.target_character_id = sc2.id
        WHERE r.simulation_id = ? AND r.source_character_id = ? AND r.deleted_at IS NULL
    `).all(simRow.id, charRow.id);

    const context = {
        collocatedCharacters: collocatedChars,
        collocatedCount: collocatedChars.length,
        inCombat: isInCombat(charRow),
        relationships,
        ...(options.context || {}),
    };

    // Candidates
    const rawCandidates = Array.isArray(options.candidates) && options.candidates.length > 0
        ? options.candidates
        : generateCandidateProposals(charRow, goals, needs, context);

    // Score and evaluate candidates
    const scoredCandidates = [];
    for (const cand of rawCandidates) {
        const res = calculateProposalScore(cand, charRow, needs, goals, values, emotion, locationsById, context);
        scoredCandidates.push({
            proposal: cand,
            ...res,
        });
    }

    const candidateEvaluations = scoredCandidates.map(c => ({
        action_type: c.proposal.action_type || c.proposal.event_type,
        score: c.score,
        category: c.category,
        action_class: c.actionClass,
        vetoed: c.vetoed,
        details: c.details,
    }));

    // Filter out moral vetoed candidates
    const viableCandidates = scoredCandidates.filter(c => !c.vetoed);

    if (viableCandidates.length === 0) {
        return {
            dry_run: !execute,
            chosen_action: null,
            candidate_scores: candidateEvaluations,
            candidate_evaluations: candidateEvaluations,
            scores: scoredCandidates,
            decision_tree: { total: scoredCandidates.length, viable: 0 },
        };
    }

    // Deterministic tie-breaking (§8.5):
    // 1. score DESC
    // 2. category DESC
    // 3. tieBreakHash ASC
    viableCandidates.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.category !== b.category) return b.category - a.category;
        return a.tieBreakHash.localeCompare(b.tieBreakHash);
    });

    const winner = viableCandidates[0];
    const winningProposal = winner.proposal;
    const actionType = winningProposal.action_type || winningProposal.event_type;
    const target = getProposalTarget(winningProposal);

    if (!execute) {
        return {
            dry_run: true,
            chosen_action: {
                action_type: actionType,
                payload: winningProposal.payload || {},
                score: winner.score,
                category: winner.category,
                action_class: winner.actionClass,
                target_entity_type: target.type,
                target_entity_id: target.id,
            },
            candidate_scores: candidateEvaluations,
            candidate_evaluations: candidateEvaluations,
            scores: scoredCandidates,
            decision_tree: {
                total_candidates: scoredCandidates.length,
                viable_candidates: viableCandidates.length,
            },
        };
    }

    // EXECUTE MODE (§12.2)
    const fictionalTime = options.fictionalTime || simRow.current_fictional_time;
    const causalContext = 'deliberate:' + fictionalTime;
    const attemptIndex = allocateAttemptIndex(db, simRow.id, charRow.id, causalContext);

    // Derive parent goal id
    let parentGoalInternalId = null;
    let parentGoalLwsId = null;
    if (winningProposal.payload?.goal_id) {
        const gRow = db.prepare('SELECT id, lws_id FROM lws_character_goals WHERE (lws_id = ? OR id = ?) AND simulation_character_id = ?').get(winningProposal.payload.goal_id, winningProposal.payload.goal_id, charRow.id);
        if (gRow) {
            parentGoalInternalId = gRow.id;
            parentGoalLwsId = gRow.lws_id;
        }
    }

    const intentionLwsId = generateDeterministicUuid('intention', simRow.lws_id, charRow.lws_id, causalContext, String(attemptIndex), actionType);
    const createdAt = isoNow();

    // Insert intention as 'executing'
    db.prepare(`
        INSERT INTO lws_character_intentions (
            lws_id, simulation_id, simulation_character_id, goal_id,
            action_type, target_entity_type, target_entity_id, rationale,
            status, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'executing', ?, ?, ?)
    `).run(
        intentionLwsId,
        simRow.id,
        charRow.id,
        parentGoalInternalId,
        actionType,
        target.type,
        target.id,
        `Deliberated action in category ${winner.category}`,
        winner.category * 20,
        createdAt,
        createdAt,
    );

    let locationLwsId = null;
    if (target.type === 'location') {
        locationLwsId = target.id;
    } else if (winningProposal.location_id) {
        locationLwsId = winningProposal.location_id;
    } else if (charRow.current_location_id) {
        const locRow = db.prepare('SELECT lws_id FROM lws_locations WHERE id = ?').get(charRow.current_location_id);
        if (locRow) locationLwsId = locRow.lws_id;
    }

    const proposalToDispatch = {
        event_type: actionType,
        actor_character_id: charRow.lws_id,
        target_character_id: target.type === 'character' ? target.id : null,
        location_id: locationLwsId,
        fictional_time: fictionalTime,
        payload: {
            ...(winningProposal.payload || {}),
            intention: {
                lws_id: intentionLwsId,
                goal_id: parentGoalLwsId,
                action_type: actionType,
                target_entity_type: target.type,
                target_entity_id: target.id,
                rationale: `Deliberated action in category ${winner.category}`,
                priority: winner.category * 20,
                status: 'completed',
                attempt_index: attemptIndex,
                causal_context: causalContext,
            },
        },
        provenance: 'simulation_engine',
    };

    // Savepoint for authority dispatch
    db.exec('SAVEPOINT deliberate_authority_dispatch');
    try {
        const committedEvent = internalCommitEvent(db, simRow, proposalToDispatch, { isInternalSystem: true });
        db.prepare(`
            UPDATE lws_character_intentions
            SET status = 'completed', updated_at = ?
            WHERE lws_id = ?
        `).run(isoNow(), intentionLwsId);

        db.exec('RELEASE SAVEPOINT deliberate_authority_dispatch');

        return {
            success: true,
            dry_run: false,
            executed: true,
            status: 'completed',
            event: committedEvent,
            intention_id: intentionLwsId,
            intention_lws_id: intentionLwsId,
            chosen_action: {
                action_type: actionType,
                score: winner.score,
                category: winner.category,
            },
            candidate_evaluations: candidateEvaluations,
        };
    } catch (err) {
        db.exec('ROLLBACK TO SAVEPOINT deliberate_authority_dispatch');

        const errCode = err.code || 'AUTHORITY_REJECTED';

        // Option B: Commit authoritative UPDATE_RUNTIME_STATE event with payload.cognition.failed_intention
        const failedIntentionPayload = {
            cognition: {
                failed_intention: {
                    lws_id: intentionLwsId,
                    goal_id: parentGoalLwsId,
                    action_type: actionType,
                    target_entity_type: target.type,
                    target_entity_id: target.id,
                    rationale: `Deliberated action in category ${winner.category}`,
                    priority: winner.category * 20,
                    status: 'failed',
                    failure_reason: errCode,
                    attempt_index: attemptIndex,
                    causal_context: causalContext,
                },
            },
        };

        internalCommitEvent(db, simRow, {
            event_type: 'UPDATE_RUNTIME_STATE',
            actor_character_id: charRow.lws_id,
            fictional_time: fictionalTime,
            payload: failedIntentionPayload,
            provenance: 'simulation_engine',
        }, { isInternalSystem: true });

        db.prepare(`
            UPDATE lws_character_intentions
            SET status = 'failed', failure_reason = ?, updated_at = ?
            WHERE lws_id = ?
        `).run(errCode, isoNow(), intentionLwsId);

        return {
            success: false,
            dry_run: false,
            executed: false,
            status: 'failed',
            error: err.message,
            code: errCode,
            intention_id: intentionLwsId,
            intention_lws_id: intentionLwsId,
            chosen_action: {
                action_type: actionType,
                score: winner.score,
                category: winner.category,
            },
            candidate_evaluations: candidateEvaluations,
        };
    }
}

/**
 * Calculates utility score for a candidate action proposal.
 * Pure testing / evaluation helper.
 *
 * @param {object} proposal
 * @param {object} [options]
 * @returns {object}
 */
export function calculateUtilityScore(proposal, options = {}) {
    const { goals = [], needs = {}, values = {}, emotion = {}, locationsById = {}, context = {}, character = {} } = options;
    const scored = calculateProposalScore(proposal, character, needs, goals, values, emotion, locationsById, context);
    return {
        U: scored.score,
        score: scored.score,
        category: scored.category,
        actionClass: scored.actionClass,
        moralVeto: Boolean(scored.vetoed),
        vetoed: Boolean(scored.vetoed),
        vetoReason: scored.vetoReason,
        penalties: {
            travelTimeCost: calculateTravelTimeCost(proposal, character, locationsById),
            resourceDeficit: calculateResourceDeficit(proposal, character),
            procrastinationPenalty: calculateProcrastinationPenalty(proposal, character, scored.actionClass, values, needs),
        },
        details: scored.details,
    };
}

/**
 * Categorizes an action proposal into priority category (1..4).
 *
 * @param {object} proposal
 * @param {object} [options]
 * @returns {number}
 */
export function categorizeActionProposal(proposal, options = {}) {
    const { character = {}, needs = {}, goals = [], context = {} } = options;
    return evaluateActionPriorityCategory(proposal, character, needs, goals, context);
}

