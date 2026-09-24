/**
 * In-memory simulation mutex manager.
 * Guarantees single-writer concurrency control per simulation.
 */
export class SimulationLockManager {
    constructor() {
        /** @type {Map<string, Promise<void>>} */
        this.chains = new Map();
    }

    /**
     * Executes an async callback holding an exclusive lock on simLwsId.
     * Guarantees strict sequential execution for the same simulation.
     *
     * @template T
     * @param {string} simLwsId
     * @param {() => Promise<T>|T} fn
     * @returns {Promise<T>}
     */
    async withLock(simLwsId, fn) {
        const prev = this.chains.get(simLwsId) || Promise.resolve();
        let releaseLock;
        const currentLock = new Promise((resolve) => {
            releaseLock = resolve;
        });
        this.chains.set(simLwsId, currentLock);

        await prev.catch(() => {});
        try {
            return await fn();
        } finally {
            releaseLock();
            if (this.chains.get(simLwsId) === currentLock) {
                this.chains.delete(simLwsId);
            }
        }
    }
}

export const simulationLocks = new SimulationLockManager();
