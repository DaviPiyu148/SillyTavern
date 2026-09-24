import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid, safeJsonParse } from '../authored/common.js';
import { formatMemory } from './memories.js';

/**
 * Calculates deterministic composite retrieval score for a memory candidate.
 *
 * @param {object} memory
 * @param {string} currentFictionalTime
 * @param {Array<string>} queryTokens
 * @returns {number} Score in [0, 1]
 */
/**
 * Calculates deterministic composite retrieval score for a memory candidate.
 *
 * @param {object} memory
 * @param {string} currentFictionalTime
 * @param {Array<string>} queryTokens
 * @returns {{ score: number, recencyScore: number, salienceScore: number, importanceScore: number, contextScore: number }}
 */
export function computeMemoryRetrievalScore(memory, currentFictionalTime, queryTokens = []) {
    // 1. Recency Score (Frozen formula: 1 / (1 + Δt / 604800) where τ = 604800s)
    const nowMs = new Date(currentFictionalTime).getTime();
    const memMs = new Date(memory.fictional_time).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - memMs) / 1000));
    const sRecency = 1.0 / (1.0 + (elapsedSeconds / 604800));

    // 2. Salience Score
    const sSalience = Math.min(100, Math.max(1, Number(memory.emotional_salience) || 50)) / 100.0;

    // 3. Importance Score
    const sImportance = Math.min(100, Math.max(1, Number(memory.importance) || 50)) / 100.0;

    // 4. Context Match Score
    let sContext = 0.5; // neutral baseline if no context terms given
    if (queryTokens.length > 0) {
        const memTags = safeJsonParse(memory.tags, []);
        const tagSet = new Set(memTags.map(t => String(t).toLowerCase().trim()));

        // Also tokenise summary & details
        const summaryWords = `${memory.summary || ''} ${memory.details || ''}`.toLowerCase().split(/[\s,._-]+/);
        for (const w of summaryWords) {
            if (w.length > 1) tagSet.add(w);
        }

        let matches = 0;
        for (const qt of queryTokens) {
            const token = qt.toLowerCase().trim();
            if (tagSet.has(token)) {
                matches++;
            }
        }
        sContext = Math.min(1.0, matches / queryTokens.length);
    }

    // Composite weights: recency 0.25, salience 0.25, importance 0.20, context 0.30
    const totalScore = (0.25 * sRecency) + (0.25 * sSalience) + (0.20 * sImportance) + (0.30 * sContext);
    const score = Math.round(totalScore * 10000) / 10000;

    return {
        score,
        recencyScore: Math.round(sRecency * 10000) / 10000,
        salienceScore: Math.round(sSalience * 10000) / 10000,
        importanceScore: Math.round(sImportance * 10000) / 10000,
        contextScore: Math.round(sContext * 10000) / 10000,
    };
}

/**
 * Executes a relevance-bounded memory retrieval query for a character.
 * Uses index-accelerated candidate pre-filtering bounded to N <= 100 records.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {object} params
 * @param {string} [params.currentFictionalTime]
 * @param {string} [params.current_fictional_time]
 * @param {number} [params.limit=5]
 * @param {number} [params.min_salience=1]
 * @param {Array<string>} [params.query_tags=[]]
 * @param {string} [params.query_text]
 * @param {string} [params.query]
 * @returns {Array<object>} Top-K scored memory objects with attached retrieval_score and breakdown
 */
export function retrieveCharacterMemories(db, charLwsId, {
    currentFictionalTime,
    current_fictional_time,
    limit = 5,
    min_salience = 1,
    query_tags = [],
    query_text = '',
    query = '',
} = {}) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const char = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    const effectiveLimit = Math.min(Math.max(1, Number(limit) || 5), 100);
    const minSalience = Math.max(1, Math.min(100, Number(min_salience) || 1));
    const nowTime = currentFictionalTime || current_fictional_time || new Date().toISOString();

    // 1. Index-accelerated candidate pre-filter query (Bounded to N <= 100)
    const candidates = db.prepare(`
        SELECT
            m.*,
            sc.lws_id AS character_lws_id,
            e.lws_id AS event_lws_id
        FROM lws_character_memories m
        JOIN lws_simulation_characters sc ON m.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON m.event_id = e.id
        WHERE m.simulation_character_id = ?
          AND m.deleted_at IS NULL
          AND m.emotional_salience >= ?
          AND m.fictional_time <= ?
        ORDER BY
          m.emotional_salience DESC,
          m.fictional_time DESC,
          m.lws_id ASC
        LIMIT 100
    `).all(char.id, minSalience, nowTime);

    // 2. Prepare query tokens
    const tokens = [];
    if (Array.isArray(query_tags)) {
        for (const t of query_tags) {
            if (typeof t === 'string' && t.trim()) tokens.push(t.trim());
        }
    }
    const combinedQueryText = `${query_text || ''} ${query || ''}`.trim();
    if (combinedQueryText) {
        const words = combinedQueryText.split(/[\s,._-]+/);
        for (const w of words) {
            if (w.length > 2) tokens.push(w);
        }
    }

    // 3. Score candidates
    const scored = candidates.map(c => {
        const scoreBreakdown = computeMemoryRetrievalScore(c, nowTime, tokens);
        const formatted = formatMemory(c);
        return {
            ...formatted,
            ...scoreBreakdown,
            retrieval_score: scoreBreakdown.score,
            memory: formatted,
        };
    });

    // 4. Sort deterministically: score DESC, fictional_time DESC, lws_id ASC
    scored.sort((a, b) => {
        if (b.retrieval_score !== a.retrieval_score) {
            return b.retrieval_score - a.retrieval_score;
        }
        if (b.fictional_time !== a.fictional_time) {
            return b.fictional_time.localeCompare(a.fictional_time);
        }
        return a.lws_id.localeCompare(b.lws_id);
    });

    return scored.slice(0, effectiveLimit);
}
