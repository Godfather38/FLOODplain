// GENERATED from apps-script/Code.gs by tools/build_worker.mjs. Do not edit.
import { FAILURE_POINTS, USGS_SITES, STALE_MS, RAIN, RAIN_GAUGES } from '../../public/config.js';
import { parseCountyClosures, alertTimeIso, findAlertStation } from '../../public/logic.js';
export function expectedInputHealth_(raw, now) {
  const out = [];
  const affected = test => FAILURE_POINTS.filter(test).map(p => p.short);
  const meta = raw.meta || {};
  const checkedAt = new Date(now).toISOString();
  // A problem row carries bounded metadata about the answer (never its body, values or URL):
  // HTTP status, size, JSON or not, top-level shape, station counts, the station checked.
  const describe = (m, found, station) => {
    const r = {checkedAt};
    if (m) { r.httpStatus = m.httpStatus; r.outcome = m.outcome; if (m.bytes != null) r.bytes = m.bytes; if (m.shape) r.shape = m.shape; }
    if (station != null) r.checkedStation = String(station).slice(0, 12);
    if (found) for (const k of ['stationCount', 'stringIds', 'numericIds', 'unreadable', 'detail']) if (found[k] != null) r[k] = found[k];
    const parts = [];
    if (m) parts.push((m.httpStatus == null ? 'no HTTP response' : 'HTTP '+m.httpStatus) + ({json: ', JSON '+m.shape, 'not-json': ', not JSON', empty: ', empty body'}[m.outcome] || '') + (m.bytes != null ? ', '+m.bytes+' bytes' : ''));
    else parts.push('response details not recorded');
    if (found?.detail) parts.push(found.detail);
    if (found?.stationCount != null) parts.push(found.stationCount+' station entries ('+found.stringIds+' text IDs, '+found.numericIds+' number IDs, '+found.unreadable+' unreadable)');
    if (station != null) parts.push('checked station '+r.checkedStation);
    parts.push('checked at '+checkedAt);
    return {response: r, diagnostic: parts.join('; ').slice(0, 320)};
  };
  const add = (id, expected, crossings, verdict, observedAt = null, sourceTime = null, info = null) => {
    const v = typeof verdict === 'string' ? {reason: verdict, kind: verdict ? 'upstream-data' : ''} : verdict;
    const t = Date.parse(observedAt);
    const known = Number.isFinite(t) && t <= now;
    const row = {id, expected, crossings: crossings.join(', ') || 'Regional context', reason: v.reason, kind: v.kind || '',
      observedAt: known ? new Date(t).toISOString() : null, ageMinutes: known ? Math.floor((now-t)/60000) : null};
    if (v.reason && sourceTime != null) row.sourceTime = String(sourceTime).replace(/[\r\n]/g, ' ').slice(0, 40);
    if (v.kind === 'upstream-time' && Number.isFinite(t) && t > now) row.aheadMinutes = Math.ceil((t-now)/60000);
    if (v.reason) Object.assign(row, describe(info?.meta, info?.found, info?.station));
    out.push(row);
  };
  // No answer or an HTTP error is a lost connection. HTTP 200 with an empty or non-JSON
  // body means the source answered with something unreadable: a malformed response.
  const unavailableFor = m => m?.outcome === 'not-json' ? {reason: 'Malformed response: not readable JSON', kind: 'upstream-data'}
    : m?.outcome === 'empty' ? {reason: 'Malformed response: empty body', kind: 'upstream-data'}
    : {reason: 'Source unavailable', kind: 'connection'};
  const numeric = v => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  // time: the parsed, zone-bearing time (or null); sent: what the source actually sent.
  const reading = (valid, time, sent, age) => {
    if (!valid) return {reason: 'Missing or malformed reading', kind: 'upstream-data'};
    if (sent == null || String(sent).trim() === '') return {reason: 'Upstream time error: no observation time', kind: 'upstream-time'};
    const t = Date.parse(time);
    if (!time || !Number.isFinite(t)) return {reason: 'Upstream time error: unreadable observation time', kind: 'upstream-time'};
    if (t > now) return {reason: 'Upstream time error: observation time is in the future', kind: 'upstream-time'};
    return now-t > age ? {reason: 'Stale reading', kind: 'stale'} : {reason: '', kind: ''};
  };
  for (const [id, site] of Object.entries(USGS_SITES)) {
    const body = raw.usgs[id];
    const rows = Array.isArray(body?.features) ? body.features.filter(f => f?.properties?.parameter_code === '00060').map(f => f.properties).sort((a,b) => Date.parse(b.time)-Date.parse(a.time)) : [];
    const p = rows[0];
    // USGS times carry their own zone; one without a zone is unreadable, not guessed.
    const usgsTime = typeof p?.time === 'string' && /(?:Z|[+-]\d\d:?\d\d)$/i.test(p.time.trim()) ? p.time.trim() : null;
    const m = meta.usgs?.[id];
    add('usgs:'+id, site.name+' discharge within 3 hours', affected(p => (p.river || []).includes(id) || (p.wash?.usgs || []).includes(id)), !body ? unavailableFor(m) : reading(numeric(p?.value), usgsTime, p?.time, STALE_MS), usgsTime, p?.time, {meta: m});
  }
  for (const kind of ['rain','stream']) {
    const body = raw[kind];
    const ids = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.values(p.rain || {}).flat()))] : [...new Set(FAILURE_POINTS.flatMap(p => p.wash?.alert || []))];
    for (const id of ids) {
      const found = body ? findAlertStation(body, id) : null;
      const row = found?.row || null;
      const points = affected(p => kind === 'rain' ? Object.values(p.rain || {}).flat().includes(id) : (p.wash?.alert || []).includes(id));
      const windows = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.entries(p.rain || {}).filter(([,ids]) => ids.includes(id)).flatMap(([rule]) => ['h6', ...Object.values(RAIN[rule]).flatMap(r => Object.keys(r))])))]: [];
      const values = kind === 'rain' ? windows.map(w => row?.rain?.[['m10','m30','h1','h3','h6','d1','d3','d7','d30'].indexOf(w)]) : [row?.flow];
      const observed = alertTimeIso(row?.last_rpt);
      // A readable list without the station, an empty list, a partly unreadable list and a
      // list that isn't one are different problems and are reported as different reasons.
      const listProblem = {
        malformed: {reason: 'Malformed station list', kind: 'upstream-data'},
        empty: {reason: 'Empty station list', kind: 'upstream-data'},
        partial: {reason: 'Expected station absent; some list entries unreadable', kind: 'upstream-data'},
        absent: {reason: 'Expected station absent from a readable list', kind: 'upstream-data'},
      }[found?.status];
      const verdict = !body ? unavailableFor(meta[kind]) : listProblem || (row.UnderMaintenance ? {reason: 'Station under maintenance', kind: 'maintenance'} : reading(values.every(numeric), observed, row.last_rpt, kind === 'rain' ? 24*3600000 : STALE_MS));
      add(kind+':'+id, (RAIN_GAUGES[id] || id)+(kind === 'rain' ? ' rain windows '+windows.join('/')+' within 24 hours' : ' stream discharge within 3 hours'), points, verdict, observed, row?.last_rpt, {meta: meta[kind], found, station: id});
    }
  }
  const county = parseCountyClosures(raw.closures);
  add('county', 'Readable county event list with reported statuses (empty is valid)', county.issues.map(i => i.location), !raw.closures ? unavailableFor(meta.closures) : {reason: county.reason, kind: county.reason ? 'upstream-data' : ''}, null, null, {meta: meta.closures});
  for (const [id, body, field] of [['weather',raw.nws,'features'],['transview-closures',raw.tvClosures,'d'],['transview-work',raw.tvWork,'d']]) {
    const list = body?.[field];
    const valid = Array.isArray(list) || (id === 'transview-work' && list && typeof list === 'object');
    const malformed = valid && Object.values(list).some(r => !r || typeof r !== 'object' || (id === 'weather' && typeof r.properties?.event !== 'string') || (id === 'transview-closures' && (typeof r.Geo !== 'string' || r.KeyID == null)) || (id === 'transview-work' && (typeof r.Geography !== 'string' || r.KeyID == null)));
    const m = meta[{weather: 'nws', 'transview-closures': 'tvClosures', 'transview-work': 'tvWork'}[id]];
    add(id, 'Readable '+id+' event list (empty is valid)', [], !body ? unavailableFor(m) : !valid || malformed ? 'Malformed event list' : '', null, null, {meta: m});
  }
  return out;
}
// Plain words for each kind of input problem, used in the owner email.
const INPUT_KIND_TEXT = {
  connection: 'Lost connection: the source did not answer, or answered with an HTTP error.',
  // An HTTP 200 answer that is empty or not JSON is reported as upstream-data (malformed response).
  'upstream-time': 'Upstream data error: the source answered, but the time it gave for this reading cannot be trusted. The reading is not used in ratings while this lasts.',
  'upstream-data': 'Upstream data error: the source answered, but this part of its data is missing or malformed.',
  stale: 'Stale: the source answered, but its newest reading is older than the limit.',
  maintenance: 'The source marks this station as under maintenance.',
};
function ownerIncidentLines_(s) {
  const lines = [s.reason ? 'PROBLEM: '+s.id : 'RECOVERED: '+s.id, 'Expected: '+s.expected, 'Crossings: '+s.crossings, 'Result: '+(s.reason || 'Expected input is valid again')];
  if (s.reason && INPUT_KIND_TEXT[s.kind]) lines.push('Type: '+INPUT_KIND_TEXT[s.kind]);
  if (s.diagnostic) lines.push('Diagnostic: '+s.diagnostic);
  lines.push('Since: '+new Date(s.since).toISOString());
  if (s.reason && s.sourceTime != null) lines.push('Time as sent by the source: '+s.sourceTime+(s.aheadMinutes ? ' (read as Arizona time when it has no zone; '+s.aheadMinutes+' minutes after this check)' : ''));
  if (s.observedAt) lines.push('Last observation: '+s.observedAt, 'Observation age at check: '+s.ageMinutes+' minutes');
  return lines.join('\n');
}
