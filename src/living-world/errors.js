/**
 * Living World Simulator (LWS) - Error Definitions
 */

export class LwsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LwsError';
    }
}

export class LwsNotInitializedError extends LwsError {
    constructor(message = 'Living World subsystem is unavailable or not initialized') {
        super(message);
        this.name = 'LwsNotInitializedError';
    }
}

export class LwsValidationError extends LwsError {
    /**
     * @param {string} message
     * @param {string[]} [fields]
     */
    constructor(message, fields = []) {
        super(message);
        this.name = 'LwsValidationError';
        this.fields = fields;
    }
}

export class LwsNotFoundError extends LwsError {
    constructor(message = 'LWS entity not found') {
        super(message);
        this.name = 'LwsNotFoundError';
    }
}

export class LwsConflictError extends LwsError {
    constructor(message = 'LWS entity conflict') {
        super(message);
        this.name = 'LwsConflictError';
    }
}
