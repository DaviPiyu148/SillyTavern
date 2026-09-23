import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { generateUuid, isValidUuid, isoNow, safeJsonParse, ensureActiveSimulation } from '../simulations/common.js';
import { internalCommitEvent } from './events.js';

/**
 * Formats a database row from lws_narrative_turns for public presentation.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatNarrativeTurn(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id ?? row.simulation_id,
        turn_number: row.turn_number,
        user_input: row.user_input,
        raw_model_output: row.raw_model_output,
        parsed_narrative: row.parsed_narrative,
        model_info: safeJsonParse(row.model_info, {}),
        status: row.status,
        error_details: safeJsonParse(row.error_details, row.error_details),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Executes a narrative turn using the two-transaction savepoint architecture.
 *
 * Transaction A: Inserts the pending turn record.
 * Transaction B: Executes proposals under SAVEPOINT proposal_batch.
 *   - Success: Releases savepoint, commits turn as 'committed'.
 *   - Failure: Rolls back to savepoint, releases savepoint, commits turn as 'rejected' with error_details.
 *
 * @param {string} simLwsId
 * @param {object} turnInput
 * @param {object} [callerContext]
 * @returns {{ success: boolean, turn: object, events?: object[], error?: Error }}
 */
export function executeNarrativeTurn(simLwsId, turnInput = {}, callerContext = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    // ------------------------------------------------------------------------
    // Transaction A: Create and commit pending turn record
    // ------------------------------------------------------------------------
    let turnInternalId;
    const turnLwsId = generateUuid();
    const nowA = isoNow();

    db.transaction(() => {
        const nextTurnRow = db.prepare(`
            SELECT COALESCE(MAX(turn_number), 0) + 1 AS next_turn
            FROM lws_narrative_turns
            WHERE simulation_id = ?
        `).get(sim.id);

        db.prepare(`
            INSERT INTO lws_narrative_turns (
                lws_id, simulation_id, turn_number, user_input,
                raw_model_output, parsed_narrative, model_info, status,
                error_details, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
        `).run(
            turnLwsId,
            sim.id,
            nextTurnRow.next_turn,
            turnInput.user_input ?? null,
            turnInput.raw_model_output ?? null,
            turnInput.parsed_narrative ?? null,
            JSON.stringify(turnInput.model_info ?? {}),
            nowA,
            nowA,
        );

        turnInternalId = db.prepare('SELECT id FROM lws_narrative_turns WHERE lws_id = ?').get(turnLwsId).id;
    })();

    // ------------------------------------------------------------------------
    // Transaction B: Execute proposal batch under SAVEPOINT
    // ------------------------------------------------------------------------
    return db.transaction(() => {
        db.exec('SAVEPOINT proposal_batch');

        try {
            const committedEvents = [];
            const proposals = Array.isArray(turnInput.proposals) ? turnInput.proposals : [];

            for (let i = 0; i < proposals.length; i++) {
                const proposal = proposals[i];
                const turnProposal = {
                    ...proposal,
                    turn_internal_id: turnInternalId,
                };

                // Server-forces 'llm_proposal' provenance
                const event = internalCommitEvent(db, sim, turnProposal, { ...callerContext, isTurn: true });
                committedEvents.push(event);
            }

            db.exec('RELEASE proposal_batch');
            const nowSuccess = isoNow();

            db.prepare(`
                UPDATE lws_narrative_turns
                SET status = 'committed', updated_at = ?
                WHERE id = ?
            `).run(nowSuccess, turnInternalId);

            const updatedRow = db.prepare(`
                SELECT nt.*, sim.lws_id AS simulation_lws_id
                FROM lws_narrative_turns nt
                JOIN lws_simulations sim ON nt.simulation_id = sim.id
                WHERE nt.id = ?
            `).get(turnInternalId);

            return {
                success: true,
                turn: formatNarrativeTurn(updatedRow),
                events: committedEvents,
            };
        } catch (err) {
            // Rollback all proposals to keep event ledger and projections intact
            db.exec('ROLLBACK TO proposal_batch');
            db.exec('RELEASE proposal_batch');

            const errorDetails = JSON.stringify({
                message: err.message,
                code: err.code ?? 'AUTHORITY_ERROR',
                fields: err.fields ?? [],
            });

            const nowFail = isoNow();
            db.prepare(`
                UPDATE lws_narrative_turns
                SET status = 'rejected', error_details = ?, updated_at = ?
                WHERE id = ?
            `).run(errorDetails, nowFail, turnInternalId);

            const rejectedRow = db.prepare(`
                SELECT nt.*, sim.lws_id AS simulation_lws_id
                FROM lws_narrative_turns nt
                JOIN lws_simulations sim ON nt.simulation_id = sim.id
                WHERE nt.id = ?
            `).get(turnInternalId);

            return {
                success: false,
                turn: formatNarrativeTurn(rejectedRow),
                error: err,
            };
        }
    })();
}

/**
 * Retrieves a single narrative turn by UUID.
 *
 * @param {string} simLwsId
 * @param {string} turnLwsId
 * @returns {object}
 */
export function getNarrativeTurnByLwsId(simLwsId, turnLwsId) {
    if (!isValidUuid(turnLwsId)) {
        throw new LwsValidationError('Invalid turn UUID format', ['turnLwsId']);
    }
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const row = db.prepare(`
        SELECT nt.*, sim.lws_id AS simulation_lws_id
        FROM lws_narrative_turns nt
        JOIN lws_simulations sim ON nt.simulation_id = sim.id
        WHERE nt.lws_id = ? AND nt.simulation_id = ?
    `).get(turnLwsId, sim.id);

    if (!row) {
        throw new LwsNotFoundError('Narrative turn not found');
    }
    return formatNarrativeTurn(row);
}

/**
 * Lists narrative turns for a simulation.
 *
 * @param {string} simLwsId
 * @param {object} [options]
 * @returns {object[]}
 */
export function listNarrativeTurns(simLwsId, options = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.offset) || 0);

    const rows = db.prepare(`
        SELECT nt.*, sim.lws_id AS simulation_lws_id
        FROM lws_narrative_turns nt
        JOIN lws_simulations sim ON nt.simulation_id = sim.id
        WHERE nt.simulation_id = ?
        ORDER BY nt.turn_number ASC
        LIMIT ? OFFSET ?
    `).all(sim.id, limit, offset);

    return rows.map(formatNarrativeTurn);
}
