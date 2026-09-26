/**
 * Living World Simulator (LWS) - Migration 009: Environment and Population
 *
 * Establishes Phase 9 location runtime environments, operational states, authored ambient archetypes,
 * promoted emergent entity records, and simulation character tiers:
 * - 5 tables: lws_location_environments, lws_location_operational_states, lws_ambient_archetypes,
 *             lws_promoted_entity_records, lws_simulation_character_tiers
 * - Exactly 15 triggers enforcing simulation integrity, column immutability, non-deletability, and audit ledger immutability
 * - Exactly 10 indexes for efficient location environments, operational lookups, archetypes, and promotion records
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- ====================================================================
        -- 1. Location Runtime Environments Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_location_environments (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            location_id                 INTEGER NOT NULL REFERENCES lws_locations(id) ON DELETE CASCADE,
            weather                     TEXT    NOT NULL DEFAULT 'clear' CHECK(weather IN (
                                            'clear', 'partly_cloudy', 'overcast', 'fog', 'rain',
                                            'heavy_rain', 'storm', 'snow', 'blizzard', 'heatwave'
                                        )),
            temperature_baseline         REAL    NOT NULL DEFAULT 20.0 CHECK(temperature_baseline >= -50.0 AND temperature_baseline <= 60.0),
            temperature_celsius         REAL    NOT NULL DEFAULT 20.0 CHECK(temperature_celsius >= -50.0 AND temperature_celsius <= 60.0),
            temperature_override        REAL    DEFAULT NULL CHECK(temperature_override IS NULL OR (temperature_override >= -50.0 AND temperature_override <= 60.0)),
            lighting_level              TEXT    NOT NULL DEFAULT 'normal' CHECK(lighting_level IN (
                                            'pitch_black', 'dim', 'normal', 'bright', 'blinding'
                                        )),
            lighting_override           TEXT    DEFAULT NULL CHECK(lighting_override IS NULL OR lighting_override IN (
                                            'pitch_black', 'dim', 'normal', 'bright', 'blinding'
                                        )),
            noise_level                 INTEGER NOT NULL DEFAULT 20 CHECK(noise_level >= 0 AND noise_level <= 100),
            is_indoor                   INTEGER NOT NULL DEFAULT 0 CHECK(is_indoor IN (0, 1)),
            air_quality                 TEXT    NOT NULL DEFAULT 'clean' CHECK(air_quality IN (
                                            'clean', 'hazy', 'smoke', 'toxic'
                                        )),
            hazards                     TEXT    NOT NULL DEFAULT '[]' CHECK(json_valid(hazards) = 1),
            last_evaluated_fictional_time TEXT  DEFAULT NULL,
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL
        );

        -- ====================================================================
        -- 2. Location Operational States Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_location_operational_states (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            location_id                 INTEGER NOT NULL REFERENCES lws_locations(id) ON DELETE CASCADE,
            access_status               TEXT    NOT NULL DEFAULT 'open' CHECK(access_status IN (
                                            'open', 'closed', 'restricted', 'barricaded', 'abandoned'
                                        )),
            access_override             TEXT    DEFAULT NULL CHECK(access_override IS NULL OR access_override IN (
                                            'open', 'closed', 'restricted', 'barricaded', 'abandoned'
                                        )),
            operating_hours             TEXT    DEFAULT NULL CHECK(operating_hours IS NULL OR json_valid(operating_hours) = 1),
            crowd_density               TEXT    NOT NULL DEFAULT 'moderate' CHECK(crowd_density IN (
                                            'empty', 'sparse', 'moderate', 'crowded', 'packed'
                                        )),
            ambient_capacity            INTEGER NOT NULL DEFAULT 50 CHECK(ambient_capacity >= 0 AND ambient_capacity <= 1000),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL
        );

        -- ====================================================================
        -- 3. Authored Ambient Archetypes Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_ambient_archetypes (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                      TEXT    UNIQUE NOT NULL,
            world_id                    INTEGER NOT NULL REFERENCES lws_worlds(id) ON DELETE CASCADE,
            archetype_key               TEXT    NOT NULL,
            entity_kind                 TEXT    NOT NULL DEFAULT 'person' CHECK(entity_kind IN (
                                            'person', 'vehicle', 'creature', 'crowd'
                                        )),
            role_title                  TEXT    NOT NULL,
            name_pool                   TEXT    NOT NULL DEFAULT '[]' CHECK(json_valid(name_pool) = 1),
            description_template        TEXT    NOT NULL,
            default_activities          TEXT    NOT NULL DEFAULT '[]' CHECK(json_valid(default_activities) = 1),
            location_tags               TEXT    NOT NULL DEFAULT '[]' CHECK(json_valid(location_tags) = 1),
            time_windows                TEXT    NOT NULL DEFAULT '["morning","afternoon","evening"]' CHECK(json_valid(time_windows) = 1),
            weather_compat              TEXT    DEFAULT NULL CHECK(weather_compat IS NULL OR json_valid(weather_compat) = 1),
            spawn_weight                INTEGER NOT NULL DEFAULT 50 CHECK(spawn_weight >= 1 AND spawn_weight <= 100),
            max_concurrent_instances    INTEGER NOT NULL DEFAULT 1 CHECK(max_concurrent_instances >= 1),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            deleted_at                  TEXT    DEFAULT NULL
        );

        -- ====================================================================
        -- 4. Promoted Emergent Entity Records Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_promoted_entity_records (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            source_archetype_key        TEXT    NOT NULL,
            source_transient_id         TEXT    NOT NULL,
            origin_location_id          INTEGER NOT NULL REFERENCES lws_locations(id) ON DELETE CASCADE,
            promotion_reason            TEXT    NOT NULL CHECK(promotion_reason IN (
                                            'direct_interaction', 'causal_event_witness', 'director_intervention'
                                        )),
            causal_event_id             INTEGER NOT NULL REFERENCES lws_events(id) ON DELETE CASCADE,
            promoted_to_tier            TEXT    NOT NULL DEFAULT 'supporting' CHECK(promoted_to_tier IN ('supporting', 'core')),
            fictional_time              TEXT    NOT NULL,
            created_at                  TEXT    NOT NULL
        );

        -- ====================================================================
        -- 5. Simulation Character Tiers Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_simulation_character_tiers (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                      TEXT    UNIQUE NOT NULL,
            simulation_id               INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            simulation_character_id     INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            tier                        TEXT    NOT NULL DEFAULT 'core' CHECK(tier IN ('core', 'supporting')),
            cognitive_budget            TEXT    NOT NULL DEFAULT 'full' CHECK(cognitive_budget IN ('full', 'lightweight')),
            is_promoted                 INTEGER NOT NULL DEFAULT 0 CHECK(is_promoted IN (0, 1)),
            created_at                  TEXT    NOT NULL,
            updated_at                  TEXT    NOT NULL,
            CHECK(
                (tier = 'core' AND cognitive_budget = 'full') OR
                (tier = 'supporting' AND cognitive_budget = 'lightweight')
            )
        );

        -- ====================================================================
        -- Exactly 10 Indexes
        -- ====================================================================
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_loc_env_sim_loc
            ON lws_location_environments(simulation_id, location_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_loc_ops_sim_loc
            ON lws_location_operational_states(simulation_id, location_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_ambient_archetypes_world_key
            ON lws_ambient_archetypes(world_id, archetype_key) WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_ambient_archetypes_world_tags
            ON lws_ambient_archetypes(world_id, entity_kind) WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_promoted_records_sim_char
            ON lws_promoted_entity_records(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_promoted_records_sim_time
            ON lws_promoted_entity_records(simulation_id, fictional_time DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_promoted_transient_unique
            ON lws_promoted_entity_records(simulation_id, source_transient_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_char_tiers_sim_char
            ON lws_simulation_character_tiers(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_char_tiers_sim_tier
            ON lws_simulation_character_tiers(simulation_id, tier);

        CREATE INDEX IF NOT EXISTS idx_lws_loc_env_weather
            ON lws_location_environments(simulation_id, weather);

        -- ====================================================================
        -- Exactly 15 Triggers
        -- ====================================================================

        -- 1. Environments — Same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_env_same_sim
        BEFORE INSERT ON lws_location_environments
        BEGIN
            SELECT CASE
                WHEN (SELECT world_id FROM lws_locations WHERE id = NEW.location_id) !=
                     (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id)
                THEN RAISE(ABORT, 'Location must belong to the simulation world')
            END;
        END;

        -- 2. Environments — Immutability of identity columns
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_env_immutability
        BEFORE UPDATE ON lws_location_environments
        BEGIN
            SELECT CASE
                WHEN OLD.lws_id != NEW.lws_id
                THEN RAISE(ABORT, 'lws_id is immutable on lws_location_environments')
                WHEN OLD.simulation_id != NEW.simulation_id
                THEN RAISE(ABORT, 'simulation_id is immutable on lws_location_environments')
                WHEN OLD.location_id != NEW.location_id
                THEN RAISE(ABORT, 'location_id is immutable on lws_location_environments')
            END;
        END;

        -- 3. Environments — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_env_no_delete
        BEFORE DELETE ON lws_location_environments
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_location_environments is prohibited');
        END;

        -- 4. Operational States — Same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_ops_same_sim
        BEFORE INSERT ON lws_location_operational_states
        BEGIN
            SELECT CASE
                WHEN (SELECT world_id FROM lws_locations WHERE id = NEW.location_id) !=
                     (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id)
                THEN RAISE(ABORT, 'Location must belong to the simulation world')
            END;
        END;

        -- 5. Operational States — Immutability of identity columns
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_ops_immutability
        BEFORE UPDATE ON lws_location_operational_states
        BEGIN
            SELECT CASE
                WHEN OLD.lws_id != NEW.lws_id
                THEN RAISE(ABORT, 'lws_id is immutable on lws_location_operational_states')
                WHEN OLD.simulation_id != NEW.simulation_id
                THEN RAISE(ABORT, 'simulation_id is immutable on lws_location_operational_states')
                WHEN OLD.location_id != NEW.location_id
                THEN RAISE(ABORT, 'location_id is immutable on lws_location_operational_states')
            END;
        END;

        -- 6. Operational States — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_ops_no_delete
        BEFORE DELETE ON lws_location_operational_states
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_location_operational_states is prohibited');
        END;

        -- 7. Ambient Archetypes — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_ambient_archetypes_no_delete
        BEFORE DELETE ON lws_ambient_archetypes
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_ambient_archetypes is prohibited');
        END;

        -- 8. Promoted Records — Same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_promoted_records_same_sim
        BEFORE INSERT ON lws_promoted_entity_records
        BEGIN
            SELECT CASE
                WHEN (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id
                THEN RAISE(ABORT, 'Character must belong to the same simulation')
                WHEN (SELECT world_id FROM lws_locations WHERE id = NEW.origin_location_id) !=
                     (SELECT world_id FROM lws_simulations WHERE id = NEW.simulation_id)
                THEN RAISE(ABORT, 'Origin location must belong to the simulation world')
                WHEN (SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id) != NEW.simulation_id
                THEN RAISE(ABORT, 'Causal event must belong to the same simulation')
            END;
        END;

        -- 9. Promoted Records — Prohibit updates (immutable audit ledger)
        CREATE TRIGGER IF NOT EXISTS trg_lws_promoted_records_no_update
        BEFORE UPDATE ON lws_promoted_entity_records
        BEGIN
            SELECT RAISE(ABORT, 'updates to lws_promoted_entity_records are prohibited');
        END;

        -- 10. Promoted Records — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_promoted_records_no_delete
        BEFORE DELETE ON lws_promoted_entity_records
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_promoted_entity_records is prohibited');
        END;

        -- 11. Character Tiers — Same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_char_tiers_same_sim
        BEFORE INSERT ON lws_simulation_character_tiers
        BEGIN
            SELECT CASE
                WHEN (SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id) != NEW.simulation_id
                THEN RAISE(ABORT, 'Character must belong to the same simulation')
            END;
        END;

        -- 12. Character Tiers — Immutability of identity columns
        CREATE TRIGGER IF NOT EXISTS trg_lws_char_tiers_immutability
        BEFORE UPDATE ON lws_simulation_character_tiers
        BEGIN
            SELECT CASE
                WHEN OLD.lws_id != NEW.lws_id
                THEN RAISE(ABORT, 'lws_id is immutable on lws_simulation_character_tiers')
                WHEN OLD.simulation_id != NEW.simulation_id
                THEN RAISE(ABORT, 'simulation_id is immutable on lws_simulation_character_tiers')
                WHEN OLD.simulation_character_id != NEW.simulation_character_id
                THEN RAISE(ABORT, 'simulation_character_id is immutable on lws_simulation_character_tiers')
            END;
        END;

        -- 13. Character Tiers — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_char_tiers_no_delete
        BEFORE DELETE ON lws_simulation_character_tiers
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_simulation_character_tiers is prohibited');
        END;

        -- 14. Environments — Prevent duplicate location assignment
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_env_unique
        BEFORE INSERT ON lws_location_environments
        BEGIN
            SELECT CASE
                WHEN (SELECT COUNT(*) FROM lws_location_environments WHERE simulation_id = NEW.simulation_id AND location_id = NEW.location_id) > 0
                THEN RAISE(ABORT, 'Location environment already exists for this simulation and location')
            END;
        END;

        -- 15. Operational States — Prevent duplicate location assignment
        CREATE TRIGGER IF NOT EXISTS trg_lws_loc_ops_unique
        BEFORE INSERT ON lws_location_operational_states
        BEGIN
            SELECT CASE
                WHEN (SELECT COUNT(*) FROM lws_location_operational_states WHERE simulation_id = NEW.simulation_id AND location_id = NEW.location_id) > 0
                THEN RAISE(ABORT, 'Location operational state already exists for this simulation and location')
            END;
        END;
    `);
}
