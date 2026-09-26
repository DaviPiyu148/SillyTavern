/**
 * Living World Simulator (LWS) - Migration 007: Character Cognition and Decisions
 *
 * Establishes Phase 7 cognition, decision-making, and goal architecture:
 * - 5 tables: lws_character_needs, lws_character_goals, lws_character_intentions, lws_character_values, lws_character_emotions
 * - Exactly 15 triggers (3/4/3/3/2 topology) enforcing immutability, simulation integrity, and soft-delete protections
 * - Exactly 10 indexes for goal lookups, client key uniqueness, priority ranking, and emotion indexing
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- ====================================================================
        -- 1. Character Needs Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_needs (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            need_name                   TEXT    NOT NULL CHECK(need_name IN (
                                            'energy', 'nourishment', 'social', 'safety', 'morale'
                                        )),
            satisfaction                INTEGER NOT NULL DEFAULT 100 CHECK(satisfaction >= 0 AND satisfaction <= 100),
            decay_rate                  INTEGER NOT NULL DEFAULT 100 CHECK(decay_rate >= 0 AND decay_rate <= 1000),
            last_evaluated_time         TEXT    NOT NULL,
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            UNIQUE(simulation_character_id, need_name)
        );

        -- ====================================================================
        -- 2. Character Goals Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_goals (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            client_goal_key             TEXT    DEFAULT NULL,
            title                       TEXT    NOT NULL,
            description                 TEXT    NOT NULL DEFAULT '',
            goal_type                   TEXT    NOT NULL CHECK(goal_type IN (
                                            'short_term', 'long_term', 'routine_override', 'acute_need'
                                        )),
            status                      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN (
                                            'active', 'completed', 'suspended', 'abandoned'
                                        )),
            priority                    INTEGER NOT NULL DEFAULT 50,
            urgency                     INTEGER NOT NULL DEFAULT 50 CHECK(urgency >= 1 AND urgency <= 100),
            progress                    INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
            objective_action_type       TEXT    DEFAULT NULL CHECK(objective_action_type IS NULL OR objective_action_type IN (
                                            'MOVE_CHARACTER', 'UPDATE_CHARACTER_ACTIVITY', 'UPDATE_PHYSICAL_CONDITION',
                                            'UPDATE_RUNTIME_STATE', 'COMMUNICATE', 'INTERACT_OBJECT', 'EMOTE',
                                            'OBSERVE', 'GENERAL_ACTION', 'REST', 'WORK', 'CONSUME_ITEM',
                                            'TRANSFER_ITEM', 'COMBAT_ACTION'
                                        )),
            target_location_id          INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            target_character_id         INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id),
            target_object_id            TEXT    DEFAULT NULL,
            deadline_fictional_time     TEXT    DEFAULT NULL,
            causal_event_id             INTEGER DEFAULT NULL REFERENCES lws_events(id),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL,
            CHECK(
                (goal_type IN ('short_term', 'long_term', 'routine_override') AND priority >= 1 AND priority <= 79) OR
                (goal_type = 'acute_need' AND priority >= 80 AND priority <= 100)
            ),
            CHECK(
                (target_location_id IS NULL AND target_character_id IS NULL AND target_object_id IS NULL) OR
                (target_location_id IS NOT NULL AND target_character_id IS NULL AND target_object_id IS NULL) OR
                (target_location_id IS NULL AND target_character_id IS NOT NULL AND target_object_id IS NULL) OR
                (target_location_id IS NULL AND target_character_id IS NULL AND target_object_id IS NOT NULL)
            )
        );

        -- ====================================================================
        -- 3. Character Intentions Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_intentions (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            goal_id                     INTEGER DEFAULT NULL REFERENCES lws_character_goals(id),
            action_type                 TEXT    NOT NULL CHECK(action_type IN (
                                            'MOVE_CHARACTER', 'UPDATE_CHARACTER_ACTIVITY', 'UPDATE_PHYSICAL_CONDITION',
                                            'UPDATE_RUNTIME_STATE', 'COMMUNICATE', 'INTERACT_OBJECT', 'EMOTE',
                                            'OBSERVE', 'GENERAL_ACTION', 'REST', 'WORK', 'CONSUME_ITEM',
                                            'TRANSFER_ITEM', 'COMBAT_ACTION'
                                        )),
            target_entity_type          TEXT    NOT NULL CHECK(target_entity_type IN (
                                            'character', 'location', 'object', 'none'
                                        )),
            target_entity_id            TEXT    DEFAULT NULL,
            rationale                   TEXT    NOT NULL DEFAULT '',
            status                      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN (
                                            'active', 'executing', 'completed', 'failed', 'cancelled'
                                        )),
            cancellation_reason         TEXT    DEFAULT NULL CHECK(
                                            (status = 'cancelled' AND cancellation_reason IS NOT NULL AND cancellation_reason IN (
                                                'goal_completed', 'goal_suspended', 'goal_abandoned', 'goal_deleted',
                                                'interrupted_by_acute_need', 'preempted_by_higher_priority', 'director_cancelled'
                                            )) OR
                                            (status != 'cancelled' AND cancellation_reason IS NULL)
                                        ),
            failure_reason              TEXT    DEFAULT NULL CHECK(
                                            (status = 'failed' AND failure_reason IS NOT NULL) OR
                                            (status != 'failed' AND failure_reason IS NULL)
                                        ),
            priority                    INTEGER NOT NULL DEFAULT 50 CHECK(priority >= 1 AND priority <= 100),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            CHECK(
                (target_entity_type = 'none' AND target_entity_id IS NULL) OR
                (target_entity_type != 'none' AND target_entity_id IS NOT NULL)
            )
        );

        -- ====================================================================
        -- 4. Character Values Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_values (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            dimension                   TEXT    NOT NULL CHECK(dimension IN (
                                            'honesty', 'courage', 'compassion', 'ambition', 'loyalty', 'curiosity'
                                        )),
            strength                    INTEGER NOT NULL DEFAULT 0 CHECK(strength >= -100 AND strength <= 100),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            UNIQUE(simulation_character_id, dimension)
        );

        -- ====================================================================
        -- 5. Character Emotions Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_emotions (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            dominant_emotion            TEXT    NOT NULL DEFAULT 'neutral' CHECK(dominant_emotion IN (
                                            'neutral', 'joyful', 'fearful', 'angry', 'sad',
                                            'surprised', 'disgusted', 'anxious', 'hopeful'
                                        )),
            intensity                   INTEGER NOT NULL DEFAULT 0 CHECK(intensity >= 0 AND intensity <= 100),
            arousal                     INTEGER NOT NULL DEFAULT 50 CHECK(arousal >= 0 AND arousal <= 100),
            valence                     INTEGER NOT NULL DEFAULT 0 CHECK(valence >= -100 AND valence <= 100),
            last_updated_time           TEXT    NOT NULL,
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            UNIQUE(simulation_character_id),
            CHECK(
                (intensity = 0 AND dominant_emotion = 'neutral' AND arousal = 50 AND valence = 0) OR
                (intensity > 0 AND dominant_emotion != 'neutral')
            )
        );

        -- ====================================================================
        -- Triggers: Needs (3 Triggers)
        -- ====================================================================
        CREATE TRIGGER IF NOT EXISTS trg_lws_needs_identity_immutable
        BEFORE UPDATE ON lws_character_needs
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_needs')
            WHERE NEW.simulation_id != OLD.simulation_id;
            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_needs')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
            SELECT RAISE(ABORT, 'need_name is immutable on lws_character_needs')
            WHERE NEW.need_name != OLD.need_name;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_needs_insert_integrity
        BEFORE INSERT ON lws_character_needs
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_needs_no_delete
        BEFORE DELETE ON lws_character_needs
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_needs is prohibited');
        END;

        -- ====================================================================
        -- Triggers: Goals (4 Triggers)
        -- ====================================================================
        CREATE TRIGGER IF NOT EXISTS trg_lws_goals_identity_immutable
        BEFORE UPDATE ON lws_character_goals
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_goals')
            WHERE NEW.simulation_id != OLD.simulation_id;
            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_goals')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
            SELECT RAISE(ABORT, 'lws_id is immutable on lws_character_goals')
            WHERE NEW.lws_id != OLD.lws_id;
            SELECT RAISE(ABORT, 'client_goal_key is immutable on lws_character_goals')
            WHERE (OLD.client_goal_key IS NULL AND NEW.client_goal_key IS NOT NULL)
               OR (OLD.client_goal_key IS NOT NULL AND NEW.client_goal_key IS NULL)
               OR (OLD.client_goal_key != NEW.client_goal_key);
            SELECT RAISE(ABORT, 'causal_event_id is immutable on lws_character_goals')
            WHERE (OLD.causal_event_id IS NOT NULL AND NEW.causal_event_id != OLD.causal_event_id)
               OR (OLD.causal_event_id IS NULL AND NEW.causal_event_id IS NOT NULL);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_goals_insert_integrity
        BEFORE INSERT ON lws_character_goals
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
            SELECT RAISE(ABORT, 'target_character_id must belong to the same simulation')
            WHERE NEW.target_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id) != NEW.simulation_id;
            SELECT RAISE(ABORT, 'target_location_id must belong to the same world as simulation')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id) != (
                  SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id
              );
            SELECT RAISE(ABORT, 'causal_event_id must belong to the same simulation')
            WHERE NEW.causal_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_goals_update_integrity
        BEFORE UPDATE ON lws_character_goals
        BEGIN
            SELECT RAISE(ABORT, 'target_character_id must belong to the same simulation')
            WHERE NEW.target_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id) != NEW.simulation_id;
            SELECT RAISE(ABORT, 'target_location_id must belong to the same world as simulation')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id) != (
                  SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id
              );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_goals_no_delete
        BEFORE DELETE ON lws_character_goals
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_goals is prohibited; use soft-delete');
        END;

        -- ====================================================================
        -- Triggers: Intentions (3 Triggers)
        -- ====================================================================
        CREATE TRIGGER IF NOT EXISTS trg_lws_intentions_identity_immutable
        BEFORE UPDATE ON lws_character_intentions
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_intentions')
            WHERE NEW.simulation_id != OLD.simulation_id;
            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_intentions')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
            SELECT RAISE(ABORT, 'lws_id is immutable on lws_character_intentions')
            WHERE NEW.lws_id != OLD.lws_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_intentions_insert_integrity
        BEFORE INSERT ON lws_character_intentions
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
            SELECT RAISE(ABORT, 'goal_id must belong to the same character')
            WHERE NEW.goal_id IS NOT NULL
              AND (SELECT simulation_character_id FROM lws_character_goals WHERE id = NEW.goal_id) != NEW.simulation_character_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_intentions_no_delete
        BEFORE DELETE ON lws_character_intentions
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_intentions is prohibited');
        END;

        -- ====================================================================
        -- Triggers: Values (3 Triggers)
        -- ====================================================================
        CREATE TRIGGER IF NOT EXISTS trg_lws_values_identity_immutable
        BEFORE UPDATE ON lws_character_values
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_values')
            WHERE NEW.simulation_id != OLD.simulation_id;
            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_values')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
            SELECT RAISE(ABORT, 'dimension is immutable on lws_character_values')
            WHERE NEW.dimension != OLD.dimension;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_values_insert_integrity
        BEFORE INSERT ON lws_character_values
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_values_no_delete
        BEFORE DELETE ON lws_character_values
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_values is prohibited');
        END;

        -- ====================================================================
        -- Triggers: Emotions (2 Triggers)
        -- ====================================================================
        CREATE TRIGGER IF NOT EXISTS trg_lws_emotions_identity_immutable
        BEFORE UPDATE ON lws_character_emotions
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_emotions')
            WHERE NEW.simulation_id != OLD.simulation_id;
            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_emotions')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_emotions_insert_integrity
        BEFORE INSERT ON lws_character_emotions
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
        END;

        -- ====================================================================
        -- Indexes (Migration 007: Exactly 10 Indexes)
        -- ====================================================================
        CREATE INDEX IF NOT EXISTS idx_lws_needs_char_sim
        ON lws_character_needs(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_goals_char_status
        ON lws_character_goals(simulation_character_id, status)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_goals_sim_priority
        ON lws_character_goals(simulation_id, priority DESC)
        WHERE deleted_at IS NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_goals_char_client_key
        ON lws_character_goals(simulation_character_id, client_goal_key);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_goals_char_acute_active
        ON lws_character_goals(simulation_character_id)
        WHERE goal_type = 'acute_need' AND status = 'active' AND deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_intentions_char_status
        ON lws_character_intentions(simulation_character_id, status);

        CREATE INDEX IF NOT EXISTS idx_lws_intentions_goal
        ON lws_character_intentions(goal_id)
        WHERE goal_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_values_char_sim
        ON lws_character_values(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_emotions_char_sim
        ON lws_character_emotions(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_emotions_dominant
        ON lws_character_emotions(simulation_id, dominant_emotion);
    `);
}
