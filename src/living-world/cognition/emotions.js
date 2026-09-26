import { generateDeterministicUuid } from './common.js';
import { LwsValidationError } from '../errors.js';

export const EMOTION_NAMES = Object.freeze([
    'neutral',
    'joyful',
    'fearful',
    'angry',
    'sad',
    'surprised',
    'disgusted',
    'anxious',
    'hopeful',
]);

export const ACTION_CLASSES = Object.freeze([
    'DECEPTIVE_COMM',
    'TRUTHFUL_COMM',
    'COMBAT_AGGR',
    'FLEEING',
    'AID_COMFORT',
    'TRANSFER_ITEM',
    'WORK',
    'GOAL_PURSUIT',
    'OBSERVE',
    'INTERACT_OBJ',
    'IDLE_LEISURE',
]);

/**
 * 6.3 Complete Emotional Affinity Matrix (9 x 11 = 99 cells)
 * Affinity(dominant_emotion, ActionClass) in [-1.0, +1.0]
 */
export const EMOTION_AFFINITY_MATRIX = Object.freeze({
    neutral: {
        DECEPTIVE_COMM: 0.0, TRUTHFUL_COMM: 0.0, COMBAT_AGGR: 0.0, FLEEING: 0.0,
        AID_COMFORT: 0.0, TRANSFER_ITEM: 0.0, WORK: 0.0, GOAL_PURSUIT: 0.0,
        OBSERVE: 0.0, INTERACT_OBJ: 0.0, IDLE_LEISURE: 0.0,
    },
    joyful: {
        DECEPTIVE_COMM: -0.4, TRUTHFUL_COMM: 0.8, COMBAT_AGGR: -0.8, FLEEING: -0.5,
        AID_COMFORT: 1.0, TRANSFER_ITEM: 0.7, WORK: 0.4, GOAL_PURSUIT: 0.6,
        OBSERVE: 0.2, INTERACT_OBJ: 0.3, IDLE_LEISURE: 0.5,
    },
    fearful: {
        DECEPTIVE_COMM: -0.2, TRUTHFUL_COMM: -0.2, COMBAT_AGGR: -1.0, FLEEING: 1.0,
        AID_COMFORT: 0.2, TRANSFER_ITEM: 0.0, WORK: -0.6, GOAL_PURSUIT: -0.4,
        OBSERVE: 0.5, INTERACT_OBJ: -0.2, IDLE_LEISURE: -0.5,
    },
    angry: {
        DECEPTIVE_COMM: -0.2, TRUTHFUL_COMM: -0.4, COMBAT_AGGR: 1.0, FLEEING: -0.8,
        AID_COMFORT: -0.8, TRANSFER_ITEM: -0.5, WORK: -0.2, GOAL_PURSUIT: 0.2,
        OBSERVE: 0.0, INTERACT_OBJ: 0.0, IDLE_LEISURE: -0.8,
    },
    sad: {
        DECEPTIVE_COMM: -0.3, TRUTHFUL_COMM: -0.4, COMBAT_AGGR: -0.5, FLEEING: -0.4,
        AID_COMFORT: 0.3, TRANSFER_ITEM: 0.2, WORK: -0.7, GOAL_PURSUIT: -0.5,
        OBSERVE: -0.2, INTERACT_OBJ: -0.3, IDLE_LEISURE: 0.8,
    },
    surprised: {
        DECEPTIVE_COMM: 0.0, TRUTHFUL_COMM: 0.2, COMBAT_AGGR: -0.2, FLEEING: 0.3,
        AID_COMFORT: 0.2, TRANSFER_ITEM: 0.0, WORK: -0.5, GOAL_PURSUIT: 0.0,
        OBSERVE: 1.0, INTERACT_OBJ: 0.6, IDLE_LEISURE: -0.4,
    },
    disgusted: {
        DECEPTIVE_COMM: -0.5, TRUTHFUL_COMM: -0.4, COMBAT_AGGR: -0.2, FLEEING: 0.4,
        AID_COMFORT: -0.6, TRANSFER_ITEM: -0.6, WORK: -0.3, GOAL_PURSUIT: -0.2,
        OBSERVE: 0.0, INTERACT_OBJ: -0.6, IDLE_LEISURE: 0.2,
    },
    anxious: {
        DECEPTIVE_COMM: -0.3, TRUTHFUL_COMM: -0.2, COMBAT_AGGR: -0.6, FLEEING: 0.6,
        AID_COMFORT: 0.2, TRANSFER_ITEM: 0.0, WORK: -0.4, GOAL_PURSUIT: -0.2,
        OBSERVE: 0.8, INTERACT_OBJ: 0.2, IDLE_LEISURE: -0.6,
    },
    hopeful: {
        DECEPTIVE_COMM: -0.5, TRUTHFUL_COMM: 0.6, COMBAT_AGGR: -0.6, FLEEING: -0.3,
        AID_COMFORT: 0.7, TRANSFER_ITEM: 0.5, WORK: 0.7, GOAL_PURSUIT: 0.8,
        OBSERVE: 0.4, INTERACT_OBJ: 0.4, IDLE_LEISURE: 0.2,
    },
});

/**
 * Normalizes an action class string to match the matrix column keys.
 *
 * @param {string} rawClass
 * @returns {string}
 */
export function normalizeActionClassKey(rawClass) {
    switch (rawClass) {
        case 'DECEPTIVE_COMMUNICATION': return 'DECEPTIVE_COMM';
        case 'TRUTHFUL_COMMUNICATION': return 'TRUTHFUL_COMM';
        case 'COMBAT_AGGRESSION': return 'COMBAT_AGGR';
        case 'AUTONOMOUS_GOAL_PURSUIT': return 'GOAL_PURSUIT';
        case 'INTERACT_OBJECT': return 'INTERACT_OBJ';
        default: return rawClass;
    }
}

/**
 * Returns the emotional affinity for a dominant emotion and action class.
 *
 * @param {string} dominantEmotion
 * @param {string} actionClass
 * @returns {number} Value in [-1.0, 1.0]
 */
export function getEmotionAffinity(dominantEmotion, actionClass) {
    const emoKey = dominantEmotion || 'neutral';
    const classKey = normalizeActionClassKey(actionClass);
    const row = EMOTION_AFFINITY_MATRIX[emoKey];
    if (row && typeof row[classKey] === 'number') {
        return row[classKey];
    }
    return 0.0;
}

/**
 * 6.1 Hyperbolic Relaxation & 5-Step Operation Order (tau = 14400s)
 *
 * Step 1: Calculate raw decay
 * Step 2: Round to nearest integer
 * Step 3: Clamp
 * Step 4: Determine intensity
 * Step 5: Zero-intensity normalization
 *
 * @param {object} emotion { dominant_emotion, intensity, arousal, valence, last_updated_time }
 * @param {number} deltaSeconds
 * @returns {object} Updated emotion object adhering strictly to the IFF invariant
 */
export function decayEmotionState(emotion, deltaSeconds) {
    if (!emotion || deltaSeconds <= 0) {
        return {
            dominant_emotion: emotion?.dominant_emotion || 'neutral',
            intensity: emotion?.intensity ?? 0,
            arousal: emotion?.arousal ?? 50,
            valence: emotion?.valence ?? 0,
        };
    }

    const TAU = 14400.0;
    const factor = 1.0 + (deltaSeconds / TAU);

    // Step 1: Raw decay
    const iRaw = (emotion.intensity ?? 0) / factor;
    const aRaw = 50.0 + ((emotion.arousal ?? 50) - 50.0) / factor;
    const vRaw = (emotion.valence ?? 0) / factor;

    // Step 2: Round
    const iR = Math.round(iRaw);
    const aR = Math.round(aRaw);
    const vR = Math.round(vRaw);

    // Step 3: Clamp
    const iClamped = Math.max(0, Math.min(100, iR));
    const aClamped = Math.max(0, Math.min(100, aR));
    const vClamped = Math.max(-100, Math.min(100, vR));

    // Step 4 & 5: Determine intensity and normalize
    if (iClamped === 0) {
        return {
            dominant_emotion: 'neutral',
            intensity: 0,
            arousal: 50,
            valence: 0,
        };
    }

    const dominant = emotion.dominant_emotion && emotion.dominant_emotion !== 'neutral'
        ? emotion.dominant_emotion
        : 'joyful'; // fallback non-neutral if intensity > 0

    return {
        dominant_emotion: dominant,
        intensity: iClamped,
        arousal: aClamped,
        valence: vClamped,
    };
}

/**
 * Normalizes any incoming emotion update to satisfy the strict IFF invariant.
 *
 * @param {object} input
 * @returns {object}
 */
export function normalizeEmotionInput(input) {
    const rawIntensity = input.intensity !== undefined ? Math.round(input.intensity) : 0;
    const intensity = Math.max(0, Math.min(100, rawIntensity));

    if (intensity === 0) {
        return {
            dominant_emotion: 'neutral',
            intensity: 0,
            arousal: 50,
            valence: 0,
        };
    }

    const dominant = (input.dominant_emotion && input.dominant_emotion !== 'neutral')
        ? input.dominant_emotion
        : 'joyful';

    const rawArousal = input.arousal !== undefined ? Math.round(input.arousal) : 50;
    const rawValence = input.valence !== undefined ? Math.round(input.valence) : 0;

    const arousal = Math.max(0, Math.min(100, rawArousal));
    const valence = Math.max(-100, Math.min(100, rawValence));

    return {
        dominant_emotion: dominant,
        intensity,
        arousal,
        valence,
    };
}

/**
 * Initializes the character emotion row in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number} simCharId
 * @param {string} simLwsId
 * @param {string} charLwsId
 * @param {string} fictionalTime
 * @param {string} createdAt
 */
export function initCharacterEmotion(db, simId, simCharId, simLwsId, charLwsId, fictionalTime, createdAt) {
    const emotionLwsId = generateDeterministicUuid('emotion', simLwsId, charLwsId);
    db.prepare(`
        INSERT OR IGNORE INTO lws_character_emotions (
            lws_id, simulation_id, simulation_character_id, dominant_emotion,
            intensity, arousal, valence, last_updated_time, created_at, updated_at
        ) VALUES (?, ?, ?, 'neutral', 0, 50, 0, ?, ?, ?)
    `).run(emotionLwsId, simId, simCharId, fictionalTime, createdAt, createdAt);
}

/**
 * Retrieves the emotion state of a character from SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @returns {object | null}
 */
export function getCharacterEmotion(db, simCharId) {
    let charId = simCharId;
    if (typeof simCharId === 'string') {
        const c = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simCharId);
        if (!c) return null;
        charId = c.id;
    }
    return db.prepare(`
        SELECT * FROM lws_character_emotions
        WHERE simulation_character_id = ?
    `).get(charId) || null;
}


/**
 * Updates the emotion state of a character in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @param {object} emotionData
 * @param {string} fictionalTime
 * @param {string} updatedAt
 */
export function updateCharacterEmotion(db, simCharId, emotionData, fictionalTime, updatedAt) {
    const normalized = normalizeEmotionInput(emotionData);

    db.prepare(`
        UPDATE lws_character_emotions
        SET dominant_emotion = ?, intensity = ?, arousal = ?, valence = ?,
            last_updated_time = ?, updated_at = ?
        WHERE simulation_character_id = ?
    `).run(
        normalized.dominant_emotion,
        normalized.intensity,
        normalized.arousal,
        normalized.valence,
        fictionalTime,
        updatedAt,
        simCharId,
    );
}

/**
 * Calculates decayed emotion state for a target fictional timestamp.
 *
 * @param {object} emotion
 * @param {string} targetFictionalTime
 * @returns {object}
 */
export function calculateEmotionalDecay(emotion, targetFictionalTime) {
    if (!emotion) return normalizeEmotionInput({});
    const lastMs = new Date(emotion.last_updated_time || targetFictionalTime).getTime();
    const targetMs = new Date(targetFictionalTime).getTime();
    const deltaSeconds = Math.max(0, Math.floor((targetMs - lastMs) / 1000));
    return decayEmotionState(emotion, deltaSeconds);
}

export const getEmotionalAffinity = getEmotionAffinity;

