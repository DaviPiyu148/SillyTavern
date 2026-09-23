import express from 'express';
import { getLwsStatus, isLwsAvailable } from '../living-world/index.js';

const router = express.Router();

/**
 * GET /api/living-world/status
 *
 * Reports the operational status and schema version of the LWS subsystem.
 * Returns HTTP 200 when healthy.
 * Returns HTTP 503 Service Unavailable when LWS is degraded or uninitialized.
 */
router.get('/status', (req, res) => {
    try {
        const status = getLwsStatus();

        if (!status.initialized) {
            return res.status(503).json({
                error: 'Living World subsystem is unavailable',
                initialized: false,
                schemaVersion: null,
            });
        }

        return res.json(status);
    } catch (err) {
        console.error('[LWS API] Unexpected error in GET /status:', err);
        return res.status(503).json({
            error: 'Living World subsystem is unavailable',
            initialized: false,
            schemaVersion: null,
        });
    }
});

/**
 * POST /api/living-world/ping
 *
 * Verifies that the LWS API boundary is reachable and responsive.
 * Returns HTTP 200 when healthy.
 * Returns HTTP 503 Service Unavailable when LWS is degraded or uninitialized.
 */
router.post('/ping', (req, res) => {
    try {
        if (!isLwsAvailable()) {
            return res.status(503).json({
                error: 'Living World subsystem is unavailable',
            });
        }

        return res.json({
            pong: true,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error('[LWS API] Unexpected error in POST /ping:', err);
        return res.status(503).json({
            error: 'Living World subsystem is unavailable',
        });
    }
});

export { router };
