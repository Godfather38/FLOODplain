// Server-only adapter. Official schema: https://www.az511.com/help/endpoint/event
// Do not import this module into public/. No credential or upstream URL is returned.
import { roadEventTiming } from '../public/logic.js';
const endpoint = 'https://az511.com/api/v2/get/event';
const text = value => typeof value === 'string' ? value : '';
const epoch = value => Number.isInteger(value) && value > 0 && value < 100000000000
  && Number.isFinite(new Date(value * 1000).getTime()) ? value * 1000 : null;
const validPoint = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon)<=180 && Math.abs(lat)<=90;

// Google E5 polyline format linked by the official AZ511 schema.
function geometry(row) {
  const encoded=text(row.EncodedPolyline), points=[];
  if (encoded) {
    try {
      if(encoded.length>200000) throw Error('Too long');
      let index=0, lat=0, lon=0;
      const delta=()=>{
        let value=0, shift=0, byte;
        do {
          if(index>=encoded.length || shift>30) throw Error('Invalid polyline');
          byte=encoded.charCodeAt(index++)-63;
          if(byte<0 || byte>63) throw Error('Invalid polyline');
          value+=(byte&31)*2**shift; shift+=5;
        } while(byte&32);
        return value%2 ? -(Math.floor(value/2)+1) : value/2;
      };
      while(index<encoded.length) {
        lat+=delta(); lon+=delta();
        const point=[lon/1e5,lat/1e5];
        if(!validPoint(...point)) throw Error('Invalid coordinate');
        points.push(point);
      }
      if(points.length) return {type:points.length>1?'LINESTRING':'POINT',parts:[points],geometryUnknown:false};
    } catch { return {type:'UNKNOWN',parts:[],geometryUnknown:true}; }
  }
  // A single documented location is a point, not an invented straight road segment.
  if(validPoint(row.Longitude,row.Latitude)) return {type:'POINT',parts:[[[row.Longitude,row.Latitude]]],geometryUnknown:false};
  return {type:'UNKNOWN',parts:[],geometryUnknown:true};
}

export function az511RoadEvents(result) {
  return result.status==='ok' ? {events:result.events,fetchedAt:result.fetchedAt,stale:false} : null;
}

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
      ...geometry(row),
      headline: description || text(row.RoadwayName), description,
      roadway: text(row.RoadwayName), direction: text(row.DirectionOfTravel),
      jurisdiction: text(row.Organization), link: 'https://www.az511.com/',
      eventType: text(row.EventType), eventSubType: text(row.EventSubType),
      lanesAffected: text(row.LanesAffected), closed: row.IsFullClosure === true,
      scope, start, stop, dailyStart: null, dailyEnd: null,
      timingStatus, timingUnknown, recurrence, recurrenceSchedules,
      reported: epoch(row.Reported), updated: epoch(row.LastUpdated),
      // Keep original geometry for audit; live matching remains a separate cutover step.
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
