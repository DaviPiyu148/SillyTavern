/**
 * Living World Simulator (LWS) - Migration 002: Authored World and Character Model
 *
 * Establishes Phase 2 authored data storage for the LWS subsystem:
 * - 9 tables: 7 entity tables + 2 join tables
 * - 12 database triggers enforcing cross-world relationship constraints (INSERT & UPDATE)
 *   and world_id immutability across all child entities
 * - 5 partial indexes for efficient world-scoped querying of non-deleted records
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- Worlds: root authored entity
        CREATE TABLE IF NOT EXISTS lws_worlds (
            id          INTEGER PRIMARY KEY,
            lws_id      TEXT    UNIQUE NOT NULL,
            name        TEXT    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            tags        TEXT    NOT NULL DEFAULT '[]',
            extensions  TEXT    NOT NULL DEFAULT '{}',
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            deleted_at  TEXT    DEFAULT NULL
        );

        -- Characters: authored, reusable, world-scoped
        CREATE TABLE IF NOT EXISTS lws_characters (
            id                      INTEGER PRIMARY KEY,
            lws_id                  TEXT    UNIQUE NOT NULL,
            world_id                INTEGER NOT NULL REFERENCES lws_worlds(id),
            name                    TEXT    NOT NULL,
            description             TEXT    NOT NULL DEFAULT '',
            personality             TEXT    NOT NULL DEFAULT '',
            scenario_context        TEXT    NOT NULL DEFAULT '',
            mes_example             TEXT    NOT NULL DEFAULT '',
            author_notes            TEXT    NOT NULL DEFAULT '',
            system_prompt_override  TEXT    NOT NULL DEFAULT '',
            source_version          TEXT    NOT NULL DEFAULT '',
            tags                    TEXT    NOT NULL DEFAULT '[]',
            extensions              TEXT    NOT NULL DEFAULT '{}',
            created_at              TEXT    NOT NULL,
            updated_at              TEXT    NOT NULL,
            deleted_at              TEXT    DEFAULT NULL
        );

        -- Locations: authored, reusable, world-scoped
        CREATE TABLE IF NOT EXISTS lws_locations (
            id          INTEGER PRIMARY KEY,
            lws_id      TEXT    UNIQUE NOT NULL,
            world_id    INTEGER NOT NULL REFERENCES lws_worlds(id),
            name        TEXT    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            tags        TEXT    NOT NULL DEFAULT '[]',
            extensions  TEXT    NOT NULL DEFAULT '{}',
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            deleted_at  TEXT    DEFAULT NULL
        );

        -- Factions: authored, world-scoped
        CREATE TABLE IF NOT EXISTS lws_factions (
            id          INTEGER PRIMARY KEY,
            lws_id      TEXT    UNIQUE NOT NULL,
            world_id    INTEGER NOT NULL REFERENCES lws_worlds(id),
            name        TEXT    NOT NULL,
            description TEXT    NOT NULL DEFAULT '',
            tags        TEXT    NOT NULL DEFAULT '[]',
            extensions  TEXT    NOT NULL DEFAULT '{}',
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            deleted_at  TEXT    DEFAULT NULL
        );

        -- Character <-> Faction membership (many-to-many, authored)
        CREATE TABLE IF NOT EXISTS lws_character_factions (
            character_id    INTEGER NOT NULL REFERENCES lws_characters(id),
            faction_id      INTEGER NOT NULL REFERENCES lws_factions(id),
            role            TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (character_id, faction_id)
        );

        -- World Rules: ordered domain constraints for a world
        CREATE TABLE IF NOT EXISTS lws_world_rules (
            id          INTEGER PRIMARY KEY,
            lws_id      TEXT    UNIQUE NOT NULL,
            world_id    INTEGER NOT NULL REFERENCES lws_worlds(id),
            sort_order  INTEGER NOT NULL DEFAULT 0,
            title       TEXT    NOT NULL DEFAULT '',
            body        TEXT    NOT NULL,
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            deleted_at  TEXT    DEFAULT NULL
        );

        -- Scenarios: starting conditions for a simulation, reference World entities
        CREATE TABLE IF NOT EXISTS lws_scenarios (
            id                   INTEGER PRIMARY KEY,
            lws_id               TEXT    UNIQUE NOT NULL,
            world_id             INTEGER NOT NULL REFERENCES lws_worlds(id),
            name                 TEXT    NOT NULL,
            description          TEXT    NOT NULL DEFAULT '',
            starting_location_id INTEGER DEFAULT NULL REFERENCES lws_locations(id),
            tags                 TEXT    NOT NULL DEFAULT '[]',
            extensions           TEXT    NOT NULL DEFAULT '{}',
            created_at           TEXT    NOT NULL,
            updated_at           TEXT    NOT NULL,
            deleted_at           TEXT    DEFAULT NULL
        );

        -- Scenario character roster (which authored characters participate in this scenario)
        CREATE TABLE IF NOT EXISTS lws_scenario_characters (
            scenario_id  INTEGER NOT NULL REFERENCES lws_scenarios(id),
            character_id INTEGER NOT NULL REFERENCES lws_characters(id),
            role         TEXT    NOT NULL DEFAULT '',
            PRIMARY KEY (scenario_id, character_id)
        );

        -- Authored Prompt/Style Config: optional per-world authoring-time generation preferences (1:1 with World)
        CREATE TABLE IF NOT EXISTS lws_authored_prompt_configs (
            id              INTEGER PRIMARY KEY,
            lws_id          TEXT    UNIQUE NOT NULL,
            world_id        INTEGER UNIQUE NOT NULL REFERENCES lws_worlds(id),
            style_notes     TEXT    NOT NULL DEFAULT '',
            tone_notes      TEXT    NOT NULL DEFAULT '',
            format_notes    TEXT    NOT NULL DEFAULT '',
            extensions      TEXT    NOT NULL DEFAULT '{}',
            created_at      TEXT    NOT NULL,
            updated_at      TEXT    NOT NULL
        );

        -- ====================================================================
        -- Triggers: Cross-World Relationship Integrity (6 triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_character_factions_same_world_insert
        BEFORE INSERT ON lws_character_factions
        BEGIN
            SELECT RAISE(ABORT, 'character and faction must belong to the same world')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.character_id) !=
                  (SELECT world_id FROM lws_factions   WHERE id = NEW.faction_id);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_character_factions_same_world_update
        BEFORE UPDATE ON lws_character_factions
        BEGIN
            SELECT RAISE(ABORT, 'character and faction must belong to the same world')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.character_id) !=
                  (SELECT world_id FROM lws_factions   WHERE id = NEW.faction_id);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_scenarios_location_same_world_insert
        BEFORE INSERT ON lws_scenarios
        WHEN NEW.starting_location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'starting_location_id must belong to the same world as the scenario')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.starting_location_id) != NEW.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_scenarios_location_same_world_update
        BEFORE UPDATE ON lws_scenarios
        WHEN NEW.starting_location_id IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'starting_location_id must belong to the same world as the scenario')
            WHERE (SELECT world_id FROM lws_locations WHERE id = NEW.starting_location_id) != NEW.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_scenario_characters_same_world_insert
        BEFORE INSERT ON lws_scenario_characters
        BEGIN
            SELECT RAISE(ABORT, 'character must belong to the same world as the scenario')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.character_id) !=
                  (SELECT world_id FROM lws_scenarios   WHERE id = NEW.scenario_id);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_scenario_characters_same_world_update
        BEFORE UPDATE ON lws_scenario_characters
        BEGIN
            SELECT RAISE(ABORT, 'character must belong to the same world as the scenario')
            WHERE (SELECT world_id FROM lws_characters WHERE id = NEW.character_id) !=
                  (SELECT world_id FROM lws_scenarios   WHERE id = NEW.scenario_id);
        END;

        -- ====================================================================
        -- Triggers: world_id Immutability (6 triggers)
        -- ====================================================================

        CREATE TRIGGER IF NOT EXISTS trg_lws_characters_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_characters
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_locations_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_locations
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_factions_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_factions
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_world_rules_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_world_rules
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_scenarios_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_scenarios
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_lws_prompt_configs_world_id_immutable
        BEFORE UPDATE OF world_id ON lws_authored_prompt_configs
        BEGIN
            SELECT RAISE(ABORT, 'world_id is immutable')
            WHERE NEW.world_id != OLD.world_id;
        END;

        -- ====================================================================
        -- Partial Indexes (5 indexes)
        -- ====================================================================

        CREATE INDEX IF NOT EXISTS idx_lws_characters_world    ON lws_characters(world_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_lws_locations_world     ON lws_locations(world_id)  WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_lws_factions_world      ON lws_factions(world_id)   WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_lws_world_rules_world   ON lws_world_rules(world_id, sort_order) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_lws_scenarios_world     ON lws_scenarios(world_id)  WHERE deleted_at IS NULL;
    `);
}
