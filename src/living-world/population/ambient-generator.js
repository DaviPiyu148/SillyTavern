/**
 * Living World Simulator (LWS) - Deterministic Contextual Ambient Generator
 */

import { buildTransientId } from './common.js';

/**
 * Simple deterministic 32-bit hash function (Jenkins-like / Murmur-like string hash).
 *
 * @param {string} str
 * @returns {number} 32-bit integer
 */
function hashString(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * Creates a deterministic Mulberry32 PRNG from an initial integer seed.
 *
 * @param {number} seed
 * @returns {() => number} Returns float in [0, 1)
 */
function createPrng(seed) {
    let s = seed >>> 0;
    return function next() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Resolves time-of-day window string from discrete hour bucket.
 *
 * @param {number} timeBucket
 * @returns {'morning'|'afternoon'|'evening'|'night'}
 */
export function getTimeWindow(timeBucket) {
    if (typeof timeBucket === 'string') {
        const lower = timeBucket.toLowerCase().trim();
        if (['morning', 'afternoon', 'evening', 'night'].includes(lower)) {
            return lower;
        }
        const parsed = parseInt(timeBucket, 10);
        if (!Number.isNaN(parsed)) {
            timeBucket = parsed;
        }
    }

    const hourOfDay = ((Number(timeBucket) % 24) + 24) % 24;
    if (hourOfDay >= 5 && hourOfDay < 12) {
        return 'morning';
    }
    if (hourOfDay >= 12 && hourOfDay < 17) {
        return 'afternoon';
    }
    if (hourOfDay >= 17 && hourOfDay < 22) {
        return 'evening';
    }
    return 'night';
}

/**
 * Generates deterministic ambient population for a given simulation, location, and time bucket.
 *
 * @param {string} simLwsId
 * @param {string} locLwsId
 * @param {number} timeBucket
 * @param {number} worldId
 * @param {object} environment Location environment state
 * @param {object} operationalState Location operational state
 * @param {object[]} archetypes Available world ambient archetypes
 * @param {object[]} activeSimCharacters Active persistent characters currently at this location
 * @param {object} [locationDetails] Optional location metadata (tags, etc.)
 * @returns {object[]} Array of generated ambient entity objects
 */
export function generateAmbientPopulation(
    simLwsId,
    locLwsId,
    timeBucket,
    worldId,
    environment,
    operationalState,
    archetypes = [],
    activeSimCharacters = [],
    locationDetails = {},
) {
    const seedKey = `${simLwsId}:${locLwsId}:${timeBucket}`;
    const seedInt = hashString(seedKey);
    const rng = createPrng(seedInt);

    // If location is closed, access override is closed, or crowd density is empty -> 0 ambient
    const accessStatus = operationalState?.access_status ?? 'open';
    if (accessStatus === 'closed' || accessStatus === 'barricaded' || accessStatus === 'abandoned') {
        return [];
    }

    const crowdDensity = operationalState?.crowd_density ?? 'moderate';
    if (crowdDensity === 'empty') {
        return [];
    }

    const totalCapacity = operationalState?.ambient_capacity ?? 50;
    const activePersistentCount = activeSimCharacters.length;
    const remainingCapacity = Math.max(0, totalCapacity - activePersistentCount);
    if (remainingCapacity <= 0) {
        return [];
    }

    // Determine target slot count based on density
    let targetCount = 0;
    switch (crowdDensity) {
        case 'sparse':
            targetCount = Math.min(3, remainingCapacity);
            break;
        case 'moderate':
            targetCount = Math.min(6, remainingCapacity);
            break;
        case 'crowded':
            targetCount = Math.min(12, remainingCapacity);
            break;
        case 'packed':
            targetCount = Math.min(20, remainingCapacity);
            break;
        default:
            targetCount = Math.min(5, remainingCapacity);
    }

    if (targetCount <= 0 || archetypes.length === 0) {
        return [];
    }

    const timeWindow = getTimeWindow(timeBucket);
    const currentWeather = environment?.weather || 'clear';

    let locationTags = [];
    if (locationDetails?.tags) {
        try {
            locationTags = typeof locationDetails.tags === 'string'
                ? JSON.parse(locationDetails.tags)
                : locationDetails.tags;
        } catch {
            locationTags = [];
        }
    }

    // Collect names, archetype keys, and roles of active persistent characters at location for duplicate suppression
    const activeNames = new Set(activeSimCharacters.map(c => (c.name || '').toLowerCase()));
    const activeArchetypes = new Set(
        activeSimCharacters.flatMap(c => [
            c.archetype_key,
            c.source_archetype_key,
            c.role,
            ...(Array.isArray(c.roles) ? c.roles : []),
        ]).filter(Boolean)
    );

    // Filter compatible archetypes
    const compatibleArchetypes = archetypes.filter(arch => {
        const timeWindows = arch.time_windows || arch.time_filter_buckets || [];
        const locationTagsFilter = arch.location_tags || arch.location_filter_tags || [];
        const maxInstances = arch.max_concurrent_instances ?? 1;

        // 1. Time window match
        if (Array.isArray(timeWindows) && timeWindows.length > 0) {
            if (!timeWindows.includes(timeWindow)) {
                return false;
            }
        }

        // 2. Weather compatibility match
        if (arch.weather_compat && Array.isArray(arch.weather_compat)) {
            if (!arch.weather_compat.includes(currentWeather)) {
                return false;
            }
        }

        // 3. Location tag matching
        if (Array.isArray(locationTagsFilter) && locationTagsFilter.length > 0) {
            const hasMatchingTag = locationTagsFilter.some(t => locationTags.includes(t));
            if (!hasMatchingTag && locationTags.length > 0) {
                return false;
            }
        }

        // 4. Role suppression for max_concurrent_instances = 1
        if (maxInstances === 1) {
            const archRoles = Array.isArray(arch.roles) ? arch.roles : [];
            const isSuppressed = activeArchetypes.has(arch.archetype_key) ||
                (arch.role_title && activeArchetypes.has(arch.role_title)) ||
                archRoles.some(r => activeArchetypes.has(r));
            if (isSuppressed) {
                return false;
            }
        }

        return true;
    });

    if (compatibleArchetypes.length === 0) {
        return [];
    }

    // Track spawn counts per archetype within this bucket
    const archetypeSpawnCounts = new Map();
    const entities = [];

    for (let slot = 0; slot < targetCount; slot++) {
        // Filter eligible archetypes respecting max_concurrent_instances
        const eligible = compatibleArchetypes.filter(arch => {
            const currentSpawned = archetypeSpawnCounts.get(arch.archetype_key) || 0;
            return currentSpawned < (arch.max_concurrent_instances || 1);
        });

        if (eligible.length === 0) {
            break;
        }

        // Weighted random selection
        const totalWeight = eligible.reduce((acc, a) => acc + (a.spawn_weight ?? a.weight ?? 50), 0);
        let roll = rng() * totalWeight;
        let selectedArch = eligible[0];

        for (const arch of eligible) {
            const weight = arch.spawn_weight ?? arch.weight ?? 50;
            roll -= weight;
            if (roll <= 0) {
                selectedArch = arch;
                break;
            }
        }

        archetypeSpawnCounts.set(selectedArch.archetype_key, (archetypeSpawnCounts.get(selectedArch.archetype_key) || 0) + 1);

        const roleTitle = selectedArch.role_title || selectedArch.name || selectedArch.archetype_key;
        const activities = selectedArch.default_activities || selectedArch.activity_pool || [];

        // Deterministically select name from pool excluding active characters
        let candidateName = roleTitle;
        if (Array.isArray(selectedArch.name_pool) && selectedArch.name_pool.length > 0) {
            const availableNames = selectedArch.name_pool.filter(n => !activeNames.has(n.toLowerCase()));
            const pool = availableNames.length > 0 ? availableNames : selectedArch.name_pool;
            const nameIdx = Math.floor(rng() * pool.length);
            candidateName = pool[nameIdx];
        }

        // Deterministically select activity
        let activity = 'standing around';
        if (Array.isArray(activities) && activities.length > 0) {
            const actIdx = Math.floor(rng() * activities.length);
            activity = activities[actIdx];
        }

        // Format description
        let description = selectedArch.description_template || selectedArch.description || `${roleTitle} at ${locLwsId}`;
        description = description.replace(/\{name\}/g, candidateName);
        description = description.replace(/\{role\}/g, roleTitle);
        description = description.replace(/\{activity\}/g, activity);

        const transientId = buildTransientId(simLwsId, locLwsId, timeBucket, slot);

        entities.push({
            transient_id: transientId,
            name: candidateName,
            archetype_key: selectedArch.archetype_key,
            entity_kind: selectedArch.entity_kind || 'person',
            role_title: roleTitle,
            description,
            current_activity: activity,
            slot_index: slot,
        });
    }

    return entities;
}
