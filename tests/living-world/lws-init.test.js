import { describe, test, expect, afterEach } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
    init,
    onExit,
    getLwsStatus,
    isLwsAvailable,
    getDb,
    getDbVersion,
    closeDb,
} from '../../src/living-world/index.js';
import { LwsNotInitializedError } from '../../src/living-world/errors.js';

describe('LWS Subsystem Lifecycle and Initialization', () => {
    const createdTempDirs = [];

    function makeTempDataRoot(prefix = 'lws-init-test-') {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        createdTempDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        await onExit();
        for (const dir of createdTempDirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
        createdTempDirs.length = 0;
    });

    test('initializes cleanly and creates data/living-world/ directory and lws.db file', async () => {
        const tempRoot = makeTempDataRoot();
        const customDbPath = path.join(tempRoot, 'living-world', 'lws.db');

        const success = await init({ dbPath: customDbPath });
        expect(success).toBe(true);

        expect(fs.existsSync(path.dirname(customDbPath))).toBe(true);
        expect(fs.existsSync(customDbPath)).toBe(true);

        const status = getLwsStatus();
        expect(status.initialized).toBe(true);
        expect(status.schemaVersion).toBe(7);

        expect(isLwsAvailable()).toBe(true);
        expect(getDb()).toBeDefined();
        expect(getDbVersion()).toBe(7);
    });

    test('idempotent initialization does not throw and preserves state', async () => {
        const tempRoot = makeTempDataRoot();
        const customDbPath = path.join(tempRoot, 'living-world', 'lws.db');

        const firstInit = await init({ dbPath: customDbPath });
        expect(firstInit).toBe(true);

        const secondInit = await init({ dbPath: customDbPath });
        expect(secondInit).toBe(true);

        const status = getLwsStatus();
        expect(status.initialized).toBe(true);
        expect(status.schemaVersion).toBe(7);
    });


    test('clean shutdown closes database connection and resets status', async () => {
        const tempRoot = makeTempDataRoot();
        const customDbPath = path.join(tempRoot, 'living-world', 'lws.db');

        await init({ dbPath: customDbPath });
        expect(isLwsAvailable()).toBe(true);

        await onExit();

        const status = getLwsStatus();
        expect(status.initialized).toBe(false);
        expect(status.schemaVersion).toBeNull();
        expect(isLwsAvailable()).toBe(false);
        expect(() => getDb()).toThrow(LwsNotInitializedError);
    });

    test('controlled initialization failure marks LWS unavailable, cleans up handles, and does not throw', async () => {
        // Provide an illegal path (a directory path as the file path where a directory already exists)
        const tempRoot = makeTempDataRoot();
        const conflictingDirPath = path.join(tempRoot, 'conflict-dir');
        fs.mkdirSync(conflictingDirPath);

        // Attempting to open conflictingDirPath as a SQLite database file should fail on Windows/Node
        // Or using an unwritable read-only directory
        const invalidDbPath = path.join(conflictingDirPath, 'sub', '\0invalid.db');

        const initResult = await init({ dbPath: invalidDbPath });

        // Non-fatal policy: returns false, does not throw out
        expect(initResult).toBe(false);

        const status = getLwsStatus();
        expect(status.initialized).toBe(false);
        expect(status.schemaVersion).toBeNull();
        expect(isLwsAvailable()).toBe(false);

        // Attempting getDb() throws LwsNotInitializedError
        expect(() => getDb()).toThrow(LwsNotInitializedError);

        // Cleanup call does not throw
        expect(() => closeDb()).not.toThrow();
    });
});
