import crypto from 'node:crypto';
import { getDb } from '../db.js';
import { LwsNotFoundError, LwsConflictError, LwsValidationError } from '../errors.js';
import { generateUuid, isValidUuid, isoNow, safeJsonParse, ensureActiveSimulation } from '../simulations/common.js';
import { evaluateAuthority } from './authority.js';
import { applyStateTransition } from './state-transitions.js';
import { EVENT_TYPES } from './taxonomy.js';

/**
 * Computes a deterministic SHA-256 fingerprint of an event proposal for idempotency validation.
 *
 * @param {object} proposal
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function computeProposalFingerprint(proposal) {
    const canonical = {
        event_type: proposal.event_type,
        actor_character_id: proposal.actor_character_id ?? null,
        target_character_id: proposal.target_character_id ?? null,
        authored_character_id: proposal.authored_character_id ?? proposal.payload?.character_id ?? null,
        location_id: proposal.location_id ?? proposal.payload?.target_location_id ?? null,
        fictional_time: proposal.fictional_time ?? null,
        payload: proposal.payload ?? {},
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Formats a database row from lws_events for public presentation.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatEvent(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        simulation_id: row.simulation_lws_id ?? row.simulation_id,
        sequence_number: row.sequence_number,
        event_type: row.event_type,
        fictional_time: row.fictional_time,
        actor_character_id: row.actor_character_lws_id ?? null,
        target_character_id: row.target_character_lws_id ?? null,
        authored_character_id: row.authored_character_lws_id ?? null,
        location_id: row.location_lws_id ?? null,
        payload: safeJsonParse(row.payload, {}),
        provenance: row.provenance,
        causal_event_id: row.causal_event_lws_id ?? null,
        turn_id: row.turn_lws_id ?? null,
        idempotency_key: row.idempotency_key ?? null,
        created_at: row.created_at,
    };
}

/**
 * Internal worker that commits an event within an existing transaction context.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} sim
 * @param {object} proposal
 * @param {object} [callerContext]
 * @returns {object} Formatted committed event
 */
export function internalCommitEvent(db, sim, proposal, callerContext = {}) {
    // 1. Check idempotency if key supplied
    if (proposal.idempotency_key) {
        const existing = db.prepare(`
            SELECT e.*,
                   sim.lws_id AS simulation_lws_id,
                   sc_actor.lws_id AS actor_character_lws_id,
                   sc_target.lws_id AS target_character_lws_id,
                   c_auth.lws_id AS authored_character_lws_id,
                   loc.lws_id AS location_lws_id,
                   ce.lws_id AS causal_event_lws_id,
                   nt.lws_id AS turn_lws_id
            FROM lws_events e
            JOIN lws_simulations sim ON e.simulation_id = sim.id
            LEFT JOIN lws_simulation_characters sc_actor ON e.actor_character_id = sc_actor.id
            LEFT JOIN lws_simulation_characters sc_target ON e.target_character_id = sc_target.id
            LEFT JOIN lws_characters c_auth ON e.authored_character_id = c_auth.id
            LEFT JOIN lws_locations loc ON e.location_id = loc.id
            LEFT JOIN lws_events ce ON e.causal_event_id = ce.id
            LEFT JOIN lws_narrative_turns nt ON e.turn_id = nt.id
            WHERE e.simulation_id = ? AND e.idempotency_key = ?
        `).get(sim.id, proposal.idempotency_key);

        if (existing) {
            const existingProposalRepresentation = {
                event_type: existing.event_type,
                actor_character_id: existing.actor_character_lws_id,
                target_character_id: existing.target_character_lws_id,
                authored_character_id: existing.authored_character_lws_id,
                location_id: existing.location_lws_id,
                fictional_time: existing.fictional_time,
                payload: safeJsonParse(existing.payload, {}),
            };

            const existingFingerprint = computeProposalFingerprint(existingProposalRepresentation);
            const incomingProposalRepresentation = {
                ...proposal,
                fictional_time: proposal.fictional_time ?? sim.current_fictional_time,
            };
            const incomingFingerprint = computeProposalFingerprint(incomingProposalRepresentation);

            if (existingFingerprint !== incomingFingerprint) {
                throw new LwsConflictError('Idempotency key reused with different request payload');
            }
            return formatEvent(existing);
        }
    }

    // 2. Evaluate Authority (Stages 1-3)
    const evaluated = evaluateAuthority(db, sim, proposal, callerContext);

    // 3. Monotonic Sequence Number
    const seqRow = db.prepare(`
        SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
        FROM lws_events
        WHERE simulation_id = ?
    `).get(sim.id);
    const sequenceNumber = seqRow.next_seq;

    const eventCreatedAt = isoNow();
    const eventLwsId = generateUuid();
    let finalActorInternalId = evaluated.actor_internal_id;
    let finalPayload = evaluated.payload;

    // 4. Special handling for CHARACTER_JOIN creation ordering
    if (evaluated.event_type === EVENT_TYPES.CHARACTER_JOIN) {
        const authoredChar = evaluated.authored_character_row;
        const simCharLwsId = generateUuid();
        const p = evaluated.payload;

        const charSnapshot = {
            name: authoredChar.name,
            description: authoredChar.description,
            personality: authoredChar.personality,
            scenario_context: authoredChar.scenario_context,
            mes_example: authoredChar.mes_example,
            author_notes: authoredChar.author_notes,
            system_prompt_override: authoredChar.system_prompt_override,
            character_version: authoredChar.character_version,
            tags: safeJsonParse(authoredChar.tags, []),
            extensions: safeJsonParse(authoredChar.extensions, {}),
        };

        const initialActivity = p.activity || 'idle';
        const initialPhysicalCondition = p.physical_condition || 'normal';
        const initialRuntimeState = p.runtime_state || {};

        // Insert SimulationCharacter row first so row exists for trigger verification
        const insertSimCharStmt = db.prepare(`
            INSERT INTO lws_simulation_characters (
                lws_id, simulation_id, character_id, current_location_id,
                activity, physical_condition, runtime_state, authored_snapshot,
                created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `);

        insertSimCharStmt.run(
            simCharLwsId,
            sim.id,
            authoredChar.id,
            evaluated.location_internal_id,
            initialActivity,
            initialPhysicalCondition,
            JSON.stringify(initialRuntimeState),
            JSON.stringify(charSnapshot),
            eventCreatedAt,
            eventCreatedAt,
        );

        const newSimCharRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simCharLwsId);
        finalActorInternalId = newSimCharRow.id;

        // Ensure payload is complete and self-contained for zero-SQL replay
        finalPayload = {
            ...p,
            character_id: authoredChar.lws_id,
            authored_snapshot: charSnapshot,
            initial_location_id: evaluated.location_lws_id,
            activity: initialActivity,
            physical_condition: initialPhysicalCondition,
            runtime_state: initialRuntimeState,
        };
    }

    // 5. Insert Event Record
    const insertResult = db.prepare(`
        INSERT INTO lws_events (
            lws_id, simulation_id, sequence_number, event_type, fictional_time,
            actor_character_id, target_character_id, authored_character_id, location_id,
            payload, provenance, causal_event_id, turn_id, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        eventLwsId,
        sim.id,
        sequenceNumber,
        evaluated.event_type,
        evaluated.fictional_time,
        finalActorInternalId,
        evaluated.target_internal_id,
        evaluated.authored_character_internal_id,
        evaluated.location_internal_id,
        JSON.stringify(finalPayload),
        evaluated.provenance,
        evaluated.causal_event_internal_id,
        evaluated.turn_internal_id,
        evaluated.idempotency_key,
        eventCreatedAt,
    );

    evaluated.event_internal_id = insertResult.lastInsertRowid;
    evaluated.event_lws_id = eventLwsId;
    evaluated.actor_internal_id = finalActorInternalId;
    evaluated.payload = finalPayload;

    // 6. Apply State Transition
    applyStateTransition(db, sim, evaluated, eventCreatedAt);

    // 7. Return Formatted Event
    const insertedRow = db.prepare(`
        SELECT e.*,
               sim.lws_id AS simulation_lws_id,
               sc_actor.lws_id AS actor_character_lws_id,
               sc_target.lws_id AS target_character_lws_id,
               c_auth.lws_id AS authored_character_lws_id,
               loc.lws_id AS location_lws_id,
               ce.lws_id AS causal_event_lws_id,
               nt.lws_id AS turn_lws_id
        FROM lws_events e
        JOIN lws_simulations sim ON e.simulation_id = sim.id
        LEFT JOIN lws_simulation_characters sc_actor ON e.actor_character_id = sc_actor.id
        LEFT JOIN lws_simulation_characters sc_target ON e.target_character_id = sc_target.id
        LEFT JOIN lws_characters c_auth ON e.authored_character_id = c_auth.id
        LEFT JOIN lws_locations loc ON e.location_id = loc.id
        LEFT JOIN lws_events ce ON e.causal_event_id = ce.id
        LEFT JOIN lws_narrative_turns nt ON e.turn_id = nt.id
        WHERE e.lws_id = ?
    `).get(eventLwsId);

    return formatEvent(insertedRow);
}

/**
 * Commits a single event proposal through the authority pipeline inside an atomic transaction.
 *
 * @param {string} simLwsId
 * @param {object} proposal
 * @param {object} [callerContext]
 * @returns {object} Formatted committed event
 */
export function commitEvent(simLwsId, proposal, callerContext = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    return db.transaction(() => {
        return internalCommitEvent(db, sim, proposal, callerContext);
    })();
}

/**
 * Retrieves a single event by UUID.
 *
 * @param {string} simLwsId
 * @param {string} eventLwsId
 * @returns {object}
 */
export function getEventByLwsId(simLwsId, eventLwsId) {
    if (!isValidUuid(eventLwsId)) {
        throw new LwsValidationError('Invalid event UUID format', ['eventLwsId']);
    }
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    const row = db.prepare(`
        SELECT e.*,
               sim.lws_id AS simulation_lws_id,
               sc_actor.lws_id AS actor_character_lws_id,
               sc_target.lws_id AS target_character_lws_id,
               c_auth.lws_id AS authored_character_lws_id,
               loc.lws_id AS location_lws_id,
               ce.lws_id AS causal_event_lws_id,
               nt.lws_id AS turn_lws_id
        FROM lws_events e
        JOIN lws_simulations sim ON e.simulation_id = sim.id
        LEFT JOIN lws_simulation_characters sc_actor ON e.actor_character_id = sc_actor.id
        LEFT JOIN lws_simulation_characters sc_target ON e.target_character_id = sc_target.id
        LEFT JOIN lws_characters c_auth ON e.authored_character_id = c_auth.id
        LEFT JOIN lws_locations loc ON e.location_id = loc.id
        LEFT JOIN lws_events ce ON e.causal_event_id = ce.id
        LEFT JOIN lws_narrative_turns nt ON e.turn_id = nt.id
        WHERE e.lws_id = ? AND e.simulation_id = ?
    `).get(eventLwsId, sim.id);

    if (!row) {
        throw new LwsNotFoundError('Event not found');
    }
    return formatEvent(row);
}

/**
 * Lists committed events for a simulation with pagination and filtering.
 *
 * @param {string} simLwsId
 * @param {object} [options]
 * @returns {object[]}
 */
export function listEvents(simLwsId, options = {}) {
    const db = getDb();
    const sim = ensureActiveSimulation(db, simLwsId);

    let sql = `
        SELECT e.*,
               sim.lws_id AS simulation_lws_id,
               sc_actor.lws_id AS actor_character_lws_id,
               sc_target.lws_id AS target_character_lws_id,
               c_auth.lws_id AS authored_character_lws_id,
               loc.lws_id AS location_lws_id,
               ce.lws_id AS causal_event_lws_id,
               nt.lws_id AS turn_lws_id
        FROM lws_events e
        JOIN lws_simulations sim ON e.simulation_id = sim.id
        LEFT JOIN lws_simulation_characters sc_actor ON e.actor_character_id = sc_actor.id
        LEFT JOIN lws_simulation_characters sc_target ON e.target_character_id = sc_target.id
        LEFT JOIN lws_characters c_auth ON e.authored_character_id = c_auth.id
        LEFT JOIN lws_locations loc ON e.location_id = loc.id
        LEFT JOIN lws_events ce ON e.causal_event_id = ce.id
        LEFT JOIN lws_narrative_turns nt ON e.turn_id = nt.id
        WHERE e.simulation_id = ?
    `;
    const params = [sim.id];

    if (options.since_sequence) {
        sql += ' AND e.sequence_number > ?';
        params.push(Number(options.since_sequence));
    }
    if (options.event_type) {
        sql += ' AND e.event_type = ?';
        params.push(options.event_type);
    }
    if (options.actor_character_id) {
        if (!isValidUuid(options.actor_character_id)) {
            throw new LwsValidationError('Invalid actor_character_id UUID format', ['actor_character_id']);
        }
        sql += ' AND sc_actor.lws_id = ?';
        params.push(options.actor_character_id);
    }

    if (options.unlimited === true) {
        sql += ' ORDER BY e.sequence_number ASC';
    } else {
        const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
        const offset = Math.max(0, Number(options.offset) || 0);
        sql += ' ORDER BY e.sequence_number ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatEvent);
}
