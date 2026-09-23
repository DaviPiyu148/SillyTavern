/**
 * Living World Simulator (LWS) - Migration 004: Events, Authority, and State Transitions
 *
 * Establishes Phase 4 authoritative event storage and narrative turn auditing:
 * - 2 tables: lws_narrative_turns, lws_events
 * - Exactly 16 database triggers enforcing immutability, deletion prevention,
 *   same-simulation integrity (actor, target, causal, turn), same-world integrity (authored, location),
 *   static fictional-time clock lock, and event-specific actor constraints
 * - Exactly 7 indexes for sequence ordering, fictional-time queries, actor filtering,
 *   idempotency deduplication, and turn lookups
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- 1. Narrative Turn Audit Table
        CREATE TABLE IF NOT EXISTS lws_narrative_turns (
            id                  INTEGER PRIMARY KEY,
            lws_id              TEXT    UNIQUE NOT NULL,
            simulation_id       INTEGER NOT NULL REFERENCES lws_simulations(id),
            turn_number         INTEGER NOT NULL,
            user_input          TEXT    DEFAULT NULL,
            raw_model_output    TEXT    DEFAULT NULL,
            parsed_narrative    TEXT    DEFAULT NULL,
            model_info          TEXT    NOT NULL DEFAULT '{}',
            status              TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'committed', 'rejected', 'failed')),
            error_details       TEXT    DEFAULT NULL,
            created_at          TEXT    NOT NULL,
            updated_at          TEXT    NOT NULL
        );

        -- 2. Authoritative Event Ledger Table
        CREATE TABLE IF NOT EXISTS lws_events (
            id                      INTEGER PRIMARY KEY,
            lws_id                  TEXT    UNIQUE NOT NULL,
            simulation_id           INTEGER NOT NULL REFERENCES lws_simulations(id),
            sequence_number         INTEGER NOT NULL CHECK(sequence_number > 0),
            event_type              TEXT    NOT NULL CHECK(event_type IN (
                                        'SIMULATION_START', 'SIMULATION_PAUSE', 'SIMULATION_RESUME', 'SIMULATION_STOP',
                                        'TRIGGER_SCHEDULED_EVENT', 'SCHEDULE_WORLD_EVENT', 'CANCEL_SCHEDULED_EVENT',
                                        'SUPERSEDE_SCHEDULED_EVENT', 'UPDATE_CHARACTER_ROUTINE', 'MOVE_CHARACTER',
                                        'UPDATE_CHARACTER_ACTIVITY', 'UPDATE_PHYSICAL_CONDITION', 'UPDATE_RUNTIME_STATE',
                                        'CHARACTER_JOIN', 'CHARACTER_LEAVE', 'DIRECTOR_MODIFY_STATE', 'DIRECTOR_NOTE',
                                        'DIRECTOR_INSPECT', 'COMMUNICATE', 'INTERACT_OBJECT', 'EMOTE', 'OBSERVE',
                                        'GENERAL_ACTION', 'REST', 'WORK', 'CONSUME_ITEM', 'TRANSFER_ITEM',
                                        'COMBAT_ACTION', 'TIME_ADVANCE'
                                    )),
            fictional_time          TEXT    NOT NULL,
            actor_character_id      INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id),
            target_character_id     INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id),
            authored_character_id   INTEGER DEFAULT NULL REFERENCES lws_characters(id),
            location_id             INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            payload                 TEXT    NOT NULL DEFAULT '{}',
            provenance              TEXT    NOT NULL CHECK(provenance IN ('user', 'director', 'simulation_engine', 'llm_proposal', 'system')),
            causal_event_id         INTEGER DEFAULT NULL REFERENCES lws_events(id),
            turn_id                 INTEGER DEFAULT NULL REFERENCES lws_narrative_turns(id),
            idempotency_key         TEXT    DEFAULT NULL,
            created_at              TEXT    NOT NULL
        );

        -- ====================================================================
        -- Database Triggers (Exactly 16 triggers)
        -- ====================================================================

        -- 1. All rows in lws_events are strictly immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_immutable_all
        BEFORE UPDATE ON lws_events
        BEGIN
            SELECT RAISE(ABORT, 'lws_events rows are strictly immutable');
        END;

        -- 2. Rows in lws_events cannot be deleted (append-only ledger)
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_no_delete
        BEFORE DELETE ON lws_events
        BEGIN
            SELECT RAISE(ABORT, 'lws_events rows cannot be deleted');
        END;

        -- 3. Actor character must belong to the same simulation as the event
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_same_sim_actor
        BEFORE INSERT ON lws_events
        WHEN NEW.actor_character_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'actor character must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.actor_character_id) != NEW.simulation_id;
        END;

        -- 4. Target character must belong to the same simulation as the event
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_same_sim_target
        BEFORE INSERT ON lws_events
        WHEN NEW.target_character_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'target character must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id) != NEW.simulation_id;
        END;

        -- 5. Authored character must belong to the same parent world as the simulation
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_same_world_authored
        BEFORE INSERT ON lws_events
        WHEN NEW.authored_character_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'authored character must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.authored_character_id) !=
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);
        END;

        -- 6. Location must belong to the same parent world as the simulation
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_same_world_location
        BEFORE INSERT ON lws_events
        WHEN NEW.location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'event location must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.location_id) !=
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);
        END;

        -- 7. Event fictional_time must strictly match current simulation clock in Phase 4
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_fictional_time_matches_sim
        BEFORE INSERT ON lws_events
        BEGIN
            SELECT RAISE(ABORT, 'event fictional_time must match simulation current_fictional_time')
            WHERE NEW.fictional_time != (SELECT current_fictional_time FROM lws_simulations WHERE id = NEW.simulation_id);
        END;

        -- 8. Causal event must belong to same simulation and have strictly smaller sequence number
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_causal_integrity
        BEFORE INSERT ON lws_events
        WHEN NEW.causal_event_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'causal_event must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'causal_event sequence_number must precede event sequence_number')
            WHERE (SELECT sequence_number FROM lws_events WHERE id = NEW.causal_event_id) >= NEW.sequence_number;
        END;

        -- 9. Narrative turn must belong to the same simulation as the event
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_same_sim_turn
        BEFORE INSERT ON lws_events
        WHEN NEW.turn_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'event turn_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_narrative_turns WHERE id = NEW.turn_id) != NEW.simulation_id;
        END;

        -- 10. Actor character is required for character-specific state events
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_char_actor_required
        BEFORE INSERT ON lws_events
        WHEN NEW.event_type IN ('MOVE_CHARACTER', 'UPDATE_CHARACTER_ACTIVITY', 'UPDATE_PHYSICAL_CONDITION', 'UPDATE_RUNTIME_STATE', 'CHARACTER_LEAVE', 'REST', 'WORK', 'CONSUME_ITEM')
          AND NEW.actor_character_id IS NULL
        BEGIN
            SELECT RAISE(ABORT, 'actor_character_id is required for character state events');
        END;

        -- 11. Actor and target are prohibited on SIMULATION_START
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_start_actor_prohibited
        BEFORE INSERT ON lws_events
        WHEN NEW.event_type = 'SIMULATION_START'
          AND (NEW.actor_character_id IS NOT NULL OR NEW.target_character_id IS NOT NULL)
        BEGIN
            SELECT RAISE(ABORT, 'SIMULATION_START cannot have actor or target character');
        END;

        -- 12. authored_character_id is required for CHARACTER_JOIN
        CREATE TRIGGER IF NOT EXISTS trg_lws_events_join_authored_required
        BEFORE INSERT ON lws_events
        WHEN NEW.event_type = 'CHARACTER_JOIN'
          AND NEW.authored_character_id IS NULL
        BEGIN
            SELECT RAISE(ABORT, 'authored_character_id is required for CHARACTER_JOIN');
        END;

        -- 13. simulation_id is immutable on lws_narrative_turns
        CREATE TRIGGER IF NOT EXISTS trg_lws_narrative_turns_sim_immutable
        BEFORE UPDATE OF simulation_id ON lws_narrative_turns
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_narrative_turns')
            WHERE NEW.simulation_id != OLD.simulation_id;
        END;

        -- 14. turn_number is immutable on lws_narrative_turns
        CREATE TRIGGER IF NOT EXISTS trg_lws_narrative_turns_turn_num_immutable
        BEFORE UPDATE OF turn_number ON lws_narrative_turns
        BEGIN
            SELECT RAISE(ABORT, 'turn_number is immutable on lws_narrative_turns')
            WHERE NEW.turn_number != OLD.turn_number;
        END;

        -- 15. Terminal narrative turn rows are strictly immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_narrative_turns_terminal_immutable
        BEFORE UPDATE ON lws_narrative_turns
        WHEN OLD.status IN ('committed', 'rejected', 'failed')
        BEGIN
            SELECT RAISE(ABORT, 'terminal narrative turn rows are immutable');
        END;

        -- 16. Narrative turn rows cannot be deleted
        CREATE TRIGGER IF NOT EXISTS trg_lws_narrative_turns_no_delete
        BEFORE DELETE ON lws_narrative_turns
        BEGIN
            SELECT RAISE(ABORT, 'narrative turn rows cannot be deleted');
        END;

        -- ====================================================================
        -- Database Indexes (Exactly 7 indexes)
        -- ====================================================================

        -- 1. Unique monotonic sequence number per simulation
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_events_sim_seq
        ON lws_events(simulation_id, sequence_number);

        -- 2. Fictional time and sequence ordering per simulation
        CREATE INDEX IF NOT EXISTS idx_lws_events_sim_time
        ON lws_events(simulation_id, fictional_time, sequence_number);

        -- 3. Actor character filter
        CREATE INDEX IF NOT EXISTS idx_lws_events_actor
        ON lws_events(actor_character_id) WHERE actor_character_id IS NOT NULL;

        -- 4. Authored character join filter
        CREATE INDEX IF NOT EXISTS idx_lws_events_authored_char
        ON lws_events(authored_character_id) WHERE authored_character_id IS NOT NULL;

        -- 5. Partial unique index for client idempotency keys per simulation
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_events_idempotency
        ON lws_events(simulation_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

        -- 6. Events by turn
        CREATE INDEX IF NOT EXISTS idx_lws_events_turn
        ON lws_events(turn_id) WHERE turn_id IS NOT NULL;

        -- 7. Unique turn number per simulation
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_narrative_turns_sim_turn
        ON lws_narrative_turns(simulation_id, turn_number);
    `);
}
