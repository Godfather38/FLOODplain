// Server-only adapter. Official schema: https://www.az511.com/help/endpoint/event
// Do not import this module into public/. No credential or upstream URL is returned.
import { roadEventTiming } from '../public/logic.js';
const endpoint = 'https://az511.com/api/v2/get/event';
const text = value => typeof value === 'string' ? value : '';
const epoch = value => Number.isInteger(value) && value > 0 && value < 100000000000
  && Number.isFinite(new Date(value * 1000).getTime()) ? value * 1000 : null;

export function normalizeAZ511(rows, now) {
  if (!Array.isArray(rows) || !Number.isFinite(now)) throw Error('Invalid AZ511 response');
  return rows.map(row => {
    if (!row || !Number.isInteger(row.ID)) throw Error('Invalid AZ511 event');
    const start = epoch(row.StartDate), stop = epoch(row.PlannedEndDate);
    const recurrence = text(row.Recurrence), recurrenceSchedules = text(row.RecurrenceSchedules);
    // No documented recurrence grammar: preserve it, never assume continuously active.
    const invalid = start === null || stop === null || stop <= start;
    const recurring = !!(recurrence.trim() || recurrenceSchedules.trim()) ||
      [row.Recurrence, row.RecurrenceSchedules].some(v => v != null && typeof v !== 'string');
    const timingUnknown = invalid || recurring;
    const timingStatus = roadEventTiming({start, stop, timingUnknown, dailyStart:null, dailyEnd:null}, now);
    const description = text(row.Description);
    const scopeText = `${text(row.RoadwayName)} ${description} ${text(row.EventSubType)}`;
    // Diagnostic scope only; never convert a ramp/frontage closure to a mainline closure.
    const scope = /\bfrontage\b/i.test(scopeText) ? 'frontage' : /\b(?:ramp|on-ramp|off-ramp)\b/i.test(scopeText) ? 'ramp' : /\bmainline\b/i.test(scopeText) ? 'mainline' : 'unknown';
    return {
      id: `az511-${row.ID}`, source: 'AZ511', sourceId: text(row.SourceId),
      headline: description || text(row.RoadwayName), description,
      roadway: text(row.RoadwayName), direction: text(row.DirectionOfTravel),
      jurisdiction: text(row.Organization), link: 'https://www.az511.com/',
      eventType: text(row.EventType), eventSubType: text(row.EventSubType),
      lanesAffected: text(row.LanesAffected), closed: row.IsFullClosure === true,
      scope, start, stop, dailyStart: null, dailyEnd: null,
      timingStatus, timingUnknown, recurrence, recurrenceSchedules,
      reported: epoch(row.Reported), updated: epoch(row.LastUpdated),
      // Retained for later geometry validation; deliberately not fed to route matching.
      encodedPolyline: text(row.EncodedPolyline),
    };
  });
}

export function createAZ511Adapter({fetcher = fetch, clock = () => Date.now()} = {}) {
  let pending, cached, nextAttempt = 0;
  return async function load(env = {}) {
    if (env.PUBLIC_LIVE !== 'true' || env.AZ511_ENABLED !== 'true') return {status:'disabled', events:null};
    if (typeof env.AZ511_API_KEY !== 'string' || !env.AZ511_API_KEY.trim()) return {status:'unconfigured', events:null};
    const now = clock();
    if (cached && now < nextAttempt) return {status:'ok', fetchedAt:cached.fetchedAt, events:normalizeAZ511(cached.rows, now)};
    if (pending) return pending;
    if (now < nextAttempt) return {status:'unavailable', events:null};
    nextAttempt = now + 60000;
    pending = (async () => {
      try {
        const url = new URL(endpoint);
        url.searchParams.set('key', env.AZ511_API_KEY);
        url.searchParams.set('format', 'json');
        const response = await fetcher(url.toString(), {redirect:'error', signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Unavailable');
        const rows = await response.json();
        const fetchedAt = clock(), events = normalizeAZ511(rows, fetchedAt);
        cached = {status:'ok', rows, fetchedAt};
        return {status:'ok', events, fetchedAt};
      } catch {
        cached = null;
        // Never expose a key-bearing URL, response body, or fetch error.
        return {status:'unavailable', events:null};
      } finally { pending = null; }
    })();
    return pending;
  };
}
