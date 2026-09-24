/**
 * Living World Simulator (LWS) - Migration 006: Perception, Knowledge, Memories, Beliefs, and Observation
 *
 * Establishes Phase 6 information boundaries, cognitive models, and observer subsystem:
 * - 5 tables: lws_event_perceptions, lws_character_knowledge, lws_character_memories, lws_character_beliefs, lws_simulation_cameras
 * - Exactly 15 triggers enforcing cross-simulation update integrity, immutability, soft-deletion protection, and camera invariants
 * - Exactly 10 indexes for high-performance temporal queries, salience pre-filtering, and scoped lookups
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- ====================================================================
        -- 1. Event Perception Ledger Table (Option A: Singular Canonical Modality)
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_event_perceptions (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            event_id                    INTEGER NOT NULL REFERENCES lws_events(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            sensory_modality            TEXT    NOT NULL CHECK(sensory_modality IN (
                                            'tactile', 'visual', 'auditory', 'olfactory'
                                        )),
            perceived_at_fictional_time TEXT    NOT NULL,
            created_at                  TEXT    NOT NULL,
            UNIQUE(event_id, simulation_character_id)
        );

        -- ====================================================================
        -- 2. Character Knowledge Base Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_knowledge (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            fact_key                    TEXT    NOT NULL,
            content                     TEXT    NOT NULL,
            source_channel              TEXT    NOT NULL CHECK(source_channel IN (
                                            'perception', 'communication', 'evidence', 'backstory', 'director_injection', 'inference'
                                        )),
            source_character_id         INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id),
            source_event_id             INTEGER DEFAULT NULL REFERENCES lws_events(id),
            fictional_time_acquired     TEXT    NOT NULL,
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL,
            UNIQUE(simulation_character_id, fact_key)
        );

        -- ====================================================================
        -- 3. Character Memories Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_memories (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            summary                     TEXT    NOT NULL,
            details                     TEXT    NOT NULL DEFAULT '',
            memory_type                 TEXT    NOT NULL DEFAULT 'episodic' CHECK(memory_type IN ('episodic', 'semantic', 'backstory')),
            event_id                    INTEGER DEFAULT NULL REFERENCES lws_events(id),
            fictional_time              TEXT    NOT NULL,
            emotional_salience          INTEGER NOT NULL DEFAULT 50 CHECK(emotional_salience >= 1 AND emotional_salience <= 100),
            importance                  INTEGER NOT NULL DEFAULT 50 CHECK(importance >= 1 AND importance <= 100),
            confidence                  INTEGER NOT NULL DEFAULT 100 CHECK(confidence >= 1 AND confidence <= 100),
            status                      TEXT    NOT NULL DEFAULT 'vivid' CHECK(status IN ('vivid', 'fading', 'consolidated', 'distorted')),
            tags                        TEXT    NOT NULL DEFAULT '[]',
            source_channel              TEXT    NOT NULL CHECK(source_channel IN (
                                            'perception', 'communication', 'evidence', 'backstory', 'director_injection', 'inference'
                                        )),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL
        );

        -- ====================================================================
        -- 4. Character Beliefs & Suspicions Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_beliefs (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id),
            subject_key                 TEXT    NOT NULL,
            belief_type                 TEXT    NOT NULL DEFAULT 'belief' CHECK(belief_type IN ('belief', 'suspicion', 'hypothesis')),
            statement                   TEXT    NOT NULL,
            confidence                  INTEGER NOT NULL DEFAULT 50 CHECK(confidence >= 1 AND confidence <= 100),
            source_basis                TEXT    NOT NULL DEFAULT 'deduction' CHECK(source_basis IN (
                                            'observation', 'hearsay', 'deduction', 'intuition', 'deception', 'backstory', 'director_injection'
                                        )),
            causal_event_id             INTEGER DEFAULT NULL REFERENCES lws_events(id),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL,
            UNIQUE(simulation_character_id, subject_key)
        );

        -- ====================================================================
        -- 5. Simulation Cameras Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_simulation_cameras (
            id                          INTEGER PRIMARY KEY,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id),
            camera_name                 TEXT    NOT NULL DEFAULT 'default',
            mode                        TEXT    NOT NULL DEFAULT 'god_view' CHECK(mode IN ('follow_character', 'observe_location', 'god_view')),
            target_character_id         INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id),
            target_location_id          INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            UNIQUE(simulation_id, camera_name)
        );

        -- ====================================================================
        -- Triggers: Event Perceptions (Exactly 3 Triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_perceptions_immutable
        BEFORE UPDATE ON lws_event_perceptions
        BEGIN
            SELECT RAISE(ABORT, 'lws_event_perceptions rows are strictly immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_perceptions_no_delete
        BEFORE DELETE ON lws_event_perceptions
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_event_perceptions is prohibited');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_perceptions_same_sim
        BEFORE INSERT ON lws_event_perceptions
        BEGIN
            SELECT RAISE(ABORT, 'event_id must belong to the same simulation as perception record')
            WHERE (SELECT simulation_id FROM lws_events WHERE id = NEW.event_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation as perception record')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;
        END;

        -- ====================================================================
        -- Triggers: Knowledge (Exactly 3 Triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_knowledge_identity_immutable
        BEFORE UPDATE ON lws_character_knowledge
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_knowledge')
            WHERE NEW.simulation_id != OLD.simulation_id;

            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_knowledge')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;

            SELECT RAISE(ABORT, 'source_character_id must belong to the same simulation')
            WHERE NEW.source_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.source_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'source_event_id must belong to the same simulation')
            WHERE NEW.source_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.source_event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_knowledge_insert_integrity
        BEFORE INSERT ON lws_character_knowledge
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'source_character_id must belong to the same simulation')
            WHERE NEW.source_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.source_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'source_event_id must belong to the same simulation')
            WHERE NEW.source_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.source_event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_knowledge_no_delete
        BEFORE DELETE ON lws_character_knowledge
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_knowledge is prohibited; use soft-delete');
        END;

        -- ====================================================================
        -- Triggers: Memories (Exactly 3 Triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_memories_identity_immutable
        BEFORE UPDATE ON lws_character_memories
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_memories')
            WHERE NEW.simulation_id != OLD.simulation_id;

            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_memories')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;

            SELECT RAISE(ABORT, 'event_id must belong to the same simulation')
            WHERE NEW.event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_memories_insert_integrity
        BEFORE INSERT ON lws_character_memories
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'event_id must belong to the same simulation')
            WHERE NEW.event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_memories_no_delete
        BEFORE DELETE ON lws_character_memories
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_memories is prohibited; use soft-delete');
        END;

        -- ====================================================================
        -- Triggers: Beliefs (Exactly 3 Triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_beliefs_identity_immutable
        BEFORE UPDATE ON lws_character_beliefs
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_character_beliefs')
            WHERE NEW.simulation_id != OLD.simulation_id;

            SELECT RAISE(ABORT, 'simulation_character_id is immutable on lws_character_beliefs')
            WHERE NEW.simulation_character_id != OLD.simulation_character_id;

            SELECT RAISE(ABORT, 'causal_event_id must belong to the same simulation')
            WHERE NEW.causal_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_beliefs_insert_integrity
        BEFORE INSERT ON lws_character_beliefs
        BEGIN
            SELECT RAISE(ABORT, 'simulation_character_id must belong to the same simulation')
            WHERE (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'causal_event_id must belong to the same simulation')
            WHERE NEW.causal_event_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id) != NEW.simulation_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_beliefs_no_delete
        BEFORE DELETE ON lws_character_beliefs
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_beliefs is prohibited; use soft-delete');
        END;

        -- ====================================================================
        -- Triggers: Cameras (Exactly 3 Triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_cameras_identity_immutable
        BEFORE UPDATE ON lws_simulation_cameras
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_simulation_cameras')
            WHERE NEW.simulation_id != OLD.simulation_id;

            SELECT RAISE(ABORT, 'camera_name is immutable on lws_simulation_cameras')
            WHERE NEW.camera_name != OLD.camera_name;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_cameras_insert_integrity
        BEFORE INSERT ON lws_simulation_cameras
        BEGIN
            -- Mode target integrity
            SELECT RAISE(ABORT, 'follow_character mode requires target_character_id and NULL target_location_id')
            WHERE NEW.mode = 'follow_character' AND (NEW.target_character_id IS NULL OR NEW.target_location_id IS NOT NULL);

            SELECT RAISE(ABORT, 'observe_location mode requires target_location_id and NULL target_character_id')
            WHERE NEW.mode = 'observe_location' AND (NEW.target_location_id IS NULL OR NEW.target_character_id IS NOT NULL);

            SELECT RAISE(ABORT, 'god_view mode requires NULL target_character_id and NULL target_location_id')
            WHERE NEW.mode = 'god_view' AND (NEW.target_character_id IS NOT NULL OR NEW.target_location_id IS NOT NULL);

            -- Cross-simulation lineage
            SELECT RAISE(ABORT, 'target_character_id must belong to the same simulation')
            WHERE NEW.target_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'target_location_id must belong to the same world as simulation')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id) != (
                  SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id
              );
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_cameras_update_integrity
        BEFORE UPDATE ON lws_simulation_cameras
        BEGIN
            -- Mode target integrity
            SELECT RAISE(ABORT, 'follow_character mode requires target_character_id and NULL target_location_id')
            WHERE NEW.mode = 'follow_character' AND (NEW.target_character_id IS NULL OR NEW.target_location_id IS NOT NULL);

            SELECT RAISE(ABORT, 'observe_location mode requires target_location_id and NULL target_character_id')
            WHERE NEW.mode = 'observe_location' AND (NEW.target_location_id IS NULL OR NEW.target_character_id IS NOT NULL);

            SELECT RAISE(ABORT, 'god_view mode requires NULL target_character_id and NULL target_location_id')
            WHERE NEW.mode = 'god_view' AND (NEW.target_character_id IS NOT NULL OR NEW.target_location_id IS NOT NULL);

            -- Cross-simulation lineage
            SELECT RAISE(ABORT, 'target_character_id must belong to the same simulation')
            WHERE NEW.target_character_id IS NOT NULL
              AND (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id) != NEW.simulation_id;

            SELECT RAISE(ABORT, 'target_location_id must belong to the same world as simulation')
            WHERE NEW.target_location_id IS NOT NULL
              AND (SELECT world_id FROM lws_locations WHERE id = NEW.target_location_id) != (
                  SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id
              );
        END;

        -- ====================================================================
        -- Indexes (Migration 006: Exactly 10 Indexes)
        -- ====================================================================

        CREATE INDEX IF NOT EXISTS idx_lws_perceptions_event
        ON lws_event_perceptions(event_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_perceptions_char_time
        ON lws_event_perceptions(simulation_character_id, perceived_at_fictional_time);

        CREATE INDEX IF NOT EXISTS idx_lws_knowledge_char_lookup
        ON lws_character_knowledge(simulation_character_id, fact_key)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_knowledge_sim_char
        ON lws_character_knowledge(simulation_id, simulation_character_id)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_memories_char_time
        ON lws_character_memories(simulation_character_id, fictional_time DESC)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_memories_char_salience
        ON lws_character_memories(simulation_character_id, emotional_salience DESC)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_memories_sim_char
        ON lws_character_memories(simulation_id, simulation_character_id)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_beliefs_lookup
        ON lws_character_beliefs(simulation_character_id, subject_key)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_beliefs_sim_char
        ON lws_character_beliefs(simulation_id, simulation_character_id)
        WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_cameras_sim
        ON lws_simulation_cameras(simulation_id, camera_name);
    `);
}
