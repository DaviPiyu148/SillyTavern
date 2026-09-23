/**
 * Living World Simulator (LWS) - Migration 003: Simulation Runtime and Persistence
 *
 * Establishes Phase 3 runtime storage for the LWS subsystem:
 * - 2 tables: lws_simulations, lws_simulation_characters
 * - Exactly 10 database triggers enforcing immutability (world_id, scenario_id, simulation_id,
 *   character_id, authored_snapshot), status transition matrix rules, cross-world integrity,
 *   and soft-deleted location assignment guards while preserving existing references
 * - Exactly 5 indexes for efficient simulation-scoped and world-scoped querying of non-deleted records
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- Simulations: Runtime instances
        CREATE TABLE IF NOT EXISTS lws_simulations (
            id                      INTEGER PRIMARY KEY,
            lws_id                  TEXT    UNIQUE NOT NULL,
            world_id                INTEGER NOT NULL REFERENCES lws_worlds(id),
            scenario_id             INTEGER DEFAULT NULL REFERENCES lws_scenarios(id),
            name                    TEXT    NOT NULL,
            status                  TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
            current_fictional_time  TEXT    NOT NULL,
            settings                TEXT    NOT NULL DEFAULT '{}',
            extensions              TEXT    NOT NULL DEFAULT '{}',
            created_at              TEXT    NOT NULL,
            updated_at              TEXT    NOT NULL,
            deleted_at              TEXT    DEFAULT NULL
        );

        -- Simulation Characters: Runtime character state
        CREATE TABLE IF NOT EXISTS lws_simulation_characters (
            id                      INTEGER PRIMARY KEY,
            lws_id                  TEXT    UNIQUE NOT NULL,
            simulation_id           INTEGER NOT NULL REFERENCES lws_simulations(id),
            character_id            INTEGER NOT NULL REFERENCES lws_characters(id),
            current_location_id     INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            activity                TEXT    NOT NULL DEFAULT 'idle',
            physical_condition      TEXT    NOT NULL DEFAULT 'normal',
            runtime_state           TEXT    NOT NULL DEFAULT '{}',
            authored_snapshot       TEXT    NOT NULL DEFAULT '{}',
            created_at              TEXT    NOT NULL,
            updated_at              TEXT    NOT NULL,
            deleted_at              TEXT    DEFAULT NULL
        );

        -- ====================================================================
        -- Database Triggers: Immutability, Status, and Location Integrity (10 triggers)
        -- ====================================================================

        -- 1. world_id on lws_simulations is immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_simulations_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_simulations
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable on lws_simulations')
            WHERE NEW.world_id != OLD.world_id;
        END;

        -- 2. scenario_id on lws_simulations is immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_simulations_scenario_id_immutable
        BEFORE UPDATE OF scenario_id ON lws_simulations
        BEGIN
            SELECT RAISE(ABORT, 'scenario_id is immutable on lws_simulations')
            WHERE (OLD.scenario_id IS NOT NULL AND NEW.scenario_id != OLD.scenario_id)
               OR (OLD.scenario_id IS NOT NULL AND NEW.scenario_id IS NULL)
               OR (OLD.scenario_id IS NULL AND NEW.scenario_id IS NOT NULL);
        END;

        -- 3. scenario_id must belong to the same world as the simulation (INSERT)
        CREATE TRIGGER IF NOT EXISTS trg_lws_simulations_scenario_same_world_insert
        BEFORE INSERT ON lws_simulations
        WHEN NEW.scenario_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'scenario must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_scenarios WHERE id = NEW.scenario_id) != NEW.world_id;
        END;

        -- 4. Status transition matrix enforcement (reject illegal transitions at DB boundary)
        CREATE TRIGGER IF NOT EXISTS trg_lws_simulations_status_transition
        BEFORE UPDATE OF status ON lws_simulations
        BEGIN
            SELECT RAISE(ABORT, 'invalid simulation status transition')
            WHERE (OLD.status = 'archived' AND NEW.status != 'archived')
               OR (OLD.status = 'active' AND NEW.status NOT IN ('active', 'paused', 'archived'))
               OR (OLD.status = 'paused' AND NEW.status NOT IN ('paused', 'active', 'archived'));
        END;

        -- 5. simulation_id on lws_simulation_characters is immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_simulation_id_immutable
        BEFORE UPDATE OF simulation_id ON lws_simulation_characters
        BEGIN
            SELECT RAISE(ABORT, 'simulation_id is immutable on lws_simulation_characters')
            WHERE NEW.simulation_id != OLD.simulation_id;
        END;

        -- 6. character_id on lws_simulation_characters is immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_character_id_immutable
        BEFORE UPDATE OF character_id ON lws_simulation_characters
        BEGIN
            SELECT RAISE(ABORT, 'character_id is immutable on lws_simulation_characters')
            WHERE NEW.character_id != OLD.character_id;
        END;

        -- 7. authored_snapshot on lws_simulation_characters is immutable
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_authored_snapshot_immutable
        BEFORE UPDATE OF authored_snapshot ON lws_simulation_characters
        BEGIN
            SELECT RAISE(ABORT, 'authored_snapshot is immutable on lws_simulation_characters')
            WHERE NEW.authored_snapshot != OLD.authored_snapshot;
        END;

        -- 8. Character must belong to the same world as the simulation
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_same_world_insert
        BEFORE INSERT ON lws_simulation_characters
        BEGIN
            SELECT RAISE(ABORT, 'character must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.character_id) !=
                  (SELECT world_id FROM lws_simulations  WHERE id = NEW.simulation_id);
        END;

        -- 9. current_location_id must belong to same world AND cannot be newly assigned if soft-deleted (INSERT)
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_location_insert
        BEFORE INSERT ON lws_simulation_characters
        WHEN NEW.current_location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'current_location_id must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.current_location_id) !=
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);

            SELECT RAISE(ABORT, 'cannot newly assign a soft-deleted location')
            WHERE (SELECT deleted_at FROM lws_locations WHERE id = NEW.current_location_id) IS NOT NULL;
        END;

        -- 10. current_location_id must belong to same world AND cannot be newly assigned if soft-deleted,
        --     while explicitly preserving existing references if location was later soft-deleted (UPDATE)
        CREATE TRIGGER IF NOT EXISTS trg_lws_sim_chars_location_update
        BEFORE UPDATE OF current_location_id ON lws_simulation_characters
        WHEN NEW.current_location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'current_location_id must belong to the same world as the simulation')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.current_location_id) !=
                  (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id);

            SELECT RAISE(ABORT, 'cannot newly assign a soft-deleted location')
            WHERE (OLD.current_location_id IS NULL OR NEW.current_location_id != OLD.current_location_id)
              AND (SELECT deleted_at FROM lws_locations WHERE id = NEW.current_location_id) IS NOT NULL;
        END;

        -- ====================================================================
        -- Indexes (5 indexes)
        -- ====================================================================

        -- Simulations in world
        CREATE INDEX IF NOT EXISTS idx_lws_simulations_world
        ON lws_simulations(world_id) WHERE deleted_at IS NULL;

        -- Unique active simulation name within world
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_simulations_name_active
        ON lws_simulations(world_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

        -- Simulation characters in simulation
        CREATE INDEX IF NOT EXISTS idx_lws_sim_chars_sim
        ON lws_simulation_characters(simulation_id) WHERE deleted_at IS NULL;

        -- Unique active character in simulation (at most one instance of an authored character per simulation)
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_sim_chars_unique_active
        ON lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL;

        -- Simulation characters by location
        CREATE INDEX IF NOT EXISTS idx_lws_sim_chars_location
        ON lws_simulation_characters(current_location_id) WHERE deleted_at IS NULL;
    `);
}
