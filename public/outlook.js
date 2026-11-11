// Hour-by-hour outlook: the SFINCS forecast of water over a route's road, one value per forecast hour,
// from the hour holding "now" to the end of the run. App only. It reads the same frames the route
// rating reads (road-forecast.js), so its deepest hour is the depth the rating already reports.
// Gauges, rain and closures are live readings and have no forecast, so they are not in this strip.
import { WET_M, COVER_M, DEEP_M } from './road-forecast.js?v=dev';

const fromIndex = (times, now) => { let from = 0; while (from + 1 < times.length && times[from + 1] <= now) from++; return from; };

// summary: one high-resolution case's road-forecast.json. -> [{time, over}] (over in metres; null = no value)
export function hoursFromSummary(summary, routeId, now) {
  const r = summary?.routes?.[routeId];
  if (!r || !Array.isArray(summary.times) || !Array.isArray(r.frames) || r.frames.length !== summary.times.length) return null;
  const times = summary.times.map(Date.parse), from = fromIndex(times, now);
  return times.slice(from).map((time, i) => {
    const f = r.frames[from + i];
    const usable = f && Number.isInteger(f.validStations) && f.validStations >= 1 && Number.isFinite(f.peakRoadDepthM) && f.peakRoadDepthM >= 0;
    return { time, over: usable ? f.peakRoadDepthM : null };
  });
}

// table: road-cells.json; water: the coarse run's water.json. Same cell rule as roadForecast().
export function hoursFromCoarse(table, water, routeId, now) {
  const cells = table?.routes?.[routeId];
  if (!cells || !Array.isArray(water?.frames) || !water.frames.length) return null;
  const times = water.frames.map((f) => Date.parse(f.time)), from = fromIndex(times, now);
  return times.slice(from).map((time, i) => {
    let over = null;
    for (const [cell, roadM, bedM] of cells) {
      const z = water.frames[from + i].surfaceM[cell];
      if (z == null || !Number.isFinite(z) || z <= -9999) continue;
      const here = z - bedM < WET_M ? 0 : Math.max(0, Math.min(z - roadM, z - bedM));
      if (over == null || here > over) over = here;
    }
    return { time, over };
  });
}

// Adds forecast.hours[routeId] for every route of a merged forecast, from the model that route's
// rating came from. Kept off the enumerable fields: the forecast itself stays identical to the one
// the alert service computes, and nothing that saves or compares it picks the strip up.
export function attachHours(forecast, { table, water, summaries }, now) {
  const byRoute = {};
  for (const [id, r] of Object.entries(forecast?.routes ?? {})) {
    const hours = r.source === 'high_resolution' ? hoursFromSummary(summaries?.[r.case], id, now) : hoursFromCoarse(table, water, id, now);
    if (hours?.length) byRoute[id] = hours;
  }
  if (forecast) Object.defineProperty(forecast, 'hours', { value: byRoute, enumerable: false, configurable: true });
  return forecast;
}

const hourLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: 'numeric' });
export const depthFeet = (m) => { const ft = m * 3.28084; return ft < 0.01 ? 'under 0.01 ft' : `${ft < 0.1 ? ft.toFixed(2) : ft.toFixed(1)} ft`; };

// Runs can step in less than an hour. One value per clock hour: the deepest in that hour, and no
// data only when the whole hour has none. (Arizona keeps one clock all year, so hours line up.)
export function byHour(hours) {
  const out = [];
  for (const h of hours ?? []) {
    const start = Math.floor(h.time / 3600e3) * 3600e3, last = out.at(-1);
    if (last && last.time === start) { if (h.over != null && (last.over == null || h.over > last.over)) last.over = h.over; }
    else out.push({ time: start, over: h.over });
  }
  return out;
}

// One cell per hour, in plain words. level: none (no value), dry, trace (water, under the rating
// threshold), caution (water over the road), danger (1 ft or more).
export function outlookCells(hours, limit = 12) {
  return byHour(hours).slice(0, limit).map((h, i) => {
    const level = h.over == null ? 'none' : h.over <= 0 ? 'dry' : h.over >= DEEP_M ? 'danger' : h.over > COVER_M ? 'caution' : 'trace';
    return { label: i === 0 ? 'Now' : hourLabel(h.time), level, text: h.over == null ? 'No data' : h.over <= 0 ? 'Dry' : depthFeet(h.over),
      fill: h.over > 0 ? Math.max(8, Math.round(Math.min(1, h.over / DEEP_M) * 100)) : 0 };
  });
}

export function outlookSummary(hours, limit = 12) {
  const shown = byHour(hours).slice(0, limit), known = shown.filter((h) => h.over != null);
  if (!known.length) return 'The model has no values for this road in the coming hours.';
  const gaps = known.length < shown.length ? ' Some hours have no model value.' : '';
  const peak = known.reduce((a, b) => (b.over > a.over ? b : a));
  const span = `next ${shown.length} hour${shown.length === 1 ? '' : 's'}`;
  if (peak.over <= 0) return `No modeled water over this road in the ${span}.${gaps}`;
  return `Deepest modeled water in the ${span}: ${depthFeet(peak.over)} ${peak === shown[0] ? 'now' : `around ${hourLabel(peak.time)}`}.${gaps}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// compact: the short strip on the home card. Full: the route screen, with the summary and what it leaves out.
export function outlookHtml(hours, { compact = false } = {}) {
  const cells = outlookCells(hours, compact ? 8 : 12);
  if (!cells.length) return '';
  const strip = `<ol class="outlook-strip">${cells.map((c) => `<li class="oc ${c.level}"><span class="oh">${esc(c.label)}</span><span class="ob" aria-hidden="true"><i style="height:${c.fill}%"></i></span><span class="od">${esc(c.text)}</span></li>`).join('')}</ol>`;
  if (compact) return `<div class="outlook compact"><p class="outlook-title">Modeled water over the road, next ${cells.length} hour${cells.length === 1 ? '' : 's'}</p>${strip}</div>`;
  return `<section class="outlook" aria-labelledby="outlook-title"><h3 id="outlook-title" class="section">Hour by hour</h3><div class="outlook-card"><p class="outlook-lead">${esc(outlookSummary(hours))}</p>${strip}<p class="meta">SFINCS forecast of the deepest water over this route's road in each hour, Arizona time. River gauges, rain gauges and closures are live readings with no forecast, so they are not in this strip.</p></div></section>`;
}
