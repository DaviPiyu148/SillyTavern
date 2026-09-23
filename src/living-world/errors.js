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

export class LwsAuthorityError extends LwsError {
    /**
     * @param {string} message
     * @param {string} [code]
     * @param {string[]} [fields]
     */
    constructor(message = 'Proposed action rejected by simulation authority', code = 'AUTHORITY_ERROR', fields = []) {
        super(message);
        this.name = 'LwsAuthorityError';
        this.code = code;
        this.fields = fields;
    }
}

export class LwsTurnRejectedError extends LwsError {
    /**
     * @param {object} turn
     */
    constructor(turn) {
        super(turn?.error_details ? `Narrative turn rejected: ${turn.error_details}` : 'Narrative turn rejected');
        this.name = 'LwsTurnRejectedError';
        this.turn = turn;
    }
}

