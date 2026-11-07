// GENERATED from apps-script/Code.gs by tools/build_worker.mjs. Do not edit.
import { FAILURE_POINTS, USGS_SITES, STALE_MS, RAIN, RAIN_GAUGES } from '../../public/config.js';
import { parseCountyClosures, alertTimeIso } from '../../public/logic.js';
export function expectedInputHealth_(raw, now) {
  // A future time is held this long before the owner is emailed (see ownerIncidentLines_).
  const INPUT_FUTURE_CONFIRM_MS = 75 * 60000;
  const out = [];
  const affected = test => FAILURE_POINTS.filter(test).map(p => p.short);
  const add = (id, expected, crossings, verdict, observedAt = null, sourceTime = null) => {
    const v = typeof verdict === 'string' ? {reason: verdict, kind: verdict ? 'upstream-data' : ''} : verdict;
    const t = Date.parse(observedAt);
    const known = Number.isFinite(t) && t <= now;
    const row = {id, expected, crossings: crossings.join(', ') || 'Regional context', reason: v.reason, kind: v.kind || '',
      observedAt: known ? new Date(t).toISOString() : null, ageMinutes: known ? Math.floor((now-t)/60000) : null};
    if (v.reason && sourceTime != null) row.sourceTime = String(sourceTime).replace(/[\r\n]/g, ' ').slice(0, 40);
    if (v.kind === 'upstream-time' && Number.isFinite(t) && t > now) row.aheadMinutes = Math.ceil((t-now)/60000);
    if (v.confirmAfterMs) row.confirmAfterMs = v.confirmAfterMs;
    out.push(row);
  };
  const unavailable = {reason: 'Source unavailable', kind: 'connection'};
  const numeric = v => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  // time: the parsed, zone-bearing time (or null); sent: what the source actually sent.
  // hold: only the county ALERT feed has the known self-clearing future times.
  const reading = (valid, time, sent, age, hold = false) => {
    if (!valid) return {reason: 'Missing or malformed reading', kind: 'upstream-data'};
    if (sent == null || String(sent).trim() === '') return {reason: 'Upstream time error: no observation time', kind: 'upstream-time'};
    const t = Date.parse(time);
    if (!time || !Number.isFinite(t)) return {reason: 'Upstream time error: unreadable observation time', kind: 'upstream-time'};
    if (t > now) return {reason: 'Upstream time error: observation time is in the future', kind: 'upstream-time', ...(hold ? {confirmAfterMs: INPUT_FUTURE_CONFIRM_MS} : {})};
    return now-t > age ? {reason: 'Stale reading', kind: 'stale'} : {reason: '', kind: ''};
  };
  for (const [id, site] of Object.entries(USGS_SITES)) {
    const body = raw.usgs[id];
    const rows = Array.isArray(body?.features) ? body.features.filter(f => f?.properties?.parameter_code === '00060').map(f => f.properties).sort((a,b) => Date.parse(b.time)-Date.parse(a.time)) : [];
    const p = rows[0];
    // USGS times carry their own zone; one without a zone is unreadable, not guessed.
    const usgsTime = typeof p?.time === 'string' && /(?:Z|[+-]\d\d:?\d\d)$/i.test(p.time.trim()) ? p.time.trim() : null;
    add('usgs:'+id, site.name+' discharge within 3 hours', affected(p => (p.river || []).includes(id) || (p.wash?.usgs || []).includes(id)), !body ? unavailable : reading(numeric(p?.value), usgsTime, p?.time, STALE_MS), usgsTime, p?.time);
  }
  for (const kind of ['rain','stream']) {
    const body = raw[kind];
    const ids = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.values(p.rain || {}).flat()))] : [...new Set(FAILURE_POINTS.flatMap(p => p.wash?.alert || []))];
    for (const id of ids) {
      const row = Array.isArray(body?.data) ? body.data.find(d => String(d.site) === id) : null;
      const points = affected(p => kind === 'rain' ? Object.values(p.rain || {}).flat().includes(id) : (p.wash?.alert || []).includes(id));
      const windows = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.entries(p.rain || {}).filter(([,ids]) => ids.includes(id)).flatMap(([rule]) => ['h6', ...Object.values(RAIN[rule]).flatMap(r => Object.keys(r))])))]: [];
      const values = kind === 'rain' ? windows.map(w => row?.rain?.[['m10','m30','h1','h3','h6','d1','d3','d7','d30'].indexOf(w)]) : [row?.flow];
      const observed = alertTimeIso(row?.last_rpt);
      const verdict = !body ? unavailable : !Array.isArray(body.data) ? {reason: 'Malformed station list', kind: 'upstream-data'} : !row ? {reason: 'Expected station absent', kind: 'upstream-data'} : row.UnderMaintenance ? {reason: 'Station under maintenance', kind: 'maintenance'} : reading(values.every(numeric), observed, row.last_rpt, kind === 'rain' ? 24*3600000 : STALE_MS, true);
      add(kind+':'+id, (RAIN_GAUGES[id] || id)+(kind === 'rain' ? ' rain windows '+windows.join('/')+' within 24 hours' : ' stream discharge within 3 hours'), points, verdict, observed, row?.last_rpt);
    }
  }
  const county = parseCountyClosures(raw.closures);
  add('county', 'Readable county event list with reported statuses (empty is valid)', county.issues.map(i => i.location), !raw.closures ? unavailable : {reason: county.reason, kind: county.reason ? 'upstream-data' : ''});
  for (const [id, body, field] of [['weather',raw.nws,'features'],['transview-closures',raw.tvClosures,'d'],['transview-work',raw.tvWork,'d']]) {
    const list = body?.[field];
    const valid = Array.isArray(list) || (id === 'transview-work' && list && typeof list === 'object');
    const malformed = valid && Object.values(list).some(r => !r || typeof r !== 'object' || (id === 'weather' && typeof r.properties?.event !== 'string') || (id === 'transview-closures' && (typeof r.Geo !== 'string' || r.KeyID == null)) || (id === 'transview-work' && (typeof r.Geography !== 'string' || r.KeyID == null)));
    add(id, 'Readable '+id+' event list (empty is valid)', [], !body ? unavailable : !valid || malformed ? 'Malformed event list' : '');
  }
  return out;
}
// Plain words for each kind of input problem, used in the owner email.
const INPUT_KIND_TEXT = {
  connection: 'Lost connection: the source did not answer, or its answer was not readable JSON.',
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
  if (s.reason && s.confirmAfterMs) lines.push('Held '+Math.round(s.confirmAfterMs/60000)+' minutes before sending: this county ALERT feed has sent future times around Arizona midnight that cleared on their own within about an hour (Nov 6 and 7, 2026). This one did not.');
  if (s.reason && s.sourceTime != null) lines.push('Time as sent by the source: '+s.sourceTime+(s.aheadMinutes ? ' (read as Arizona time when it has no zone; '+s.aheadMinutes+' minutes after this check)' : ''));
  if (s.observedAt) lines.push('Last observation: '+s.observedAt, 'Observation age at check: '+s.ageMinutes+' minutes');
  return lines.join('\n');
}
