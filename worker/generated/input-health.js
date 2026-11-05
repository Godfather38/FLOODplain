// GENERATED from apps-script/Code.gs by tools/build_worker.mjs. Do not edit.
import { FAILURE_POINTS, USGS_SITES, STALE_MS, RAIN, RAIN_GAUGES } from '../../public/config.js';
import { parseCountyClosures } from '../../public/logic.js';
export function expectedInputHealth_(raw, now) {
  const out = [];
  const affected = test => FAILURE_POINTS.filter(test).map(p => p.short);
  const add = (id, expected, crossings, reason, observedAt = null) => {
    const t = Date.parse(observedAt);
    out.push({id, expected, crossings: crossings.join(', ') || 'Regional context', reason, observedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, ageMinutes: Number.isFinite(t) ? Math.floor((now-t)/60000) : null});
  };
  const numeric = v => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  const reading = (valid, time, age) => {
    if (!valid) return 'Missing or malformed reading';
    const t = Date.parse(time);
    if (!Number.isFinite(t) || t > now) return 'Missing or invalid observation time';
    return now-t > age ? 'Stale reading' : '';
  };
  for (const [id, site] of Object.entries(USGS_SITES)) {
    const body = raw.usgs[id];
    const rows = Array.isArray(body?.features) ? body.features.filter(f => f?.properties?.parameter_code === '00060').map(f => f.properties).sort((a,b) => Date.parse(b.time)-Date.parse(a.time)) : [];
    const p = rows[0];
    add('usgs:'+id, site.name+' discharge within 3 hours', affected(p => (p.river || []).includes(id) || (p.wash?.usgs || []).includes(id)), !body ? 'Source unavailable' : reading(numeric(p?.value), p?.time, STALE_MS), p?.time);
  }
  for (const kind of ['rain','stream']) {
    const body = raw[kind];
    const ids = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.values(p.rain || {}).flat()))] : [...new Set(FAILURE_POINTS.flatMap(p => p.wash?.alert || []))];
    for (const id of ids) {
      const row = Array.isArray(body?.data) ? body.data.find(d => String(d.site) === id) : null;
      const points = affected(p => kind === 'rain' ? Object.values(p.rain || {}).flat().includes(id) : (p.wash?.alert || []).includes(id));
      const windows = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.entries(p.rain || {}).filter(([,ids]) => ids.includes(id)).flatMap(([rule]) => ['h6', ...Object.values(RAIN[rule]).flatMap(r => Object.keys(r))])))]: [];
      const values = kind === 'rain' ? windows.map(w => row?.rain?.[['m10','m30','h1','h3','h6','d1','d3','d7','d30'].indexOf(w)]) : [row?.flow];
      const reason = !body ? 'Source unavailable' : !row ? 'Expected station absent' : row.UnderMaintenance ? 'Station under maintenance' : reading(values.every(numeric), row.last_rpt ? row.last_rpt+'-07:00' : null, kind === 'rain' ? 24*3600000 : STALE_MS);
      add(kind+':'+id, (RAIN_GAUGES[id] || id)+(kind === 'rain' ? ' rain windows '+windows.join('/')+' within 24 hours' : ' stream discharge within 3 hours'), points, reason, row?.last_rpt ? row.last_rpt+'-07:00' : null);
    }
  }
  const county = parseCountyClosures(raw.closures);
  add('county', 'Readable county event list with reported statuses (empty is valid)', county.issues.map(i => i.location), county.reason);
  for (const [id, body, field] of [['weather',raw.nws,'features'],['transview-closures',raw.tvClosures,'d'],['transview-work',raw.tvWork,'d']]) {
    const list = body?.[field];
    const valid = Array.isArray(list) || (id === 'transview-work' && list && typeof list === 'object');
    const malformed = valid && Object.values(list).some(r => !r || typeof r !== 'object' || (id === 'weather' && typeof r.properties?.event !== 'string') || (id === 'transview-closures' && (typeof r.Geo !== 'string' || r.KeyID == null)) || (id === 'transview-work' && (typeof r.Geography !== 'string' || r.KeyID == null)));
    add(id, 'Readable '+id+' event list (empty is valid)', [], !body ? 'Source unavailable' : !valid || malformed ? 'Malformed event list' : '');
  }
  return out;
}
