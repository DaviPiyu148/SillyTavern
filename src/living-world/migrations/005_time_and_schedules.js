/**
 * Living World Simulator (LWS) - Migration 005: Fictional Time, Schedules, Routines, and Travel
 *
 * Establishes Phase 5 temporal progression, routines, world events, and travel mechanics:
 * - 2 tables: lws_simulation_character_routines, lws_scheduled_events
 * - Exactly 9 database triggers (1 evolved ledger trigger + 4 routine triggers + 4 scheduled-event triggers)
 *   enforcing sequence continuity, chronological monotonicity, routine ownership immutability,
 *   soft-deleted location protection, reciprocal supersession integrity, predecessor pending revalidation,
 *   terminal row immutability, and physical deletion prevention
 * - Exactly 4 indexes for scheduled-event temporal queries, status filtering, and character routine lookups
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- ====================================================================
        -- 1. Evolve static clock trigger to consolidated sequence-monotonic trigger
        -- ====================================================================
        DROP TRIGGER IF EXISTS trg_lws_events_fictional_time_matches_sim;

        CREATE TRIGGER IF NOT EXISTS trg_lws_events_monotonic_and_sequence
        BEFORE INSERT ON lws_events
        BEGIN
            -- Base clock check: event cannot precede simulation current clock
            SELECT RAISE(ABORT, 'event fictional_time cannot precede simulation current_fictional_time')
            WHERE NEW.fictional_time < (SELECT current_fictional_time FROM lws_simulations WHERE id = NEW.simulation_id);

            -- Sequence gap elimination: sequence_number must equal next expected integer
            SELECT RAISE(ABORT, 'event sequence_number must equal next expected sequence number (no gaps or duplicates)')
            WHERE NEW.sequence_number != (
                SELECT COALESCE(MAX(sequence_number), 0) + 1
                FROM lws_events
                WHERE simulation_id = NEW.simulation_id
            );

            -- Sequence timestamp monotonicity: sequence N cannot precede sequence N-1
            SELECT RAISE(ABORT, 'event fictional_time cannot precede preceding sequence event fictional_time')
            WHERE NEW.sequence_number > 1
              AND NEW.fictional_time < (
                  SELECT fictional_time FROM lws_events
                  WHERE simulation_id = NEW.simulation_id AND sequence_number = NEW.sequence_number - 1
              );
        END;

        -- ====================================================================
        -- 2. Character Routines Projection Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_simulation_character_routines (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            block_id                    TEXT    NOT NULL,
            day_of_week                 TEXT    NOT NULL CHECK(day_of_week IN (
                                            'daily', 'weekday', 'weekend',
                                            'monday', 'tuesday', 'wednesday',
                                            'thursday', 'friday', 'saturday', 'sunday'
                                        )),
            start_time                  TEXT    NOT NULL CHECK(
                                            (start_time GLOB '[0-1][0-9]:[0-5][0-9]:[0-5][0-9]' OR start_time GLOB '2[0-3]:[0-5][0-9]:[0-5][0-9]')
                                        ),
            end_time                    TEXT    NOT NULL CHECK(
                                            (end_time GLOB '[0-1][0-9]:[0-5][0-9]:[0-5][0-9]' OR end_time GLOB '2[0-3]:[0-5][0-9]:[0-5][0-9]')
                                        ),
            activity                    TEXT    NOT NULL,
            target_location_id          INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            priority                    INTEGER NOT NULL DEFAULT 50 CHECK(priority >= 1 AND priority <= 100),
            flexibility                 TEXT    NOT NULL DEFAULT 'flexible' CHECK(flexibility IN ('strict', 'flexible', 'optional')),
            enabled                     INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL,
            UNIQUE(simulation_character_id, block_id, day_of_week)
        );

        -- ====================================================================
        -- 3. Scheduled World Events Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_scheduled_events (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            scheduled_fictional_time    TEXT    NOT NULL,
            title                       TEXT    NOT NULL,
            description                 TEXT    NOT NULL DEFAULT '',
            target_location_id          INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            payload                     TEXT    NOT NULL DEFAULT '{}',
            status                      TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'triggered', 'cancelled', 'superseded')),
            supersedes_event_id         INTEGER DEFAULT NULL REFERENCES lws_scheduled_events(id),
            superseded_by_event_id      INTEGER DEFAULT NULL REFERENCES lws_scheduled_events(id),
            trigger_event_id            INTEGER DEFAULT NULL REFERENCES lws_events(id),
            cancel_event_id             INTEGER DEFAULT NULL REFERENCES lws_events(id),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL
        );

        -- ====================================================================
        -- Triggers: Character Routines (Exactly 4 Triggers)
        -- ====================================================================

        -- Routine Trigger 1: Routine identity immutable (simulation_id and character ownership)
        CREATE TRIGGER IF NOT EXISTS trg_lws_routines_identity_immutable
        BEFORE UPDATE ON lws_simulation_character_routines
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_simulation_character_routines')
            WHERE NEW.simulation_id != OLD.simulation_id;

            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_simulation_character_routines')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
        END;

        -- Routine Trigger 2: Insert integrity (character same simulation, location same world & not deleted)
        CREATE TRIGGER IF NOT EXISTS trg_lws_routines_insert_integrity
        BEFORE INSERT ON lws_simulation_character_routines
        BEGIN
            SELECT RAISE(ABORT, 'character must belong to the same simulation as the routine')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) IS NOT NEW.simulation_id;

            SELECT RAISE(ABORT, 'routine target location must belong to simulation world and not be soft-deleted')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id AND deleted_at IS NULL) IS NOT
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);
        END;

        -- Routine Trigger 3: Location update integrity (same world and not soft-deleted)
        CREATE TRIGGER IF NOT EXISTS trg_lws_routines_update_location
        BEFORE UPDATE OF target_location_id ON lws_simulation_character_routines
        WHEN NEW.target_location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'routine target location must belong to simulation world and not be soft-deleted')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id AND deleted_at IS NULL) IS NOT
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);
        END;

        -- Routine Trigger 4: No physical delete (soft deletion only)
        CREATE TRIGGER IF NOT EXISTS trg_lws_routines_no_delete
        BEFORE DELETE ON lws_simulation_character_routines
        BEGIN
            SELECT RAISE(ABORT, 'routine rows cannot be physically deleted; use soft deletion');
        END;

        -- ====================================================================
        -- Triggers: Scheduled Events (Exactly 4 Triggers)
        -- ====================================================================

        -- Scheduled Event Trigger 1: Terminal immutability
        CREATE TRIGGER IF NOT EXISTS trg_lws_sched_events_terminal_immutable
        BEFORE UPDATE ON lws_scheduled_events
        WHEN OLD.status IN ('triggered', 'cancelled', 'superseded')
        BEGIN
            SELECT RAISE(ABORT, 'terminal scheduled event rows are immutable');
        END;

        -- Scheduled Event Trigger 2: Insert integrity (location, reciprocal supersession, trigger/cancel)
        CREATE TRIGGER IF NOT EXISTS trg_lws_sched_events_insert_integrity
        BEFORE INSERT ON lws_scheduled_events
        BEGIN
            -- Location guard
            SELECT RAISE(ABORT, 'scheduled event location must belong to simulation world and not be soft-deleted')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id AND deleted_at IS NULL) IS NOT
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);

            -- Self-supersession on insert (if id supplied)
            SELECT RAISE(ABORT, 'scheduled event cannot supersede itself')
            WHERE (NEW.supersedes_event_id IS NOT NULL AND NEW.id IS NOT NULL AND NEW.supersedes_event_id = NEW.id)
               OR (NEW.superseded_by_event_id IS NOT NULL AND NEW.id IS NOT NULL AND NEW.superseded_by_event_id = NEW.id);

            -- Successor insert: predecessor supersedes_event_id checks
            SELECT RAISE(ABORT, 'predecessor scheduled event must belong to the same simulation')
            WHERE NEW.supersedes_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT NEW.simulation_id;

            SELECT RAISE(ABORT, 'predecessor scheduled event must be in pending status')
            WHERE NEW.supersedes_event_id IS NOT NULL
              AND (SELECT status FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT 'pending';

            SELECT RAISE(ABORT, 'predecessor scheduled event has already been superseded')
            WHERE NEW.supersedes_event_id IS NOT NULL
              AND (SELECT superseded_by_event_id FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT NULL;

            -- Direct insert with superseded_by_event_id or status = 'superseded':
            SELECT RAISE(ABORT, 'superseded scheduled event must have status superseded')
            WHERE NEW.superseded_by_event_id IS NOT NULL AND NEW.status != 'superseded';

            SELECT RAISE(ABORT, 'superseded scheduled event must reference successor in superseded_by_event_id')
            WHERE NEW.status = 'superseded' AND NEW.superseded_by_event_id IS NULL;

            SELECT RAISE(ABORT, 'successor scheduled event must belong to the same simulation')
            WHERE NEW.superseded_by_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_scheduled_events WHERE id = NEW.superseded_by_event_id) IS NOT NEW.simulation_id;

            SELECT RAISE(ABORT, 'successor scheduled event must have supersedes_event_id pointing to this event')
            WHERE NEW.superseded_by_event_id IS NOT NULL AND NEW.id IS NOT NULL
              AND (SELECT supersedes_event_id FROM lws_scheduled_events WHERE id = NEW.superseded_by_event_id) IS NOT NEW.id;

            -- Trigger event same simulation guard
            SELECT RAISE(ABORT, 'trigger_event must belong to the same simulation')
            WHERE NEW.trigger_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.trigger_event_id) IS NOT NEW.simulation_id;

            -- Cancel event same simulation guard
            SELECT RAISE(ABORT, 'cancel_event must belong to the same simulation')
            WHERE NEW.cancel_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.cancel_event_id) IS NOT NEW.simulation_id;
        END;

        -- Scheduled Event Trigger 3: Update integrity (sim immutable, location, self-supersession, revalidation, reciprocal check, events)
        CREATE TRIGGER IF NOT EXISTS trg_lws_sched_events_update_integrity
        BEFORE UPDATE ON lws_scheduled_events
        BEGIN
            -- Simulation ID immutable
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_scheduled_events')
            WHERE NEW.simulation_id != OLD.simulation_id;

            -- Location guard on update
            SELECT RAISE(ABORT, 'scheduled event location must belong to simulation world and not be soft-deleted')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id AND deleted_at IS NULL) IS NOT
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);

            -- Self-supersession check
            SELECT RAISE(ABORT, 'scheduled event cannot supersede itself')
            WHERE (NEW.supersedes_event_id IS NOT NULL AND NEW.supersedes_event_id = NEW.id)
               OR (NEW.superseded_by_event_id IS NOT NULL AND NEW.superseded_by_event_id = NEW.id);

            -- Established supersedes_event_id relationship is immutable once set
            SELECT RAISE(ABORT, 'established supersedes_event_id relationship is immutable')
            WHERE OLD.supersedes_event_id IS NOT NULL
              AND (NEW.supersedes_event_id IS NULL OR NEW.supersedes_event_id != OLD.supersedes_event_id);

            -- When establishing supersedes_event_id (from NULL to non-NULL):
            SELECT RAISE(ABORT, 'predecessor scheduled event must belong to the same simulation')
            WHERE OLD.supersedes_event_id IS NULL AND NEW.supersedes_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT NEW.simulation_id;

            SELECT RAISE(ABORT, 'predecessor scheduled event must be in pending status')
            WHERE OLD.supersedes_event_id IS NULL AND NEW.supersedes_event_id IS NOT NULL
              AND (SELECT status FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT 'pending';

            SELECT RAISE(ABORT, 'predecessor scheduled event has already been superseded')
            WHERE OLD.supersedes_event_id IS NULL AND NEW.supersedes_event_id IS NOT NULL
              AND (SELECT superseded_by_event_id FROM lws_scheduled_events WHERE id = NEW.supersedes_event_id) IS NOT NULL;

            -- Reciprocal check when setting superseded_by_event_id:
            -- 1) status must be updated to superseded
            SELECT RAISE(ABORT, 'superseded scheduled event must have status superseded')
            WHERE NEW.superseded_by_event_id IS NOT NULL AND NEW.status != 'superseded';

            SELECT RAISE(ABORT, 'superseded scheduled event must reference successor in superseded_by_event_id')
            WHERE NEW.status = 'superseded' AND NEW.superseded_by_event_id IS NULL;

            -- 2) successor must belong to same simulation
            SELECT RAISE(ABORT, 'successor scheduled event must belong to the same simulation')
            WHERE NEW.superseded_by_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_scheduled_events WHERE id = NEW.superseded_by_event_id) IS NOT NEW.simulation_id;

            -- 3) reciprocal pointer: successor must point back to this event
            SELECT RAISE(ABORT, 'successor scheduled event must have supersedes_event_id pointing to this event')
            WHERE NEW.superseded_by_event_id IS NOT NULL
              AND (SELECT supersedes_event_id FROM lws_scheduled_events WHERE id = NEW.superseded_by_event_id) IS NOT NEW.id;

            -- Trigger event same simulation guard
            SELECT RAISE(ABORT, 'trigger_event must belong to the same simulation')
            WHERE NEW.trigger_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.trigger_event_id) IS NOT NEW.simulation_id;

            -- Cancel event same simulation guard
            SELECT RAISE(ABORT, 'cancel_event must belong to the same simulation')
            WHERE NEW.cancel_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.cancel_event_id) IS NOT NEW.simulation_id;
        END;

        -- Scheduled Event Trigger 4: No physical delete
        CREATE TRIGGER IF NOT EXISTS trg_lws_sched_events_no_delete
        BEFORE DELETE ON lws_scheduled_events
        BEGIN
            SELECT RAISE(ABORT, 'scheduled event rows cannot be physically deleted');
        END;

        -- ====================================================================
        -- Indexes (Migration 005: Exactly 4 Indexes)
        -- ====================================================================

        -- 1. Pending scheduled events by simulation and time (for fast clock-advance lookup)
        CREATE INDEX IF NOT EXISTS idx_lws_sched_events_sim_time
        ON lws_scheduled_events(simulation_id, scheduled_fictional_time)
        WHERE status = 'pending';

        -- 2. Scheduled events status filter
        CREATE INDEX IF NOT EXISTS idx_lws_sched_events_sim_status
        ON lws_scheduled_events(simulation_id, status);

        -- 3. Active routines by character
        CREATE INDEX IF NOT EXISTS idx_lws_routines_sim_char
        ON lws_simulation_character_routines(simulation_id, simulation_character_id)
        WHERE deleted_at IS NULL;

        -- 4. Routine lookup by day and time
        CREATE INDEX IF NOT EXISTS idx_lws_routines_lookup
        ON lws_simulation_character_routines(simulation_character_id, day_of_week, start_time)
        WHERE deleted_at IS NULL;
    `);
}
