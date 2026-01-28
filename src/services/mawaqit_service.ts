/**
 * Mawaqit Prayer Times Service
 * Fetches prayer times from mawaqit.net for a configured mosque
 */

import {Prayer} from '@/adhan';
import {storage} from '@/store/mmkv';

// Timeout for fetch requests (10 seconds)
const FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch with timeout
 * @param url URL to fetch
 * @param options Fetch options
 * @param timeout Timeout in milliseconds
 * @returns Response or throws error
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

export type MawaqitPrayerTimes = {
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
  date: Date;
};

export type MawaqitFetchMethod = 'iCal' | 'JSON API' | 'HTML';

export type MawaqitMethodResult = {
  method: MawaqitFetchMethod;
  success: boolean;
  error?: string;
};

export type MawaqitFetchResult = {
  success: boolean;
  times?: MawaqitPrayerTimes;
  successMethod?: MawaqitFetchMethod;
  methodResults: MawaqitMethodResult[];
};

/**
 * Extract mosque UUID or slug from Mawaqit URL
 * Supports various URL formats:
 * - https://mawaqit.net/fr/m/mosquee-de-frejus
 * - https://mawaqit.net/en/mosquee-de-frejus
 * - https://mawaqit.net/mosquee-de-frejus
 * @param url Full Mawaqit mosque URL
 * @returns Mosque identifier (UUID or slug)
 */
function extractMosqueIdentifier(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    if (pathParts.length === 0) {
      return null;
    }

    // If /m/ is in the path, get the part after it
    const mIndex = pathParts.indexOf('m');
    if (mIndex !== -1 && pathParts[mIndex + 1]) {
      return pathParts[mIndex + 1];
    }

    // Otherwise, use the last non-empty part of the path (the mosque slug)
    return pathParts[pathParts.length - 1] || null;
  } catch (error) {
    console.error('Invalid Mawaqit URL:', error);
    return null;
  }
}

/**
 * Parse time string in HH:MM format and combine with date
 * @param timeStr Time string (e.g., "05:30")
 * @param date Date to combine with
 * @returns Date object with the time set
 */
function parseTimeString(timeStr: string, date: Date): Date | null {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      return null;
    }

    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  } catch (error) {
    console.error('Failed to parse time string:', timeStr, error);
    return null;
  }
}

type FetchMethodResult = {
  times: MawaqitPrayerTimes | null;
  error?: string;
};

/**
 * Fetch prayer times from Mawaqit using the iCal endpoint
 * @param mosqueUrl Mawaqit mosque URL
 * @param date Date to fetch prayer times for
 * @returns Prayer times and error details
 */
async function fetchFromIcalEndpoint(
  mosqueUrl: string,
  date: Date,
): Promise<FetchMethodResult> {
  try {
    const mosqueId = extractMosqueIdentifier(mosqueUrl);
    if (!mosqueId) {
      return {
        times: null,
        error: 'Could not extract mosque identifier from URL',
      };
    }

    // Try the ical endpoint
    const icalUrl = `${mosqueUrl}/ical`;

    const response = await fetchWithTimeout(icalUrl, {
      headers: {
        'User-Agent': 'Al-Azan-App/1.0',
      },
    });

    if (!response.ok) {
      return {
        times: null,
        error: `HTTP ${response.status}: ${response.statusText || 'Request failed'}`,
      };
    }

    const icalData = await response.text();
    const times = parseIcalData(icalData, date);
    if (!times) {
      return {
        times: null,
        error: 'Failed to parse iCal data (missing prayer times for date)',
      };
    }
    return {times};
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      times: null,
      error: errorMsg,
    };
  }
}

/**
 * Parse iCal data to extract prayer times for a specific date
 * @param icalData iCal format string
 * @param date Date to extract prayer times for
 * @returns Prayer times or null if parsing fails
 */
function parseIcalData(
  icalData: string,
  date: Date,
): MawaqitPrayerTimes | null {
  try {
    // This is a simplified iCal parser - might need enhancement
    // iCal format has VEVENT blocks with DTSTART and SUMMARY fields
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');

    const events = icalData.split('BEGIN:VEVENT');
    const prayerTimes: Partial<Record<Prayer, Date>> = {};

    for (const event of events) {
      if (!event.includes('DTSTART')) continue;

      const summaryMatch = event.match(/SUMMARY:([^\r\n]+)/);
      const dtStartMatch = event.match(/DTSTART[;:]([^\r\n]+)/);

      if (!summaryMatch || !dtStartMatch) continue;

      const summary = summaryMatch[1].toLowerCase();
      const dtStart = dtStartMatch[1];

      // Check if this event is for our target date
      if (!dtStart.includes(dateStr)) continue;

      // Parse the datetime
      const eventDate = parseIcalDateTime(dtStart);
      if (!eventDate) continue;

      // Map summary to prayer
      if (summary.includes('fajr') || summary.includes('fajr')) {
        prayerTimes.fajr = eventDate;
      } else if (summary.includes('sunrise') || summary.includes('chourouk') || summary.includes('shuruq')) {
        prayerTimes.sunrise = eventDate;
      } else if (summary.includes('dhuhr') || summary.includes('dohr') || summary.includes('dhohr')) {
        prayerTimes.dhuhr = eventDate;
      } else if (summary.includes('asr') || summary.includes('assr')) {
        prayerTimes.asr = eventDate;
      } else if (summary.includes('maghrib') || summary.includes('maghreb')) {
        prayerTimes.maghrib = eventDate;
      } else if (summary.includes('isha') || summary.includes('icha')) {
        prayerTimes.isha = eventDate;
      }
    }

    // Validate we have all required prayers
    if (
      prayerTimes.fajr &&
      prayerTimes.sunrise &&
      prayerTimes.dhuhr &&
      prayerTimes.asr &&
      prayerTimes.maghrib &&
      prayerTimes.isha
    ) {
      return {
        fajr: prayerTimes.fajr,
        sunrise: prayerTimes.sunrise,
        dhuhr: prayerTimes.dhuhr,
        asr: prayerTimes.asr,
        maghrib: prayerTimes.maghrib,
        isha: prayerTimes.isha,
        date,
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing iCal data:', error);
    return null;
  }
}

/**
 * Parse iCal datetime format (YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ)
 * @param dtString iCal datetime string
 * @returns Date object or null
 */
function parseIcalDateTime(dtString: string): Date | null {
  try {
    // Remove timezone indicator if present
    const cleaned = dtString.replace(/[TZ]/g, '');

    if (cleaned.length < 8) return null;

    const year = parseInt(cleaned.substring(0, 4));
    const month = parseInt(cleaned.substring(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(cleaned.substring(6, 8));
    const hour = cleaned.length >= 10 ? parseInt(cleaned.substring(8, 10)) : 0;
    const minute = cleaned.length >= 12 ? parseInt(cleaned.substring(10, 12)) : 0;
    const second = cleaned.length >= 14 ? parseInt(cleaned.substring(12, 14)) : 0;

    return new Date(year, month, day, hour, minute, second);
  } catch (error) {
    console.error('Failed to parse iCal datetime:', dtString, error);
    return null;
  }
}

/**
 * Fetch prayer times from Mawaqit using JSON API
 * @param mosqueUrl Mawaqit mosque URL
 * @param date Date to fetch prayer times for
 * @returns Prayer times and error details
 */
async function fetchFromJsonApi(
  mosqueUrl: string,
  date: Date,
): Promise<FetchMethodResult> {
  const errors: string[] = [];
  try {
    const mosqueId = extractMosqueIdentifier(mosqueUrl);
    if (!mosqueId) {
      return {
        times: null,
        error: 'Could not extract mosque identifier from URL',
      };
    }

    // Try different API endpoint patterns
    const apiEndpoints = [
      `https://mawaqit.net/api/2.0/mosque/${mosqueId}/prayer-times`,
      `https://mawaqit.net/api/mosque/${mosqueId}`,
    ];

    for (const apiUrl of apiEndpoints) {
      try {
        const response = await fetchWithTimeout(apiUrl, {
          headers: {
            'User-Agent': 'Al-Azan-App/1.0',
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const parsed = parseJsonApiResponse(data, date);
          if (parsed) return {times: parsed};
          errors.push(`Endpoint ${apiUrl}: Failed to parse response`);
        } else {
          errors.push(`Endpoint ${apiUrl}: HTTP ${response.status}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Endpoint ${apiUrl}: ${errorMsg}`);
        continue;
      }
    }

    return {
      times: null,
      error: errors.join('; '),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      times: null,
      error: errorMsg,
    };
  }
}

/**
 * Parse JSON API response to extract prayer times
 * @param data JSON response data
 * @param date Target date
 * @returns Prayer times or null
 */
function parseJsonApiResponse(
  data: any,
  date: Date,
): MawaqitPrayerTimes | null {
  try {
    // Try different response structures
    const prayerData = data.prayer_times || data.times || data;

    // Handle array of times (calendar format)
    if (Array.isArray(prayerData)) {
      const dateStr = date.toISOString().split('T')[0];
      const dayData = prayerData.find((d: any) => d.date === dateStr);
      if (dayData) {
        return parsePrayerTimesObject(dayData, date);
      }
    }

    // Handle direct prayer times object
    return parsePrayerTimesObject(prayerData, date);
  } catch (error) {
    console.error('Error parsing JSON API response:', error);
    return null;
  }
}

/**
 * Parse a prayer times object with various field name variations
 * @param obj Object containing prayer times
 * @param date Date for the prayer times
 * @returns Prayer times or null
 */
function parsePrayerTimesObject(
  obj: any,
  date: Date,
): MawaqitPrayerTimes | null {
  try {
    const fajr = parseTimeString(
      obj.fajr || obj.Fajr || obj.fajr_time || obj.fajr_iqama || '',
      date,
    );
    const sunrise = parseTimeString(
      obj.sunrise || obj.Sunrise || obj.shuruq || obj.chourouk || '',
      date,
    );
    const dhuhr = parseTimeString(
      obj.dhuhr || obj.Dhuhr || obj.dohr || obj.dhohr || '',
      date,
    );
    const asr = parseTimeString(
      obj.asr || obj.Asr || obj.assr || '',
      date,
    );
    const maghrib = parseTimeString(
      obj.maghrib || obj.Maghrib || obj.maghreb || '',
      date,
    );
    const isha = parseTimeString(
      obj.isha || obj.Isha || obj.icha || '',
      date,
    );

    if (fajr && sunrise && dhuhr && asr && maghrib && isha) {
      return {
        fajr,
        sunrise,
        dhuhr,
        asr,
        maghrib,
        isha,
        date,
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing prayer times object:', error);
    return null;
  }
}

/**
 * Fetch prayer times from Mawaqit by parsing HTML page
 * This is the most reliable method as it uses the same data the website displays
 * @param mosqueUrl Mawaqit mosque URL
 * @param date Date to fetch prayer times for
 * @returns Prayer times and error details
 */
async function fetchFromHtmlPage(
  mosqueUrl: string,
  date: Date,
): Promise<FetchMethodResult> {
  try {
    const response = await fetchWithTimeout(mosqueUrl, {
      headers: {
        'User-Agent': 'Al-Azan-App/1.0',
      },
    });

    if (!response.ok) {
      return {
        times: null,
        error: `HTTP ${response.status}: ${response.statusText || 'Request failed'}`,
      };
    }

    const html = await response.text();
    const result = parseHtmlPage(html, date);
    if (!result.times) {
      return result;
    }
    return {times: result.times};
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      times: null,
      error: errorMsg,
    };
  }
}

/**
 * Extract a JSON object from a string starting at a given position
 * Uses bracket counting to properly handle nested objects
 * @param str The string to extract from
 * @param startIndex The index of the opening brace
 * @returns The extracted JSON string or null if invalid
 */
function extractJsonObject(str: string, startIndex: number): string | null {
  if (str[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return str.substring(startIndex, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse Mawaqit HTML page to extract confData and prayer times
 * The page contains a JavaScript variable 'confData' with all prayer time information
 * @param html HTML content of the page
 * @param date Date to extract prayer times for
 * @returns Prayer times and error details
 */
function parseHtmlPage(
  html: string,
  date: Date,
): FetchMethodResult {
  try {
    // Find confData assignment in the HTML
    // It can be defined as: let confData = {...}, var confData = {...}, or const confData = {...}
    const confDataIndex = html.indexOf('confData');
    if (confDataIndex === -1) {
      return {
        times: null,
        error: 'Could not find confData in HTML (page structure may have changed)',
      };
    }

    // Find the opening brace after confData
    const equalsIndex = html.indexOf('=', confDataIndex);
    if (equalsIndex === -1) {
      return {
        times: null,
        error: 'Could not find confData assignment in HTML',
      };
    }

    const braceIndex = html.indexOf('{', equalsIndex);
    if (braceIndex === -1) {
      return {
        times: null,
        error: 'Could not find confData object in HTML',
      };
    }

    // Extract the JSON object using bracket counting
    const jsonStr = extractJsonObject(html, braceIndex);
    if (!jsonStr) {
      return {
        times: null,
        error: 'Failed to extract confData JSON (unbalanced braces)',
      };
    }

    // Parse the JSON data
    let confData;
    try {
      confData = JSON.parse(jsonStr);
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      return {
        times: null,
        error: `Failed to parse confData JSON: ${errorMsg}`,
      };
    }

    // Extract prayer times from calendar
    // calendar is an array of 12 months (0-indexed)
    // Each month is an object with day numbers as keys
    // Each day is an array: [Fajr, Shuruq, Dhuhr, Asr, Maghrib, Isha]
    const calendar = confData.calendar;
    if (!calendar || !Array.isArray(calendar)) {
      return {
        times: null,
        error: 'Invalid calendar data in confData',
      };
    }

    const month = date.getMonth(); // 0-indexed (0 = January)
    const day = date.getDate(); // 1-indexed

    if (!calendar[month] || !calendar[month][day]) {
      return {
        times: null,
        error: `No prayer times found for ${date.toLocaleDateString()}`,
      };
    }

    const dayTimes = calendar[month][day];
    // dayTimes format: [Fajr, Shuruq, Dhuhr, Asr, Maghrib, Isha]
    if (!Array.isArray(dayTimes) || dayTimes.length < 6) {
      return {
        times: null,
        error: 'Invalid day times format in calendar',
      };
    }

    const [fajrStr, shuruqStr, dhuhrStr, asrStr, maghribStr, ishaStr] = dayTimes;

    // Parse time strings
    const fajr = parseTimeString(fajrStr, date);
    const sunrise = parseTimeString(shuruqStr, date);
    const dhuhr = parseTimeString(dhuhrStr, date);
    const asr = parseTimeString(asrStr, date);
    const maghrib = parseTimeString(maghribStr, date);
    const isha = parseTimeString(ishaStr, date);

    if (!fajr || !sunrise || !dhuhr || !asr || !maghrib || !isha) {
      return {
        times: null,
        error: `Failed to parse time strings: [${[fajrStr, shuruqStr, dhuhrStr, asrStr, maghribStr, ishaStr].join(', ')}]`,
      };
    }

    return {
      times: {
        fajr,
        sunrise,
        dhuhr,
        asr,
        maghrib,
        isha,
        date,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      times: null,
      error: `Parse error: ${errorMsg}`,
    };
  }
}

/**
 * Fetch prayer times from Mawaqit for a specific date with detailed results
 * Tries multiple methods: iCal, JSON API, HTML parsing
 * @param mosqueUrl Mawaqit mosque URL
 * @param date Date to fetch prayer times for
 * @returns Detailed result including method-by-method outcomes
 */
export async function fetchMawaqitPrayerTimesWithDetails(
  mosqueUrl: string,
  date: Date,
): Promise<MawaqitFetchResult> {
  const methodResults: MawaqitMethodResult[] = [];

  if (!mosqueUrl) {
    return {
      success: false,
      methodResults: [{method: 'iCal', success: false, error: 'Mawaqit URL not configured'}],
    };
  }

  // Try iCal endpoint first
  const icalResult = await fetchFromIcalEndpoint(mosqueUrl, date);
  methodResults.push({
    method: 'iCal',
    success: !!icalResult.times,
    error: icalResult.error,
  });
  if (icalResult.times) {
    console.log('Mawaqit: Successfully fetched from iCal endpoint');
    return {
      success: true,
      times: icalResult.times,
      successMethod: 'iCal',
      methodResults,
    };
  }

  // Fallback to JSON API
  const jsonResult = await fetchFromJsonApi(mosqueUrl, date);
  methodResults.push({
    method: 'JSON API',
    success: !!jsonResult.times,
    error: jsonResult.error,
  });
  if (jsonResult.times) {
    console.log('Mawaqit: Successfully fetched from JSON API');
    return {
      success: true,
      times: jsonResult.times,
      successMethod: 'JSON API',
      methodResults,
    };
  }

  // Final fallback: Parse HTML page directly
  const htmlResult = await fetchFromHtmlPage(mosqueUrl, date);
  methodResults.push({
    method: 'HTML',
    success: !!htmlResult.times,
    error: htmlResult.error,
  });
  if (htmlResult.times) {
    console.log('Mawaqit: Successfully fetched from HTML page');
    return {
      success: true,
      times: htmlResult.times,
      successMethod: 'HTML',
      methodResults,
    };
  }

  console.error('All Mawaqit fetch methods failed');
  return {
    success: false,
    methodResults,
  };
}

/**
 * Fetch prayer times from Mawaqit for a specific date
 * Tries multiple methods: iCal, JSON API, HTML parsing
 * @param mosqueUrl Mawaqit mosque URL
 * @param date Date to fetch prayer times for
 * @returns Prayer times or null if all methods fail
 */
export async function fetchMawaqitPrayerTimes(
  mosqueUrl: string,
  date: Date,
): Promise<MawaqitPrayerTimes | null> {
  const result = await fetchMawaqitPrayerTimesWithDetails(mosqueUrl, date);
  return result.times || null;
}

// ============================================================================
// Calendar Storage - Store full year calendar for offline use
// ============================================================================

const MAWAQIT_CALENDAR_KEY = 'MAWAQIT_CALENDAR';

/**
 * Stored calendar data structure
 * calendar[month][day] = [Fajr, Shuruq, Dhuhr, Asr, Maghrib, Isha]
 */
export type MawaqitCalendar = {
  calendar: string[][][]; // [month][day][times]
  mosqueUrl: string;
  mosqueName?: string;
  fetchedAt: number;
};

export type MawaqitCalendarFetchResult = {
  success: boolean;
  calendar?: MawaqitCalendar;
  error?: string;
};

/**
 * Fetch and extract the full calendar from Mawaqit HTML page
 * @param mosqueUrl Mawaqit mosque URL
 * @returns Calendar data or error
 */
export async function fetchMawaqitCalendar(
  mosqueUrl: string,
): Promise<MawaqitCalendarFetchResult> {
  try {
    const response = await fetchWithTimeout(mosqueUrl, {
      headers: {
        'User-Agent': 'Al-Azan-App/1.0',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText || 'Request failed'}`,
      };
    }

    const html = await response.text();

    // Find confData in the HTML
    const confDataIndex = html.indexOf('confData');
    if (confDataIndex === -1) {
      return {
        success: false,
        error: 'Could not find confData in HTML',
      };
    }

    const equalsIndex = html.indexOf('=', confDataIndex);
    if (equalsIndex === -1) {
      return {
        success: false,
        error: 'Could not find confData assignment',
      };
    }

    const braceIndex = html.indexOf('{', equalsIndex);
    if (braceIndex === -1) {
      return {
        success: false,
        error: 'Could not find confData object',
      };
    }

    const jsonStr = extractJsonObject(html, braceIndex);
    if (!jsonStr) {
      return {
        success: false,
        error: 'Failed to extract confData JSON',
      };
    }

    let confData;
    try {
      confData = JSON.parse(jsonStr);
    } catch (parseError) {
      const errorMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      return {
        success: false,
        error: `Failed to parse confData: ${errorMsg}`,
      };
    }

    if (!confData.calendar || !Array.isArray(confData.calendar)) {
      return {
        success: false,
        error: 'Invalid calendar data in confData',
      };
    }

    return {
      success: true,
      calendar: {
        calendar: confData.calendar,
        mosqueUrl,
        mosqueName: confData.name || confData.mosqueName,
        fetchedAt: Date.now(),
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Store the Mawaqit calendar to persistent storage
 * @param calendar Calendar data to store
 */
export function storeMawaqitCalendar(calendar: MawaqitCalendar): void {
  try {
    storage.set(MAWAQIT_CALENDAR_KEY, JSON.stringify(calendar));
    console.log('Mawaqit calendar stored successfully');
  } catch (error) {
    console.error('Error storing Mawaqit calendar:', error);
  }
}

/**
 * Load the Mawaqit calendar from persistent storage
 * @returns Stored calendar or null if not found
 */
export function loadMawaqitCalendar(): MawaqitCalendar | null {
  try {
    const stored = storage.getString(MAWAQIT_CALENDAR_KEY);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error loading Mawaqit calendar:', error);
    return null;
  }
}

/**
 * Clear the stored Mawaqit calendar
 */
export function clearMawaqitCalendar(): void {
  try {
    storage.delete(MAWAQIT_CALENDAR_KEY);
  } catch (error) {
    console.error('Error clearing Mawaqit calendar:', error);
  }
}

/**
 * Get prayer times from stored calendar for a specific date
 * @param date Date to get prayer times for
 * @param mosqueUrl Current mosque URL (to validate stored calendar)
 * @returns Prayer times or null if not available
 */
export function getPrayerTimesFromStoredCalendar(
  date: Date,
  mosqueUrl: string,
): MawaqitPrayerTimes | null {
  try {
    const calendar = loadMawaqitCalendar();
    if (!calendar) {
      return null;
    }

    // Validate mosque URL matches
    if (calendar.mosqueUrl !== mosqueUrl) {
      console.log('Stored calendar is for a different mosque');
      return null;
    }

    const month = date.getMonth();
    const day = date.getDate();

    if (!calendar.calendar[month] || !calendar.calendar[month][day]) {
      return null;
    }

    const dayTimes = calendar.calendar[month][day];
    if (!Array.isArray(dayTimes) || dayTimes.length < 6) {
      return null;
    }

    const [fajrStr, shuruqStr, dhuhrStr, asrStr, maghribStr, ishaStr] = dayTimes;

    const fajr = parseTimeString(fajrStr, date);
    const sunrise = parseTimeString(shuruqStr, date);
    const dhuhr = parseTimeString(dhuhrStr, date);
    const asr = parseTimeString(asrStr, date);
    const maghrib = parseTimeString(maghribStr, date);
    const isha = parseTimeString(ishaStr, date);

    if (!fajr || !sunrise || !dhuhr || !asr || !maghrib || !isha) {
      return null;
    }

    return {
      fajr,
      sunrise,
      dhuhr,
      asr,
      maghrib,
      isha,
      date,
    };
  } catch (error) {
    console.error('Error getting prayer times from stored calendar:', error);
    return null;
  }
}
