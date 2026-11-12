// The simulator's storyline: for the run on the map, when modeled water reaches each whole road and
// each listed crossing, how deep it gets and when it clears. Built from the same per-crossing series the Crossings
// scoreboard uses (sim-2d.js crossingsFor), with the same "over the road" threshold.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const azTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' });
const feet = (m) => `${(m * 3.28084).toFixed(1)} ft`;

// crossings: [{fp:{id, short}, inside, over:[m per frame], road:{deck}}]. -> events in the order the water arrives.
export function storyEvents(crossings, coverM) {
  const events = [];
  for (const c of crossings ?? []) {
    if (!c.inside || !Array.isArray(c.over)) continue;
    const first = c.over.findIndex((v) => v > coverM);
    if (first < 0) continue;
    let peak = first;
    c.over.forEach((v, k) => { if (v > c.over[peak]) peak = k; });
    // Clear: the first frame after the peak from which the road stays out of the water to the end.
    let clear = null;
    for (let k = c.over.length - 1; k > peak && !(c.over[k] > coverM); k--) clear = k;
    events.push({ id: c.fp.id, name: c.fp.short ?? c.fp.name ?? c.fp.id, deck: !!c.road?.deck, first, peak, peakOver: c.over[peak], clear });
  }
  return events.sort((a, b) => a.first - b.first || b.peakOver - a.peakOver);
}

// Where each event stands at one frame: 'ahead', 'over' (water over the road now) or 'cleared'.
export const eventState = (e, hour) => (hour < e.first ? 'ahead' : e.clear != null && hour >= e.clear ? 'cleared' : 'over');

// One line for the player while the run plays.
export function storyNow(events, crossings, hour, coverM) {
  if (!events) return '';
  const over = (crossings ?? []).filter((c) => c.inside && c.over[hour] > coverM).sort((a, b) => b.over[hour] - a.over[hour]);
  if (!over.length) {
    const next = events.find((e) => e.first > hour);
    return next ? `Simulated: no road or crossing under water yet. Next: ${next.name}.` : events.length ? 'Simulated: every road and crossing is clear again.' : '';
  }
  const top = over[0];
  return `Simulated: water over the road in ${over.length} place${over.length === 1 ? '' : 's'}. Deepest: ${top.fp.short ?? top.fp.id}, ${feet(top.over[hour])}.`;
}

export function storyHtml(events, times, hour) {
  if (!events) return '';
  const head = '<h3 class="sim-h">Storyline</h3>';
  if (!events.length) return `${head}<p class="sim-muted">In this run no road or crossing has modeled water over it.</p>`;
  const rows = events.map((e) => {
    const state = eventState(e, hour), end = e.clear != null ? `Clear again by ${azTime(times[e.clear])}.` : 'Still over the road when the run ends.';
    const word = { ahead: 'Ahead', over: 'Over the road now', cleared: 'Cleared' }[state];
    return `<li class="story-row ${state}"><button type="button" data-sim-story="${esc(e.id)}" data-story-frame="${e.first}"><span class="story-time">${esc(azTime(times[e.first]))}</span><span class="story-text"><b>${esc(e.name)}</b> Modeled water reaches the ${e.deck ? 'bridge deck' : 'road'}. Deepest ${esc(feet(e.peakOver))} at ${esc(azTime(times[e.peak]))}. ${esc(end)}</span><span class="story-state">${word}</span></button></li>`;
  }).join('');
  return `${head}<p class="sim-muted">When modeled water reaches each road and crossing in this run, Arizona time. Tap one to jump there.</p><ol class="story">${rows}</ol>`;
}
