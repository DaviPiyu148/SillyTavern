/**
 * Living World Simulator (LWS) - Migration 008: Social Systems and Character Development
 *
 * Establishes Phase 8 persistent social structures, rumor trees, factions, and psychological development:
 * - 5 tables: lws_character_relationships, lws_relationship_evidence, lws_social_information,
 *             lws_character_faction_memberships, lws_character_development_records
 * - Exactly 15 triggers enforcing directional asymmetry, simulation boundaries, and append-only ledgers
 * - Exactly 10 indexes for relationship queries, rumor trees, faction lookups, and development histories
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        -- ====================================================================
        -- 1. Directional Character Relationships Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_relationships (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                          TEXT    UNIQUE NOT NULL,
            simulation_id                   INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            source_character_id             INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            target_character_id             INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            trust                           INTEGER NOT NULL DEFAULT 0 CHECK(trust >= -100 AND trust <= 100),
            affection                       INTEGER NOT NULL DEFAULT 0 CHECK(affection >= -100 AND affection <= 100),
            familiarity                     INTEGER NOT NULL DEFAULT 0 CHECK(familiarity >= 0 AND familiarity <= 100),
            respect                         INTEGER NOT NULL DEFAULT 0 CHECK(respect >= -100 AND respect <= 100),
            loyalty                         INTEGER NOT NULL DEFAULT 0 CHECK(loyalty >= -100 AND loyalty <= 100),
            last_interaction_fictional_time TEXT    DEFAULT NULL,
            created_at                      TEXT    NOT NULL,
            updated_at                      TEXT    NOT NULL,
            deleted_at                      TEXT    DEFAULT NULL,
            CHECK(source_character_id != target_character_id)
        );

        -- ====================================================================
        -- 2. Causal Relationship Evidence Ledger Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_relationship_evidence (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id              TEXT    UNIQUE NOT NULL,
            simulation_id       INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            relationship_id     INTEGER NOT NULL REFERENCES lws_character_relationships(id) ON DELETE CASCADE,
            source_character_id INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            target_character_id INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            causal_event_id     INTEGER NOT NULL REFERENCES lws_events(id) ON DELETE CASCADE,
            fictional_time      TEXT    NOT NULL,
            delta_trust         INTEGER NOT NULL DEFAULT 0,
            delta_affection     INTEGER NOT NULL DEFAULT 0,
            delta_familiarity   INTEGER NOT NULL DEFAULT 0,
            delta_respect       INTEGER NOT NULL DEFAULT 0,
            delta_loyalty       INTEGER NOT NULL DEFAULT 0,
            interaction_type    TEXT    NOT NULL,
            narrative_rationale TEXT    NOT NULL,
            created_at          TEXT    NOT NULL
        );

        -- ====================================================================
        -- 3. Social Information & Rumors Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_social_information (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                          TEXT    UNIQUE NOT NULL,
            simulation_id                   INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            parent_social_information_id    INTEGER DEFAULT NULL REFERENCES lws_social_information(id) ON DELETE CASCADE,
            root_social_information_id      INTEGER DEFAULT NULL REFERENCES lws_social_information(id) ON DELETE CASCADE,
            originator_character_id         INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id) ON DELETE SET NULL,
            transmitter_character_id        INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id) ON DELETE SET NULL,
            recipient_character_id          INTEGER DEFAULT NULL REFERENCES lws_simulation_characters(id) ON DELETE SET NULL,
            causal_event_id                 INTEGER DEFAULT NULL REFERENCES lws_events(id) ON DELETE CASCADE,
            subject_key                     TEXT    NOT NULL,
            topic                           TEXT    NOT NULL,
            claim_statement                 TEXT    NOT NULL,
            veracity                        TEXT    NOT NULL CHECK(veracity IN ('true', 'distorted', 'false', 'unknown')),
            ground_truth_event_id           INTEGER DEFAULT NULL REFERENCES lws_events(id) ON DELETE SET NULL,
            distortion_level                INTEGER NOT NULL DEFAULT 0 CHECK(distortion_level >= 0 AND distortion_level <= 100),
            transmission_depth              INTEGER NOT NULL DEFAULT 0 CHECK(transmission_depth >= 0 AND transmission_depth <= 5),
            confidence_score                INTEGER NOT NULL DEFAULT 50 CHECK(confidence_score >= 1 AND confidence_score <= 100),
            fictional_time                  TEXT    NOT NULL,
            created_at                      TEXT    NOT NULL
        );

        -- ====================================================================
        -- 4. Runtime Faction Memberships Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_faction_memberships (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                  TEXT    UNIQUE NOT NULL,
            simulation_id           INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            simulation_character_id INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            faction_id              INTEGER NOT NULL REFERENCES lws_factions(id) ON DELETE CASCADE,
            rank_role               TEXT    NOT NULL DEFAULT 'member',
            standing                INTEGER NOT NULL DEFAULT 0 CHECK(standing >= -100 AND standing <= 100),
            loyalty_score           INTEGER NOT NULL DEFAULT 50 CHECK(loyalty_score >= -100 AND loyalty_score <= 100),
            membership_status       TEXT    NOT NULL DEFAULT 'active' CHECK(membership_status IN (
                                        'active', 'probation', 'suspended', 'exiled', 'defected'
                                    )),
            joined_fictional_time   TEXT    DEFAULT NULL,
            created_at              TEXT    NOT NULL,
            updated_at              TEXT    NOT NULL,
            deleted_at              TEXT    DEFAULT NULL
        );

        -- ====================================================================
        -- 5. Persistent Character Development Records Table
        -- ====================================================================
        CREATE TABLE IF NOT EXISTS lws_character_development_records (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            lws_id                  TEXT    UNIQUE NOT NULL,
            simulation_id           INTEGER NOT NULL REFERENCES lws_simulations(id) ON DELETE CASCADE,
            simulation_character_id INTEGER NOT NULL REFERENCES lws_simulation_characters(id) ON DELETE CASCADE,
            dimension_category      TEXT    NOT NULL CHECK(dimension_category IN (
                                        'value_shift', 'disposition_shift', 'habit_shift', 'baseline_need_shift'
                                    )),
            dimension_key           TEXT    NOT NULL,
            previous_value          REAL    NOT NULL,
            new_value               REAL    NOT NULL,
            delta                   REAL    NOT NULL,
            trigger_category        TEXT    NOT NULL CHECK(trigger_category IN (
                                        'acute_trauma', 'sustained_experience', 'social_reinforcement',
                                        'cognitive_dissonance', 'director_override'
                                    )),
            causal_event_ids        TEXT    NOT NULL DEFAULT '[]' CHECK(json_valid(causal_event_ids) = 1),
            stability               INTEGER NOT NULL DEFAULT 50 CHECK(stability >= 1 AND stability <= 100),
            fictional_time          TEXT    NOT NULL,
            created_at              TEXT    NOT NULL
        );

        -- ====================================================================
        -- 6. Exactly 10 Indexes
        -- ====================================================================
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_rel_unique_directional
            ON lws_character_relationships(simulation_id, source_character_id, target_character_id)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_rel_source
            ON lws_character_relationships(simulation_id, source_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_rel_target
            ON lws_character_relationships(simulation_id, target_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_rel_evidence_rel
            ON lws_relationship_evidence(relationship_id, fictional_time DESC);

        CREATE INDEX IF NOT EXISTS idx_lws_rel_evidence_sim_time
            ON lws_relationship_evidence(simulation_id, fictional_time DESC);

        CREATE INDEX IF NOT EXISTS idx_lws_social_info_sim_subj
            ON lws_social_information(simulation_id, subject_key);

        CREATE INDEX IF NOT EXISTS idx_lws_social_info_tree
            ON lws_social_information(root_social_information_id, parent_social_information_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_lws_faction_mem_unique
            ON lws_character_faction_memberships(simulation_id, simulation_character_id, faction_id)
            WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_lws_faction_mem_char
            ON lws_character_faction_memberships(simulation_id, simulation_character_id);

        CREATE INDEX IF NOT EXISTS idx_lws_dev_records_char_time
            ON lws_character_development_records(simulation_character_id, fictional_time DESC);

        -- ====================================================================
        -- 7. Exactly 15 Triggers
        -- ====================================================================

        -- Trigger 1: Relationships — Prohibit self-relationship
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_relationships_no_self_rel
        BEFORE INSERT ON lws_character_relationships
        BEGIN
            SELECT CASE
                WHEN NEW.source_character_id = NEW.target_character_id
                THEN RAISE(ABORT, 'Source and target characters cannot be the same')
            END;
        END;

        -- Trigger 2: Relationships — Enforce same simulation
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_relationships_same_sim
        BEFORE INSERT ON lws_character_relationships
        BEGIN
            SELECT CASE
                WHEN (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.source_character_id
                ) != NEW.simulation_id
                OR (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.target_character_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Relationship characters must belong to the same simulation')
            END;
        END;

        -- Trigger 3: Relationships — Enforce immutability of identity columns
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_relationships_immutability
        BEFORE UPDATE ON lws_character_relationships
        BEGIN
            SELECT CASE
                WHEN OLD.simulation_id != NEW.simulation_id
                THEN RAISE(ABORT, 'simulation_id is immutable on lws_character_relationships')
                WHEN OLD.source_character_id != NEW.source_character_id
                THEN RAISE(ABORT, 'source_character_id is immutable on lws_character_relationships')
                WHEN OLD.target_character_id != NEW.target_character_id
                THEN RAISE(ABORT, 'target_character_id is immutable on lws_character_relationships')
            END;
        END;

        -- Trigger 4: Relationships — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_relationships_no_delete
        BEFORE DELETE ON lws_character_relationships
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_relationships is prohibited');
        END;

        -- Trigger 5: Evidence — Enforce same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_relationship_evidence_same_sim
        BEFORE INSERT ON lws_relationship_evidence
        BEGIN
            SELECT CASE
                WHEN (
                    SELECT simulation_id FROM lws_character_relationships WHERE id = NEW.relationship_id
                ) != NEW.simulation_id
                OR (
                    SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Evidence relationship and event must belong to the same simulation')
            END;
        END;

        -- Trigger 6: Evidence — Prohibit updates (immutable ledger)
        CREATE TRIGGER IF NOT EXISTS trg_lws_relationship_evidence_no_update
        BEFORE UPDATE ON lws_relationship_evidence
        BEGIN
            SELECT RAISE(ABORT, 'updates to lws_relationship_evidence are prohibited');
        END;

        -- Trigger 7: Evidence — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_relationship_evidence_no_delete
        BEFORE DELETE ON lws_relationship_evidence
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_relationship_evidence is prohibited');
        END;

        -- Trigger 8: Social Information — Enforce simulation integrity on insert
        CREATE TRIGGER IF NOT EXISTS trg_lws_social_information_same_sim
        BEFORE INSERT ON lws_social_information
        BEGIN
            SELECT CASE
                WHEN NEW.originator_character_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.originator_character_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Originator character must belong to the same simulation')
                WHEN NEW.transmitter_character_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.transmitter_character_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Transmitter character must belong to the same simulation')
                WHEN NEW.recipient_character_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.recipient_character_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Recipient character must belong to the same simulation')
                WHEN NEW.causal_event_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_events WHERE id = NEW.causal_event_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Causal event must belong to the same simulation')
                WHEN NEW.parent_social_information_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_social_information WHERE id = NEW.parent_social_information_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Parent social information must belong to the same simulation')
                WHEN NEW.root_social_information_id IS NOT NULL AND (
                    SELECT simulation_id FROM lws_social_information WHERE id = NEW.root_social_information_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Root social information must belong to the same simulation')
            END;
        END;

        -- Trigger 9: Social Information — Prohibit updates (immutable tree)
        CREATE TRIGGER IF NOT EXISTS trg_lws_social_information_no_update
        BEFORE UPDATE ON lws_social_information
        BEGIN
            SELECT RAISE(ABORT, 'updates to lws_social_information are prohibited');
        END;

        -- Trigger 10: Social Information — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_social_information_no_delete
        BEFORE DELETE ON lws_social_information
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_social_information is prohibited');
        END;

        -- Trigger 11: Faction Memberships — Enforce same simulation integrity
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_faction_memberships_same_sim
        BEFORE INSERT ON lws_character_faction_memberships
        BEGIN
            SELECT CASE
                WHEN (
                    SELECT simulation_id FROM lws_simulation_characters WHERE id = NEW.simulation_character_id
                ) != NEW.simulation_id
                THEN RAISE(ABORT, 'Character must belong to the same simulation')
            END;
        END;

        -- Trigger 12: Faction Memberships — Enforce immutability of identity columns
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_faction_memberships_immutability
        BEFORE UPDATE ON lws_character_faction_memberships
        BEGIN
            SELECT CASE
                WHEN OLD.simulation_id != NEW.simulation_id
                THEN RAISE(ABORT, 'simulation_id is immutable on lws_character_faction_memberships')
                WHEN OLD.simulation_character_id != NEW.simulation_character_id
                THEN RAISE(ABORT, 'simulation_character_id is immutable on lws_character_faction_memberships')
                WHEN OLD.faction_id != NEW.faction_id
                THEN RAISE(ABORT, 'faction_id is immutable on lws_character_faction_memberships')
            END;
        END;

        -- Trigger 13: Faction Memberships — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_faction_memberships_no_delete
        BEFORE DELETE ON lws_character_faction_memberships
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_faction_memberships is prohibited');
        END;

        -- Trigger 14: Development Records — Prohibit updates (immutable audit ledger)
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_development_records_no_update
        BEFORE UPDATE ON lws_character_development_records
        BEGIN
            SELECT RAISE(ABORT, 'updates to lws_character_development_records are prohibited');
        END;

        -- Trigger 15: Development Records — Prohibit physical deletion
        CREATE TRIGGER IF NOT EXISTS trg_lws_character_development_records_no_delete
        BEFORE DELETE ON lws_character_development_records
        BEGIN
            SELECT RAISE(ABORT, 'physical deletion from lws_character_development_records is prohibited');
        END;
    `);
}
