import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { getDb } from '../db.js';
import { LwsValidationError, LwsBackupError } from '../errors.js';

export const DEFAULT_MAX_BACKUP_COUNT = 10;
export const DEFAULT_MAX_BACKUP_AGE_DAYS = 30;
export const MIN_RETAINED_BACKUPS = 1;

const FILENAME_REGEX = /^[a-zA-Z0-9_\-\.]+\.db$/;
const ENCODED_TRAVERSAL_REGEX = /%2f|%5c|%2e|%00/i;
const DRIVE_PREFIX_REGEX = /^[a-zA-Z]:/;

/**
 * Resolves the designated LWS backups directory path.
 * @returns {string}
 */
export function getBackupDirectory() {
    const dataRoot = globalThis.DATA_ROOT || path.join(process.cwd(), 'data');
    return path.join(dataRoot, 'living-world', 'backups');
}

/**
 * Validates a raw backup destination filename string before any path construction or filesystem resolution.
 * Rejects separators, traversal tokens, encoded sequences, drive prefixes, and non-.db filenames.
 *
 * @param {string | null | undefined} rawFilename
 * @returns {string} The validated filename
 */
export function validateBackupFilename(rawFilename) {
    if (rawFilename === undefined || rawFilename === null || rawFilename === '') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `lws-backup-${timestamp}.db`;
    }

    if (typeof rawFilename !== 'string') {
        throw new LwsValidationError('Backup destination filename must be a string', ['destination_filename']);
    }

    // 1. Check for encoded traversal/separator sequences
    if (ENCODED_TRAVERSAL_REGEX.test(rawFilename)) {
        throw new LwsValidationError('Encoded traversal sequences are forbidden in backup destination filename', ['destination_filename']);
    }

    // 2. Check for path separators, drive prefixes, and null bytes
    if (rawFilename.includes('/') || rawFilename.includes('\\') || rawFilename.includes('\0') || DRIVE_PREFIX_REGEX.test(rawFilename)) {
        throw new LwsValidationError('Path separators and drive prefixes are forbidden in backup destination filename', ['destination_filename']);
    }

    // 3. Check for standalone or relative traversal tokens
    if (rawFilename === '.' || rawFilename === '..' || rawFilename.startsWith('..') || rawFilename.includes('/..') || rawFilename.includes('\\..')) {
        throw new LwsValidationError('Relative directory traversal tokens are forbidden in backup destination filename', ['destination_filename']);
    }

    // 4. Validate length bounds (4 to 128 characters)
    if (rawFilename.length < 4 || rawFilename.length > 128) {
        throw new LwsValidationError('Backup destination filename length must be between 4 and 128 characters', ['destination_filename']);
    }

    // 5. Strict regex format check
    if (!FILENAME_REGEX.test(rawFilename) || !rawFilename.endsWith('.db')) {
        throw new LwsValidationError('Backup destination filename must match format [a-zA-Z0-9_.-]+.db', ['destination_filename']);
    }

    return rawFilename;
}

/**
 * Executes a point-in-time hot backup of the LWS SQLite database.
 * Utilizes SQLite's native online backup API (sqlite3_backup_* via better-sqlite3).
 *
 * @param {object} [options]
 * @param {string} [options.destination_filename] Optional custom backup filename
 * @param {number} [options.max_count] Maximum number of backups to retain
 * @param {number} [options.max_age_days] Maximum age in days before pruning
 * @returns {Promise<object>} Backup completion summary
 */
export async function backupDatabase(options = {}) {
    const rawFilename = options.destination_filename;
    const maxCount = typeof options.max_count === 'number' && options.max_count >= 1 ? options.max_count : DEFAULT_MAX_BACKUP_COUNT;
    const maxAgeDays = typeof options.max_age_days === 'number' && options.max_age_days >= 1 ? options.max_age_days : DEFAULT_MAX_BACKUP_AGE_DAYS;

    const filename = validateBackupFilename(rawFilename);
    const backupDir = getBackupDirectory();

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    // Explicit filesystem realpath check to guard against symlink path-escape
    const realBackupDir = fs.realpathSync(backupDir);
    const destPath = path.resolve(realBackupDir, filename);
    const expectedPrefix = realBackupDir + path.sep;

    if (!destPath.startsWith(expectedPrefix)) {
        throw new LwsValidationError('Backup destination path escape forbidden', ['destination_filename']);
    }

    const db = getDb();

    try {
        // better-sqlite3 .backup(destPath) executes sqlite3_backup_* asynchronously
        await db.backup(destPath);
    } catch (err) {
        // Clean up partial/incomplete file on failure
        if (fs.existsSync(destPath)) {
            try {
                fs.unlinkSync(destPath);
            } catch (_) {
                // Ignore cleanup error
            }
        }

        const msg = String(err?.message || '');
        if (msg.includes('busy') || msg.includes('locked') || err?.code === 'SQLITE_BUSY' || err?.code === 'SQLITE_LOCKED') {
            throw new LwsBackupError('Database is currently busy, please retry later', 'DATABASE_BUSY');
        }

        console.error('[LWS Backup] Online backup failed:', err);
        throw new LwsBackupError(`Database backup failed: ${err.message}`, 'BACKUP_FAILED');
    }

    const stat = fs.statSync(destPath);

    // Execute retention rotation
    const rotationResult = rotateBackups({
        backupDir: realBackupDir,
        max_count: maxCount,
        max_age_days: maxAgeDays,
        preserveFilename: filename,
    });

    return {
        status: 'completed',
        backup_filename: filename,
        backup_path: destPath,
        size_bytes: stat.size,
        timestamp: new Date().toISOString(),
        pruned_count: rotationResult.prunedCount,
        warnings: rotationResult.warnings,
    };
}

/**
 * Rotates and prunes older backup files according to count and age policies.
 * Guarantees MIN_RETAINED_BACKUPS = 1 invariant and protects live DB / WAL / SHM files.
 *
 * @param {object} params
 * @param {string} params.backupDir
 * @param {number} [params.max_count]
 * @param {number} [params.max_age_days]
 * @param {string} [params.preserveFilename] The newly created backup filename to exempt from pruning
 * @returns {{ prunedCount: number, warnings: string[] }}
 */
export function rotateBackups({ backupDir, max_count = DEFAULT_MAX_BACKUP_COUNT, max_age_days = DEFAULT_MAX_BACKUP_AGE_DAYS, preserveFilename = null }) {
    const warnings = [];
    let prunedCount = 0;

    if (!fs.existsSync(backupDir)) {
        return { prunedCount: 0, warnings: [] };
    }

    const files = fs.readdirSync(backupDir);
    const backupFiles = [];

    const now = Date.now();
    const maxAgeMs = max_age_days * 24 * 60 * 60 * 1000;

    for (const f of files) {
        // Never touch live db, wal, or shm files
        if (f === 'lws.db' || f === 'lws.db-wal' || f === 'lws.db-shm') {
            continue;
        }
        if (!FILENAME_REGEX.test(f)) {
            continue;
        }

        const fullPath = path.join(backupDir, f);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
                backupFiles.push({
                    name: f,
                    path: fullPath,
                    mtime: stat.mtimeMs,
                    isPreserved: preserveFilename ? f === preserveFilename : false,
                });
            }
        } catch (err) {
            warnings.push(`Failed to stat backup file ${f}: ${err.message}`);
        }
    }

    // Sort ascending by modification time (oldest first)
    backupFiles.sort((a, b) => a.mtime - b.mtime);

    // Keep at least MIN_RETAINED_BACKUPS = 1 newest backup unconditionally
    let remainingCount = backupFiles.length;

    for (const b of backupFiles) {
        if (remainingCount <= MIN_RETAINED_BACKUPS) {
            break;
        }
        if (b.isPreserved) {
            continue;
        }

        const isOverCount = remainingCount > max_count;
        const isOverAge = (now - b.mtime) > maxAgeMs;

        if (isOverCount || isOverAge) {
            try {
                fs.unlinkSync(b.path);
                prunedCount++;
                remainingCount--;
            } catch (err) {
                warnings.push(`Failed to delete old backup ${b.name}: ${err.message}`);
            }
        }
    }

    return { prunedCount, warnings };
}
