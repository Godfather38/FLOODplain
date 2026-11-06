// Small shared road summaries feed the app and Apps Script with the same high-resolution choice.
// A failed case does not prevent another case or the coarse fallback from loading.
import { ALL_ROUTE_CASES, ALL_ROUTE_LIVE, roadForecast, mergeRoadForecasts } from '../road-forecast.js?v=dev';
const COARSE = 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/live/';
export async function loadRoadForecasts({ now = Date.now(), fetchImpl = fetch } = {}) {
  const bust = '?t=' + Math.floor(now / 120000);
  async function json(url, gzip = false) {
    const r = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('HTTP ' + r.status);
    if (!gzip) return r.json();
    const bytes = new Uint8Array(await r.arrayBuffer());
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }
  const caseNames = Object.keys(ALL_ROUTE_CASES);
  const [coarse, ...summaries] = await Promise.all([
    Promise.all([json(new URL('../data/road-cells.json', import.meta.url)), json(COARSE + 'manifest.json' + bust), json(COARSE + 'water.json.gz' + bust, true)])
      .then(([table, manifest, water]) => roadForecast(table, manifest, water, now))
      .catch(() => ({ status: 'unavailable', reason: 'The coarse fallback did not answer.' })),
    ...caseNames.map((name) => json(ALL_ROUTE_LIVE + name + '/compact/road-forecast.json' + bust).catch(() => null)),
  ]);
  return mergeRoadForecasts(coarse, Object.fromEntries(caseNames.map((name, i) => [name, summaries[i]])), now);
}
