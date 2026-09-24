import { LwsValidationError, LwsConflictError } from '../errors.js';
import { validateFictionalTimestamp, ensureActiveSimulation, safeJsonParse } from '../simulations/common.js';
import { simulationLocks } from '../simulations/lock.js';
import { EVENT_TYPES } from '../events/taxonomy.js';
import { internalCommitEvent } from '../events/events.js';
import { arbitrateCharacterActivity, matchesRoutineTime } from './routines.js';
import { computeTravelDuration, computeArrivalTime, computePlannedDepartureTime } from './travel.js';

/**
 * Normalizes and validates time-advance input parameters.
 *
 * @param {object} sim Simulation row
 * @param {object} input Request body
 * @returns {{ targetFictionalTime: string, durationSeconds: number }}
 */
function resolveTargetTime(sim, input) {
    const currentFictionalTime = sim.current_fictional_time;

    if (input.duration_seconds !== undefined) {
        const dur = Number(input.duration_seconds);
        if (!Number.isInteger(dur) || dur < 0) {
            throw new LwsValidationError('duration_seconds must be a non-negative integer', ['duration_seconds']);
        }
        const ms = new Date(currentFictionalTime).getTime() + (dur * 1000);
        const target = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
        return {
            targetFictionalTime: target,
            durationSeconds: dur,
        };
    }

    if (input.target_fictional_time !== undefined) {
        const target = validateFictionalTimestamp(input.target_fictional_time, 'target_fictional_time');
        if (target < currentFictionalTime) {
            throw new LwsValidationError(
                `target_fictional_time (${target}) cannot precede current simulation fictional time (${currentFictionalTime})`,
                ['target_fictional_time'],
            );
        }
        const dur = Math.floor((new Date(target).getTime() - new Date(currentFictionalTime).getTime()) / 1000);
        return {
            targetFictionalTime: target,
            durationSeconds: dur,
        };
    }

    throw new LwsValidationError(
        'Either target_fictional_time or duration_seconds must be provided',
        ['target_fictional_time', 'duration_seconds'],
    );
}

/**
 * Checks if a character has an upcoming routine requiring departure at currentPoint.
 *
 * @param {object} char
 * @param {Array<object>} routines
 * @param {string} currentPoint
 * @param {Map<number, object>} locationsById
 * @returns {object|null}
 */
function checkUpcomingDeparture(char, routines, currentPoint, locationsById) {
    const currentDate = new Date(currentPoint);
    const dateStr = currentPoint.slice(0, 10);
    const dayIndex = currentDate.getUTCDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[dayIndex];
    const isWeekday = dayIndex >= 1 && dayIndex <= 5;
    const isWeekend = dayIndex === 0 || dayIndex === 6;

    for (const r of routines) {
        if (!r.enabled || !r.target_location_id || r.target_location_id === char.current_location_id) {
            continue;
        }

        const matchesDay = r.day_of_week === 'daily' ||
            (r.day_of_week === 'weekday' && isWeekday) ||
            (r.day_of_week === 'weekend' && isWeekend) ||
            (r.day_of_week === currentDay);
        if (!matchesDay) continue;

        const startIso = `${dateStr}T${r.start_time}Z`;
        const dur = computeTravelDuration(locationsById, char.current_location_id, r.target_location_id);
        if (dur <= 0) continue;

        const depIso = computePlannedDepartureTime(startIso, dur);

        // Departure is due if currentPoint is exactly planned departure,
        // or if insufficient lead time (startIso > currentPoint >= depIso)
        if (currentPoint === depIso || (currentPoint > depIso && currentPoint < startIso)) {
            const eta = computeArrivalTime(currentPoint, dur);
            return {
                routine: r,
                travelDuration: dur,
                departureTime: currentPoint,
                etaTime: eta,
            };
        }
    }
    return null;
}

/**
 * Collects critical timeline points between T_start and T_target across:
 * 1. Pending scheduled events (scheduled_fictional_time <= T_target)
 * 2. Active travel ETAs
 * 3. Routine boundaries and planned travel departures
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} sim
 * @param {string} startFictionalTime
 * @param {string} targetFictionalTime
 * @param {Map<number, object>} locationsById
 * @returns {Array<string>} Sorted unique list of ISO timestamps
 */
function discoverCriticalTimelinePoints(db, sim, startFictionalTime, targetFictionalTime, locationsById) {
    const points = new Set();
    points.add(targetFictionalTime);

    // 1. Scheduled events
    const schedEvents = db.prepare(`
        SELECT scheduled_fictional_time FROM lws_scheduled_events
        WHERE simulation_id = ? AND status = 'pending'
          AND scheduled_fictional_time <= ?
    `).all(sim.id, targetFictionalTime);

    for (const se of schedEvents) {
        if (se.scheduled_fictional_time > startFictionalTime) {
            points.add(se.scheduled_fictional_time);
        }
    }

    // 2. Active character states, routines and travel
    const characters = db.prepare(`
        SELECT sc.*, loc.lws_id AS location_lws_id
        FROM lws_simulation_characters sc
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
    `).all(sim.id);

    const startDate = new Date(startFictionalTime);
    const targetDate = new Date(targetFictionalTime);

    for (const char of characters) {
        const runtimeState = safeJsonParse(char.runtime_state, {});
        // Active travel ETA
        if (runtimeState.travel?.status === 'in_transit' && runtimeState.travel.eta_time) {
            const eta = runtimeState.travel.eta_time;
            if (eta > startFictionalTime && eta <= targetFictionalTime) {
                points.add(eta);
            }
        }

        // Routines for this character
        const routines = db.prepare(`
            SELECT r.*, loc.lws_id AS target_location_lws_id
            FROM lws_simulation_character_routines r
            LEFT JOIN lws_locations loc ON r.target_location_id = loc.id
            WHERE r.simulation_character_id = ? AND r.deleted_at IS NULL AND r.enabled = 1
        `).all(char.id);

        if (routines.length === 0) continue;

        // Iterate over calendar days from start to target (up to 30 days max scan)
        const currentScan = new Date(startDate.getTime());
        // Set to midnight UTC of the start day
        currentScan.setUTCHours(0, 0, 0, 0);

        while (currentScan <= targetDate) {
            const dateStr = currentScan.toISOString().slice(0, 10); // YYYY-MM-DD
            const dayIndex = currentScan.getUTCDay();
            const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const currentDay = dayNames[dayIndex];
            const isWeekday = dayIndex >= 1 && dayIndex <= 5;
            const isWeekend = dayIndex === 0 || dayIndex === 6;

            for (const r of routines) {
                const matchesDay = r.day_of_week === 'daily' ||
                    (r.day_of_week === 'weekday' && isWeekday) ||
                    (r.day_of_week === 'weekend' && isWeekend) ||
                    (r.day_of_week === currentDay);
                if (!matchesDay) continue;

                const startIso = `${dateStr}T${r.start_time}Z`;
                const endIso = `${dateStr}T${r.end_time}Z`;

                // Routine start
                if (startIso > startFictionalTime && startIso <= targetFictionalTime) {
                    points.add(startIso);
                }

                // Planned travel departure
                if (r.target_location_id && r.target_location_id !== char.current_location_id) {
                    const dur = computeTravelDuration(locationsById, char.current_location_id, r.target_location_id);
                    if (dur > 0) {
                        const depIso = computePlannedDepartureTime(startIso, dur);
                        if (depIso > startFictionalTime && depIso <= targetFictionalTime) {
                            points.add(depIso);
                        }
                        if (depIso <= startFictionalTime && startIso > startFictionalTime) {
                            // Insufficient lead time: dynamic arrival ETA
                            const dynEta = computeArrivalTime(startFictionalTime, dur);
                            if (dynEta > startFictionalTime && dynEta <= targetFictionalTime) {
                                points.add(dynEta);
                            }
                        }
                    }
                }

                // Routine end
                if (endIso > startFictionalTime && endIso <= targetFictionalTime) {
                    points.add(endIso);
                }
            }

            // Advance one day
            currentScan.setUTCDate(currentScan.getUTCDate() + 1);
        }
    }

    return Array.from(points).sort();
}

/**
 * Advances the simulation clock to target_fictional_time, resolving routines,
 * travel arrivals/departures, and scheduled events along the critical timeline.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @param {string} params.simLwsId
 * @param {string} [params.targetFictionalTime]
 * @param {number} [params.durationSeconds]
 * @param {string} [params.expectedFictionalTime]
 * @param {string} [params.provenance='user']
 * @returns {Promise<object>} DTO containing final simulation clock and intermediate event list
 */
export async function advanceFictionalTime(db, {
    simLwsId,
    targetFictionalTime: rawTargetTime,
    durationSeconds: rawDuration,
    expectedFictionalTime,
    provenance = 'user',
}) {
    return simulationLocks.withLock(simLwsId, async () => {
        const sim = ensureActiveSimulation(db, simLwsId);

        if (expectedFictionalTime !== undefined && expectedFictionalTime !== null) {
            if (expectedFictionalTime !== sim.current_fictional_time) {
                throw new LwsConflictError(
                    `Simulation clock has advanced (clock drift detected). Expected: ${expectedFictionalTime}, Current: ${sim.current_fictional_time}`,
                );
            }
        }

        const { targetFictionalTime, durationSeconds } = resolveTargetTime(sim, {
            target_fictional_time: rawTargetTime,
            duration_seconds: rawDuration,
        });

        const startFictionalTime = sim.current_fictional_time;

        // Cache world locations
        const locations = db.prepare('SELECT * FROM lws_locations WHERE world_id = ?').all(sim.world_id);
        const locationsById = new Map(locations.map(l => [l.id, l]));
        const locationsByLwsId = new Map(locations.map(l => [l.lws_id, l]));

        // Gather critical timeline points
        let criticalPoints = [];
        if (targetFictionalTime === startFictionalTime) {
            criticalPoints = [startFictionalTime];
        } else {
            criticalPoints = discoverCriticalTimelinePoints(db, sim, startFictionalTime, targetFictionalTime, locationsById);
        }

        const callerContext = {
            isTimeAdvance: true,
            startFictionalTime,
            targetFictionalTime,
            isInternalEngine: true,
            isDedicatedRoute: true,
        };

        const intermediateEvents = [];
        let rootEvent = null;

        // Execute all state changes and event commits within an atomic SQLite transaction
        const advanceTransaction = db.transaction(() => {
            for (const currentPoint of criticalPoints) {
                // 1. Process Travel Arrivals at currentPoint
                const travelingChars = db.prepare(`
                    SELECT sc.*, loc.lws_id AS location_lws_id
                    FROM lws_simulation_characters sc
                    LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
                    WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
                `).all(sim.id);

                for (const char of travelingChars) {
                    const runtimeState = safeJsonParse(char.runtime_state, {});
                    if (runtimeState.travel?.status === 'in_transit') {
                        const physicalCond = String(char.physical_condition || '').toLowerCase().trim();
                        const isSevere = ['unconscious', 'comatose', 'critically_injured', 'incapacitated', 'paralyzed', 'dying', 'dead'].includes(physicalCond);
                        if (isSevere) {
                            const etaMs = new Date(runtimeState.travel.eta_time).getTime();
                            const currMs = new Date(currentPoint).getTime();
                            const remainingSeconds = Math.max(0, Math.floor((etaMs - currMs) / 1000));

                            const suspendEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: {
                                    patch: {
                                        travel: {
                                            ...runtimeState.travel,
                                            status: 'suspended',
                                            suspended_at: currentPoint,
                                            remaining_seconds: remainingSeconds,
                                        },
                                    },
                                },
                            }, callerContext);
                            intermediateEvents.push(suspendEv);

                            const actEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: { activity: char.physical_condition },
                            }, callerContext);
                            intermediateEvents.push(actEv);
                            continue;
                        }

                        if (runtimeState.travel.eta_time <= currentPoint) {
                            const travel = runtimeState.travel;
                            const destLoc = locationsByLwsId.get(travel.destination_location_id);
                            if (destLoc) {
                                // MOVE_CHARACTER
                                const moveEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.MOVE_CHARACTER,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    location_id: travel.destination_location_id,
                                    payload: {
                                        reason: 'travel_arrival',
                                        origin_location_id: travel.origin_location_id,
                                    },
                                }, callerContext);
                                intermediateEvents.push(moveEv);

                                // Clear travel in runtime state
                                const clearTravelEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: {
                                        patch: { travel: null },
                                    },
                                }, callerContext);
                                intermediateEvents.push(clearTravelEv);

                                // UPDATE_CHARACTER_ACTIVITY to destination activity
                                const nextActivity = travel.destination_routine_activity || 'idle';
                                const actEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: { activity: nextActivity },
                                }, callerContext);
                                intermediateEvents.push(actEv);
                            }
                        }
                    }
                }

                // 2. Process Scheduled Events at currentPoint
                const dueSchedEvents = db.prepare(`
                    SELECT * FROM lws_scheduled_events
                    WHERE simulation_id = ? AND status = 'pending' AND scheduled_fictional_time = ?
                    ORDER BY scheduled_fictional_time ASC, title ASC, id ASC
                `).all(sim.id, currentPoint);

                for (const se of dueSchedEvents) {
                    const triggerEv = internalCommitEvent(db, sim, {
                        event_type: EVENT_TYPES.TRIGGER_SCHEDULED_EVENT,
                        fictional_time: currentPoint,
                        payload: {
                            scheduled_event_id: se.lws_id,
                            trigger_details: { triggered_at: currentPoint },
                        },
                    }, callerContext);
                    intermediateEvents.push(triggerEv);
                }

                // 3. Process Routine Boundaries and Travel Departures at currentPoint
                const activeChars = db.prepare(`
                    SELECT sc.*, loc.lws_id AS location_lws_id
                    FROM lws_simulation_characters sc
                    LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
                    WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
                    ORDER BY sc.lws_id ASC
                `).all(sim.id);

                for (const char of activeChars) {
                    const routines = db.prepare(`
                        SELECT r.*, loc.lws_id AS target_location_lws_id
                        FROM lws_simulation_character_routines r
                        LEFT JOIN lws_locations loc ON r.target_location_id = loc.id
                        WHERE r.simulation_character_id = ? AND r.deleted_at IS NULL
                    `).all(char.id);

                    const runtimeState = safeJsonParse(char.runtime_state, {});

                    // Check travel interruption / resumption
                    if (runtimeState.travel?.status === 'suspended') {
                        // Check if physical condition has cleared
                        const physicalCond = String(char.physical_condition || '').toLowerCase().trim();
                        const isSevere = ['unconscious', 'comatose', 'critically_injured', 'incapacitated', 'paralyzed', 'dying', 'dead'].includes(physicalCond);
                        if (!isSevere) {
                            const remSecs = runtimeState.travel.remaining_seconds || 300;
                            const newEta = computeArrivalTime(currentPoint, remSecs);

                            // Check if destination routine is still active at newEta
                            const isStillActive = routines.some(r => r.activity === runtimeState.travel.destination_routine_activity && matchesRoutineTime(r, newEta));

                            if (!isStillActive && runtimeState.travel.destination_routine_activity) {
                                // Routine has expired: cancel travel and fall through to local arbitration
                                const cancelEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: {
                                        patch: { travel: null },
                                    },
                                }, callerContext);
                                intermediateEvents.push(cancelEv);
                                runtimeState.travel = null;
                            } else {
                                // Resume travel
                                const resumeEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: {
                                        patch: {
                                            travel: {
                                                ...runtimeState.travel,
                                                status: 'in_transit',
                                                departure_time: currentPoint,
                                                eta_time: newEta,
                                                resumed_at: currentPoint,
                                            },
                                        },
                                    },
                                }, callerContext);
                                intermediateEvents.push(resumeEv);

                                const actEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: { activity: 'travelling' },
                                }, callerContext);
                                intermediateEvents.push(actEv);
                                continue;
                            }
                        }
                    }

                    // Check planned travel departures for upcoming routines
                    if (runtimeState.travel?.status !== 'in_transit') {
                        const departure = checkUpcomingDeparture(char, routines, currentPoint, locationsById);
                        if (departure) {
                            const startTravelEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: {
                                    patch: {
                                        travel: {
                                            origin_location_id: char.location_lws_id,
                                            destination_location_id: departure.routine.target_location_lws_id,
                                            departure_time: departure.departureTime,
                                            eta_time: departure.etaTime,
                                            travel_duration_seconds: departure.travelDuration,
                                            status: 'in_transit',
                                            destination_routine_activity: departure.routine.activity,
                                        },
                                    },
                                },
                            }, callerContext);
                            intermediateEvents.push(startTravelEv);

                            const actEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: { activity: 'travelling' },
                            }, callerContext);
                            intermediateEvents.push(actEv);
                            continue;
                        }
                    }

                    const arbitration = arbitrateCharacterActivity(char, routines, currentPoint);

                    if (arbitration.tier === 'ROUTINE') {
                        const targetLocInternalId = arbitration.routine.target_location_id;
                        const targetLocLwsId = arbitration.routine.target_location_lws_id;

                        // Check if routine requires travel
                        if (targetLocInternalId && targetLocInternalId !== char.current_location_id && runtimeState.travel?.status !== 'in_transit') {
                            const travelDuration = computeTravelDuration(locationsById, char.current_location_id, targetLocInternalId);
                            if (travelDuration > 0) {
                                const eta = computeArrivalTime(currentPoint, travelDuration);

                                const startTravelEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: {
                                        patch: {
                                            travel: {
                                                origin_location_id: char.location_lws_id,
                                                destination_location_id: targetLocLwsId,
                                                departure_time: currentPoint,
                                                eta_time: eta,
                                                travel_duration_seconds: travelDuration,
                                                status: 'in_transit',
                                                destination_routine_activity: arbitration.routine.activity,
                                            },
                                        },
                                    },
                                }, callerContext);
                                intermediateEvents.push(startTravelEv);

                                const actEv = internalCommitEvent(db, sim, {
                                    event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                    fictional_time: currentPoint,
                                    actor_character_id: char.lws_id,
                                    payload: { activity: 'travelling' },
                                }, callerContext);
                                intermediateEvents.push(actEv);
                                continue;
                            }
                        }

                        // Same location routine activity update
                        if (char.activity !== arbitration.activity && runtimeState.travel?.status !== 'in_transit') {
                            const actEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: { activity: arbitration.activity },
                            }, callerContext);
                            intermediateEvents.push(actEv);
                        }
                    } else if (arbitration.tier === 'IDLE') {
                        if (char.activity !== 'idle' && runtimeState.travel?.status !== 'in_transit') {
                            const actEv = internalCommitEvent(db, sim, {
                                event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                                fictional_time: currentPoint,
                                actor_character_id: char.lws_id,
                                payload: { activity: 'idle' },
                            }, callerContext);
                            intermediateEvents.push(actEv);
                        }
                    }
                }
            }

            // 4. Zero-Duration Idempotence Evaluation (Section 9.3)
            if (durationSeconds === 0 && intermediateEvents.length === 0) {
                // Fully idempotent zero-duration advance: Zero ledger mutations!
                return;
            }

            // 5. Append Root TIME_ADVANCE Event
            rootEvent = internalCommitEvent(db, sim, {
                event_type: EVENT_TYPES.TIME_ADVANCE,
                fictional_time: targetFictionalTime,
                provenance,
                payload: {
                    start_fictional_time: startFictionalTime,
                    target_fictional_time: targetFictionalTime,
                    duration_seconds: durationSeconds,
                    intermediate_event_count: intermediateEvents.length,
                },
            }, {
                isTimeAdvance: true,
                startFictionalTime,
                targetFictionalTime,
                isDedicatedRoute: true,
            });
        });

        advanceTransaction();

        // Return updated canonical state representation
        const updatedSim = ensureActiveSimulation(db, simLwsId);

        return {
            simulation_id: simLwsId,
            start_fictional_time: startFictionalTime,
            current_fictional_time: updatedSim.current_fictional_time,
            duration_seconds: durationSeconds,
            intermediate_event_count: intermediateEvents.length,
            intermediate_events: intermediateEvents,
            root_event: rootEvent,
        };
    });
}
