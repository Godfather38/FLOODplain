import { routeModelText } from './road-forecast.js?v=dev';
// The Map tab's routes and crossings, laid out like the 3D map page's routes panel
// (preview/geo3d/src/world/routes-ui.js): the area switch, one row per route with a status dot,
// and a card for a crossing tapped on the map. Everything here is from the live check.
export const KIND_NAME = { dip: 'Dip', flat: 'Low road', road: 'Road', bridge: 'Bridge', river: 'River bridge' };
const WORD = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "2 of 5 · Minor": the rating as a number and a word, the way the rest of the app reads it.
export const ratingText = (n) => (n == null ? 'No reading' : `${n} of 5 · ${WORD[Math.floor(n)]}`);
// Route rows. routes: rated routes in this area, in the order to list them.
export function routeRowsHtml({ areas, area, routes, info, features, crossings, selected, issue }) {
  const tabs = `<div class="seg" role="tablist" aria-label="Area">${areas.map((a) => `<button type="button" role="tab" data-map-area="${esc(a.id)}" aria-selected="${a.id === area}">${esc(a.name)}</button>`).join('')}</div>`;
  const rows = routes.map((r) => {
    const f = features.find((x) => x.properties.id === r.id), count = crossings.filter((fp) => fp.routes.includes(r.id)).length;
    return `<button type="button" class="row route" data-map-route="${esc(r.id)}" aria-pressed="${r.id === selected}"><span class="dot ${esc(r.level)}" aria-hidden="true"></span><span class="text"><span class="t">${esc(info[r.id]?.name ?? r.id)}</span><span class="st">${esc(info[r.id]?.via ?? '')}${f ? ` · ${(f.properties.km * 0.621371).toFixed(1)} mi` : ''} · ${count} crossing${count === 1 ? '' : 's'}</span><span class="st status${r.score >= 3 ? ' warn' : ''}">${esc(ratingText(r.score))} · ${esc(issue(r))}</span><span class="st model-prediction">${esc(routeModelText(r))}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
  }).join('');
  return `${tabs}<h3 class="section">Routes</h3><div class="list">${rows}</div>`;
}
// The card for one crossing: its live rating, what each source says, and the way to its full screen.
export function crossingCardHtml({ fp, result, score, routeId, sources, sentence }) {
  const checks = (result?.checks ?? []).map((c) => {
    const [icon, label] = sources[c.src] ?? ['•', c.src];
    return `<div class="row small"><span class="lead-icon" aria-hidden="true">${icon}</span><span class="text"><span class="t">${esc(label)}</span><span class="st"><span class="dot ${esc(c.level)}"></span> ${esc(c.why)}</span></span></div>`;
  }).join('');
  const level = result?.level ?? 'unknown';
  return `<button type="button" class="back btn btn-text" data-map-close>‹ All routes</button><div class="hero"><p class="overline">${esc(KIND_NAME[fp.kind] ?? fp.kind)}</p><div class="hero-top"><h2>${esc(fp.name)}</h2><span class="badge-wrap"><span class="badge lg ${score ? `s${Math.floor(score)}` : 'sq'}" role="img" aria-label="Risk factor ${score ?? 'unknown'} of 5">${score ?? '?'}</span><span class="badge-word">${score ? WORD[Math.floor(score)] : 'No data'}</span></span></div><p class="meta">${esc(fp.where ?? '')}</p><p class="status ${esc(level)}"><span class="dot ${esc(level)}"></span>${esc(result?.why ?? sentence[level] ?? '')}</p>${checks ? `<div class="list checks">${checks}</div>` : ''}<div class="actions"><a class="btn btn-primary" href="#/r/${esc(routeId)}/${esc(fp.id)}">Open the safety screen</a></div></div>`;
}
