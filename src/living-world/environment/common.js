/**
 * Living World Simulator (LWS) - Environment Taxonomies and Diurnal Calculations
 */

export const WEATHER_TYPES = Object.freeze([
    'clear',
    'partly_cloudy',
    'overcast',
    'fog',
    'rain',
    'heavy_rain',
    'storm',
    'snow',
    'blizzard',
    'heatwave',
]);

export const LIGHTING_LEVELS = Object.freeze([
    'pitch_black',
    'dim',
    'normal',
    'bright',
    'blinding',
]);

export const AIR_QUALITY_TYPES = Object.freeze([
    'clean',
    'hazy',
    'smoke',
    'toxic',
]);

export const ACCESS_STATUSES = Object.freeze([
    'open',
    'closed',
    'restricted',
    'barricaded',
    'abandoned',
]);

export const CROWD_DENSITIES = Object.freeze([
    'empty',
    'sparse',
    'moderate',
    'crowded',
    'packed',
]);

/**
 * Computes deterministic diurnal outdoor and indoor temperature.
 * Peak around 14:00-15:00 (+5.0°C), trough around 03:00-04:00 (-5.0°C).
 * Indoor locations buffer temperature towards 21.0°C.
 *
 * @param {string} fictionalTime ISO timestamp string (e.g. '2026-06-15T14:30:00Z')
 * @param {number} [baselineTemperature=20.0] Base climate temperature
 * @param {boolean} [isIndoor=false] Whether location is indoor
 * @returns {number} Temperature in Celsius, bounded [-50.0, 60.0], rounded to 1 decimal
 */
export function calculateDiurnalTemperature(fictionalTime, baselineTemperature = 20.0, isIndoor = false) {
    const date = new Date(fictionalTime);
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

    let diurnalDelta;
    if (hours >= 4 && hours <= 14) {
        // Daytime: rising from -5.0°C at 04:00 to +5.0°C at 14:00, crossing baseline at 09:00
        diurnalDelta = 5.0 * Math.sin(((hours - 9) * Math.PI) / 10);
    } else {
        // Nighttime: falling from +5.0°C at 14:00 to -5.0°C at 04:00
        const nightHours = hours < 4 ? hours + 24 : hours;
        diurnalDelta = 5.0 * Math.cos(((nightHours - 14) * Math.PI) / 14);
    }

    const outdoorTemp = baselineTemperature + diurnalDelta;

    let finalTemp = outdoorTemp;
    if (isIndoor) {
        // Indoor buffering damps temperature swing towards 21.0°C (80% indoor insulation buffer)
        finalTemp = 21.0 + 0.2 * (outdoorTemp - 21.0);
    }

    // Clamp to valid range [-50.0, 60.0] and round to 1 decimal place
    const clamped = Math.max(-50.0, Math.min(60.0, finalTemp));
    return Math.round(clamped * 10) / 10;
}

/**
 * Computes deterministic diurnal lighting level.
 *
 * @param {string} fictionalTime ISO timestamp string
 * @param {boolean} [isIndoor=false] Whether location is indoor
 * @param {boolean} [hasIlluminatedTag=false] Whether location has artificial lighting
 * @param {string} [weather='clear'] Current location weather
 * @returns {string} Lighting level: 'pitch_black' | 'dim' | 'normal' | 'bright' | 'blinding'
 */
export function calculateDiurnalLighting(fictionalTime, isIndoor = false, hasIlluminatedTag = false, weather = 'clear') {
    if (isIndoor) {
        if (hasIlluminatedTag) {
            return 'dim';
        }
    }

    const date = new Date(fictionalTime);
    const hours = date.getUTCHours() + date.getUTCMinutes() / 60;

    // Deep night: 21:00 - 05:00
    if (hours >= 21 || hours < 5) {
        if (hasIlluminatedTag) return 'dim';
        return 'pitch_black';
    }

    // Dawn: 05:00 - 07:00
    if (hours >= 5 && hours < 7) {
        return 'dim';
    }

    // Day: 07:00 - 19:00
    if (hours >= 7 && hours < 19) {
        if (weather === 'storm' || weather === 'blizzard') {
            return 'dim';
        }
        if (hours >= 10 && hours <= 15) {
            return 'bright';
        }
        return 'normal';
    }

    // Dusk: 19:00 - 21:00
    if (hours >= 19 && hours < 21) {
        return 'dim';
    }

    return hasIlluminatedTag ? 'dim' : 'pitch_black';
}

/**
 * Evaluates whether location is open or closed based on operating hours.
 *
 * @param {string} fictionalTime ISO timestamp string
 * @param {object|string|null} operatingHours Operating hours schedule
 * @returns {string} 'open' | 'closed'
 */
export function evaluateOperatingHours(fictionalTime, operatingHours) {
    if (!operatingHours) {
        return 'open';
    }

    let schedule = operatingHours;
    if (typeof schedule === 'string') {
        try {
            schedule = JSON.parse(schedule);
        } catch {
            return 'open';
        }
    }

    if (!schedule || typeof schedule !== 'object') {
        return 'open';
    }

    const date = new Date(fictionalTime);
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayNames[dayOfWeek];
    const prevDayName = dayNames[(dayOfWeek + 6) % 7];

    const currentHour = date.getUTCHours();
    const currentMinute = date.getUTCMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    // Format 1: { open: '08:00', close: '22:00', days: [1,2,3,4,5] }
    if (schedule.open && schedule.close) {
        if (Array.isArray(schedule.days) && !schedule.days.includes(dayOfWeek)) {
            return 'closed';
        }
        const { open, close } = schedule;
        if (open <= close) {
            // Standard daytime schedule, e.g. 08:00 to 22:00
            if (currentTimeStr >= open && currentTimeStr < close) {
                return 'open';
            }
            return 'closed';
        } else {
            // Overnight schedule, e.g. 20:00 to 04:00
            if (currentTimeStr >= open || currentTimeStr < close) {
                return 'open';
            }
            return 'closed';
        }
    }

    // Format 2: Day-name or day-index keyed schedule
    // Check previous day's overnight spillover first
    let prevDaySchedule = undefined;
    if (prevDayName in schedule) {
        prevDaySchedule = schedule[prevDayName];
    } else if (String((dayOfWeek + 6) % 7) in schedule) {
        prevDaySchedule = schedule[String((dayOfWeek + 6) % 7)];
    } else if (((dayOfWeek + 6) % 7) in schedule) {
        prevDaySchedule = schedule[(dayOfWeek + 6) % 7];
    }
    if (prevDaySchedule && prevDaySchedule.open && prevDaySchedule.close && prevDaySchedule.open > prevDaySchedule.close) {
        if (currentTimeStr < prevDaySchedule.close) {
            return 'open';
        }
    }

    let daySchedule = undefined;
    if (currentDayName in schedule) {
        daySchedule = schedule[currentDayName];
    } else if (String(dayOfWeek) in schedule) {
        daySchedule = schedule[String(dayOfWeek)];
    } else if (dayOfWeek in schedule) {
        daySchedule = schedule[dayOfWeek];
    } else {
        // If schedule has day keys but current day is omitted, venue is closed
        return 'closed';
    }

    if (daySchedule === null || daySchedule === undefined) {
        return 'closed';
    }

    if (typeof daySchedule === 'object') {
        if (daySchedule.closed) {
            return 'closed';
        }
        if (daySchedule.open && daySchedule.close) {
            const { open, close } = daySchedule;
            if (open <= close) {
                if (currentTimeStr >= open && currentTimeStr < close) {
                    return 'open';
                }
                return 'closed';
            } else {
                if (currentTimeStr >= open || currentTimeStr < close) {
                    return 'open';
                }
                return 'closed';
            }
        }
    }

    return 'open';
}

