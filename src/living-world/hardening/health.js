import process from 'node:process';
import { isDbAvailable, getDbVersion } from '../db.js';
import { simulationLocks } from '../simulations/lock.js';

/**
 * Builds safe, sanitized operational health metrics for the unauthenticated /health endpoint.
 * Strictly avoids exposing filesystem paths, entity identifiers, simulation content, or database internals.
 *
 * @returns {object} Safe health status payload
 */
export function getHealthStatus() {
    const isAvailable = isDbAvailable();
    const schemaVersion = getDbVersion() ?? 0;

    let status = 'unavailable';
    if (isAvailable && schemaVersion === 9) {
        status = 'healthy';
    } else if (isAvailable) {
        status = 'degraded';
    }

    const mem = process.memoryUsage();
    const memoryMb = {
        rss: Math.round(mem.rss / (1024 * 1024)),
        heap_used: Math.round(mem.heapUsed / (1024 * 1024)),
        heap_total: Math.round(mem.heapTotal / (1024 * 1024)),
    };

    const activeSimulationsCount = simulationLocks.chains?.size ?? 0;

    return {
        status,
        schema_version: schemaVersion,
        initialized: isAvailable,
        uptime_seconds: Math.floor(process.uptime()),
        active_simulations_count: activeSimulationsCount,
        memory_mb: memoryMb,
    };
}
