import { LwsNotFoundError, LwsConflictError, LwsAuthorityError } from '../errors.js';
import { EVENT_TYPES, validateProposalSchema } from './taxonomy.js';
import { validateFictionalTimestamp, safeJsonParse } from '../simulations/common.js';

/**
 * Executes Stages 1, 2, and 3 of the LWS Authority Pipeline.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} sim The active simulation row from lws_simulations
 * @param {object} proposal Untrusted event proposal input
 * @param {object} [callerContext] Security and execution context
 * @returns {object} Evaluated proposal containing resolved internal rowids
 */
export function evaluateAuthority(db, sim, proposal, callerContext = {}) {
    // ------------------------------------------------------------------------
    // Stage 0: Dedicated Route Policy (One Authoritative Path)
    // ------------------------------------------------------------------------
    const DEDICATED_ROUTE_EVENTS = new Set([
        EVENT_TYPES.TIME_ADVANCE,
        EVENT_TYPES.SCHEDULE_WORLD_EVENT,
        EVENT_TYPES.CANCEL_SCHEDULED_EVENT,
        EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT,
        EVENT_TYPES.TRIGGER_SCHEDULED_EVENT,
        EVENT_TYPES.UPDATE_CHARACTER_ROUTINE,
    ]);

    if (DEDICATED_ROUTE_EVENTS.has(proposal?.event_type)) {
        if (!callerContext.isDedicatedRoute && !callerContext.isTimeAdvance && !callerContext.isInternalSystem) {
            throw new LwsAuthorityError(
                `Event type '${proposal.event_type}' requires submission through its dedicated API route`,
                'DEDICATED_ROUTE_REQUIRED',
            );
        }
    }

    // ------------------------------------------------------------------------
    // Stage 1: Schema Validation
    // ------------------------------------------------------------------------
    validateProposalSchema(proposal);

    const payload = proposal.payload ?? {};

    // ------------------------------------------------------------------------
    // Stage 2: Domain Reference Validation
    // ------------------------------------------------------------------------
    if (sim.deleted_at !== null) {
        throw new LwsNotFoundError('Simulation not found or is deleted');
    }

    let actorInternalId = null;
    let actorRow = null;
    if (proposal.actor_character_id) {
        actorRow = db.prepare(`
            SELECT id, lws_id, simulation_id, character_id, current_location_id,
                   activity, physical_condition, runtime_state, authored_snapshot, deleted_at
            FROM lws_simulation_characters
            WHERE lws_id = ? AND simulation_id = ?
        `).get(proposal.actor_character_id, sim.id);

        if (!actorRow) {
            throw new LwsNotFoundError(`Actor character ${proposal.actor_character_id} not found in this simulation`);
        }
        if (actorRow.deleted_at !== null) {
            throw new LwsAuthorityError('Actor character is soft-deleted', 'ACTOR_DELETED');
        }
        actorInternalId = actorRow.id;
    }

    let targetInternalId = null;
    let targetRow = null;
    if (proposal.target_character_id) {
        targetRow = db.prepare(`
            SELECT id, lws_id, simulation_id, character_id, current_location_id,
                   activity, physical_condition, runtime_state, authored_snapshot, deleted_at
            FROM lws_simulation_characters
            WHERE lws_id = ? AND simulation_id = ?
        `).get(proposal.target_character_id, sim.id);

        if (!targetRow) {
            throw new LwsNotFoundError(`Target character ${proposal.target_character_id} not found in this simulation`);
        }
        if (targetRow.deleted_at !== null) {
            throw new LwsAuthorityError('Target character is soft-deleted', 'TARGET_DELETED');
        }
        targetInternalId = targetRow.id;
    }

    let locationInternalId = null;
    const hasExplicitLocation = proposal.location_id !== undefined || payload.target_location_id !== undefined || payload.location_id !== undefined;
    const requestedLocationLwsId = proposal.location_id ?? payload.target_location_id ?? payload.location_id;
    if (requestedLocationLwsId) {
        const loc = db.prepare(`
            SELECT id, lws_id, world_id, deleted_at
            FROM lws_locations
            WHERE lws_id = ? AND world_id = ?
        `).get(requestedLocationLwsId, sim.world_id);

        if (!loc) {
            throw new LwsNotFoundError(`Location ${requestedLocationLwsId} not found in this world`);
        }
        if (loc.deleted_at !== null) {
            throw new LwsAuthorityError('Location is soft-deleted', 'LOCATION_DELETED');
        }
        locationInternalId = loc.id;
    }

    let authoredCharacterInternalId = null;
    let authoredCharacterRow = null;
    if (proposal.event_type === EVENT_TYPES.CHARACTER_JOIN) {
        const authoredLwsId = payload.character_id ?? proposal.authored_character_id;
        authoredCharacterRow = db.prepare(`
            SELECT * FROM lws_characters
            WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
        `).get(authoredLwsId, sim.world_id);

        if (!authoredCharacterRow) {
            throw new LwsNotFoundError(`Authored character ${authoredLwsId} not found in this world`);
        }
        authoredCharacterInternalId = authoredCharacterRow.id;

        // Ensure character is not already active in this simulation
        const existingActive = db.prepare(`
            SELECT id FROM lws_simulation_characters
            WHERE simulation_id = ? AND character_id = ? AND deleted_at IS NULL
        `).get(sim.id, authoredCharacterRow.id);

        if (existingActive) {
            throw new LwsConflictError('Character is already active in this simulation');
        }
    }

    let causalEventInternalId = null;
    if (proposal.causal_event_id) {
        const causalRow = db.prepare(`
            SELECT id, simulation_id, sequence_number
            FROM lws_events
            WHERE lws_id = ? AND simulation_id = ?
        `).get(proposal.causal_event_id, sim.id);

        if (!causalRow) {
            throw new LwsNotFoundError(`Causal event ${proposal.causal_event_id} not found in this simulation`);
        }
        causalEventInternalId = causalRow.id;
    }

    // ------------------------------------------------------------------------
    // Stage 3: Authority Evaluation
    // ------------------------------------------------------------------------

    // 1. Provenance Authorization
    let provenance = proposal.provenance ?? 'user';
    if (callerContext.isTurn) {
        // Enforce server-managed LLM provenance during narrative turns
        provenance = 'llm_proposal';
    } else if (callerContext.isInternalSystem) {
        provenance = 'system';
    } else if (callerContext.isInternalEngine) {
        provenance = 'simulation_engine';
    } else {
        // External HTTP caller
        if (proposal.provenance === 'system' || proposal.provenance === 'simulation_engine') {
            throw new LwsAuthorityError('Unauthorized provenance assertion', 'FORBIDDEN_PROVENANCE');
        }
        if (proposal.provenance === 'director') {
            if (!callerContext.isAdmin) {
                throw new LwsAuthorityError('Director privileges required', 'DIRECTOR_UNAUTHORIZED');
            }
            provenance = 'director';
        } else {
            provenance = 'user';
        }
    }

    // Director-only event authorization
    if ([EVENT_TYPES.DIRECTOR_MODIFY_STATE, EVENT_TYPES.DIRECTOR_NOTE, EVENT_TYPES.DIRECTOR_INSPECT].includes(proposal.event_type)) {
        if (provenance !== 'director' && !callerContext.isInternalSystem) {
            throw new LwsAuthorityError(`${proposal.event_type} requires director provenance`, 'DIRECTOR_REQUIRED');
        }
    }

    // 2. Simulation Status Authority
    if (sim.status === 'archived') {
        // Only special soft-deletion SIMULATION_STOP allowed from archived
        if (proposal.event_type !== EVENT_TYPES.SIMULATION_STOP || payload.action !== 'delete') {
            throw new LwsAuthorityError('Cannot execute event on archived simulation', 'SIMULATION_IS_ARCHIVED');
        }
    } else if (sim.status === 'paused') {
        const allowedLifecycle = [EVENT_TYPES.SIMULATION_RESUME, EVENT_TYPES.SIMULATION_STOP];
        if (!allowedLifecycle.includes(proposal.event_type)) {
            throw new LwsAuthorityError('Simulation is paused', 'SIMULATION_IS_PAUSED');
        }
    } else if (sim.status === 'active') {
        if (proposal.event_type === EVENT_TYPES.SIMULATION_RESUME) {
            throw new LwsAuthorityError('Simulation is already active', 'SIMULATION_ALREADY_ACTIVE');
        }
    }

    // 4. Fictional Clock Authority (Three-class model)
    let fictionalTime = proposal.fictional_time ?? sim.current_fictional_time;
    validateFictionalTimestamp(fictionalTime);

    if (callerContext.isTimeAdvance) {
        // Consequence event or Root Time Advance
        const { startFictionalTime, targetFictionalTime } = callerContext;
        if (proposal.event_type === EVENT_TYPES.TIME_ADVANCE) {
            if (fictionalTime !== targetFictionalTime) {
                throw new LwsAuthorityError(
                    `Root TIME_ADVANCE fictional_time (${fictionalTime}) must match target_fictional_time (${targetFictionalTime})`,
                    'FICTIONAL_TIME_MISMATCH',
                );
            }
        } else {
            // Intermediate consequence event: startFictionalTime <= fictionalTime <= targetFictionalTime
            if (fictionalTime < startFictionalTime || fictionalTime > targetFictionalTime) {
                throw new LwsAuthorityError(
                    `Consequence event fictional_time (${fictionalTime}) must be within [${startFictionalTime}, ${targetFictionalTime}]`,
                    'FICTIONAL_TIME_OUT_OF_BOUNDS',
                );
            }
        }
    } else {
        // Normal / direct event: MUST match simulation current fictional time
        if (fictionalTime !== sim.current_fictional_time) {
            throw new LwsAuthorityError(
                `event fictional_time (${fictionalTime}) must match simulation current_fictional_time (${sim.current_fictional_time})`,
                'FICTIONAL_TIME_MISMATCH',
            );
        }
    }

    // 4. Spatial Proximity / Collocation Authority
    if (proposal.event_type === EVENT_TYPES.INTERACT_OBJECT) {
        if (actorRow.current_location_id !== locationInternalId) {
            throw new LwsAuthorityError('Actor must be at the object location to interact', 'SPATIAL_DISCONNECT');
        }
    } else if (proposal.event_type === EVENT_TYPES.COMMUNICATE) {
        const isRemote = payload.channel === 'remote';
        if (!isRemote && targetRow) {
            if (actorRow.current_location_id !== targetRow.current_location_id) {
                throw new LwsAuthorityError('Actor and target must be collocated for direct communication', 'SPATIAL_DISCONNECT');
            }
        }
        if (actorRow.current_location_id !== locationInternalId) {
            throw new LwsAuthorityError('Actor is not at the event location', 'SPATIAL_DISCONNECT');
        }
    } else if (proposal.event_type === EVENT_TYPES.TRANSFER_ITEM || proposal.event_type === EVENT_TYPES.COMBAT_ACTION) {
        if (actorRow.current_location_id !== targetRow.current_location_id || actorRow.current_location_id !== locationInternalId) {
            throw new LwsAuthorityError(`Actor and target must be collocated at the event location for ${proposal.event_type}`, 'SPATIAL_DISCONNECT');
        }
    }

    // 5. Resource / Prerequisite Authority (§8.2, §9.2)
    if (proposal.event_type === EVENT_TYPES.CONSUME_ITEM) {
        const itemId = payload.item_id ?? proposal.target_entity_id;
        if (itemId != null) {
            const requiredQty = payload.quantity ?? 1;
            const runtimeState = typeof actorRow?.runtime_state === 'string'
                ? safeJsonParse(actorRow.runtime_state, {})
                : (actorRow?.runtime_state || {});
            const inventory = Array.isArray(runtimeState.inventory) ? runtimeState.inventory : [];
            const item = inventory.find(i => String(i.id) === String(itemId) || String(i.name) === String(itemId));
            if (!item || (typeof item.quantity === 'number' && item.quantity < requiredQty)) {
                throw new LwsAuthorityError(`Item '${itemId}' not available in actor inventory`, 'PREREQUISITE_FAILED');
            }
        }
    } else if (proposal.event_type === EVENT_TYPES.TRANSFER_ITEM) {
        const itemId = payload.item_id ?? proposal.target_entity_id;
        if (itemId != null) {
            const requiredQty = payload.quantity ?? 1;
            const runtimeState = typeof actorRow?.runtime_state === 'string'
                ? safeJsonParse(actorRow.runtime_state, {})
                : (actorRow?.runtime_state || {});
            const inventory = Array.isArray(runtimeState.inventory) ? runtimeState.inventory : [];
            const item = inventory.find(i => String(i.id) === String(itemId) || String(i.name) === String(itemId));
            if (!item || (typeof item.quantity === 'number' && item.quantity < requiredQty)) {
                throw new LwsAuthorityError(`Item '${itemId}' not available in actor inventory`, 'PREREQUISITE_FAILED');
            }
        }
    }

    return {
        event_type: proposal.event_type,
        fictional_time: fictionalTime,
        provenance,
        actor_internal_id: actorInternalId,
        actor_lws_id: proposal.actor_character_id ?? null,
        actor_row: actorRow,
        target_internal_id: targetInternalId,
        target_lws_id: proposal.target_character_id ?? null,
        target_row: targetRow,
        location_internal_id: locationInternalId,
        location_lws_id: requestedLocationLwsId ?? null,
        has_explicit_location: hasExplicitLocation,
        authored_character_internal_id: authoredCharacterInternalId,
        authored_character_lws_id: payload.character_id ?? proposal.authored_character_id ?? null,
        authored_character_row: authoredCharacterRow,
        causal_event_internal_id: causalEventInternalId,
        turn_internal_id: proposal.turn_internal_id ?? null,
        idempotency_key: proposal.idempotency_key ?? null,
        payload,
    };
}
