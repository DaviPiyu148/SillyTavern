import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import {
    backupDatabase,
    rotateBackups,
    validateBackupFilename,
    MIN_RETAINED_BACKUPS,
} from '../../src/living-world/hardening/backup.js';
import { LwsValidationError, LwsBackupError } from '../../src/living-world/errors.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';

describe('LWS Phase 13 Hardening — Persistence Durability & Hot Online Backup', () => {
    let tempDir;
    let originalDataRoot;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-hardening-backup-'));
        originalDataRoot = globalThis.DATA_ROOT;
        globalThis.DATA_ROOT = tempDir;

        const dbPath = path.join(tempDir, 'living-world', 'lws.db');
        openDb(dbPath);
    });

    afterEach(() => {
        closeDb();
        globalThis.DATA_ROOT = originalDataRoot;
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {
                // Ignore cleanup lock in Windows temp
            }
        }
    });

    test('validates raw backup filenames and rejects traversal, encoded sequences, drive prefixes, and null bytes', () => {
        // Valid custom filename
        expect(validateBackupFilename('custom_backup_01.db')).toBe('custom_backup_01.db');

        // Rejects non-string
        expect(() => validateBackupFilename(12345)).toThrow(LwsValidationError);

        // Rejects encoded sequences
        expect(() => validateBackupFilename('backup%2fescape.db')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('backup%5cescape.db')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('backup%2e%2eescape.db')).toThrow(LwsValidationError);

        // Rejects separators and drive prefixes
        expect(() => validateBackupFilename('../escape.db')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('sub/folder.db')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('C:escaped.db')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('null\0byte.db')).toThrow(LwsValidationError);

        // Rejects invalid extensions
        expect(() => validateBackupFilename('backup.sqlite')).toThrow(LwsValidationError);
        expect(() => validateBackupFilename('backup.txt')).toThrow(LwsValidationError);
    });

    test('executes hot online backup producing an uncorrupted, valid SQLite database', async () => {
        createWorld({ name: 'Backup Test World' });

        const result = await backupDatabase({ destination_filename: 'valid_test_backup.db' });
        expect(result.status).toBe('completed');
        expect(result.backup_filename).toBe('valid_test_backup.db');
        expect(fs.existsSync(result.backup_path)).toBe(true);

        // Open the backup file independently and verify structural integrity
        const backupDb = new Database(result.backup_path);
        const integrity = backupDb.pragma('integrity_check');
        expect(integrity[0].integrity_check).toBe('ok');

        const fkErrors = backupDb.pragma('foreign_key_check');
        expect(fkErrors).toHaveLength(0);

        const worlds = backupDb.prepare('SELECT name FROM lws_worlds').all();
        expect(worlds).toHaveLength(1);
        expect(worlds[0].name).toBe('Backup Test World');

        backupDb.close();
    });

    test('enforces backup retention rotation and strictly preserves MIN_RETAINED_BACKUPS = 1 invariant', () => {
        const backupDir = path.join(tempDir, 'living-world', 'backups');
        fs.mkdirSync(backupDir, { recursive: true });

        // Create 5 dummy backup files with staggered timestamps
        const now = Date.now();
        for (let i = 1; i <= 5; i++) {
            const filePath = path.join(backupDir, `lws-backup-0${i}.db`);
            fs.writeFileSync(filePath, 'dummy_backup_content');
            const time = (now - (5 - i) * 10000) / 1000;
            fs.utimesSync(filePath, time, time);
        }

        expect(fs.readdirSync(backupDir)).toHaveLength(5);

        // Rotate with max_count = 2, protecting the newest file (lws-backup-05.db)
        const rotation = rotateBackups({
            backupDir,
            max_count: 2,
            max_age_days: 30,
            preserveFilename: 'lws-backup-05.db',
        });

        expect(rotation.prunedCount).toBe(3);
        const remaining = fs.readdirSync(backupDir);
        expect(remaining).toHaveLength(2);
        expect(remaining).toContain('lws-backup-05.db');
        expect(remaining).toContain('lws-backup-04.db');

        // Extreme pruning with max_count = 0 must still preserve MIN_RETAINED_BACKUPS = 1
        const extremeRotation = rotateBackups({
            backupDir,
            max_count: 0,
            max_age_days: 0,
        });

        const finalRemaining = fs.readdirSync(backupDir);
        expect(finalRemaining.length).toBeGreaterThanOrEqual(MIN_RETAINED_BACKUPS);
    });

    test('verifies atomic rollback on transaction failure leaving live database uncorrupted', () => {
        const db = getDb();
        createWorld({ name: 'Pre-Crash World' });

        expect(() => {
            const failingTx = db.transaction(() => {
                createWorld({ name: 'Uncommitted World' });
                throw new Error('SIMULATED_TRANSACTION_FAILURE');
            });
            failingTx();
        }).toThrow('SIMULATED_TRANSACTION_FAILURE');

        // Verify uncommitted world was rolled back cleanly
        const worlds = db.prepare('SELECT name FROM lws_worlds').all();
        expect(worlds).toHaveLength(1);
        expect(worlds[0].name).toBe('Pre-Crash World');

        // Check database integrity
        const integrity = db.pragma('integrity_check');
        expect(integrity[0].integrity_check).toBe('ok');
    });
});
