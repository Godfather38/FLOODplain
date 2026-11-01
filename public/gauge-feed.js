// Recover each gauge independently; partial service responses must not discard peers.
// Cache timestamps describe retrieval, never replace the observation timestamps.
export async function loadGaugeReadings(sites, { fetchJson, proxyUrl, directUrl, store, parse, now = Date.now(), reuseMs = 600000 }) {
  let proxy = null;
  let busy = false;
  if (proxyUrl) {
    try { proxy = (await fetchJson(proxyUrl))?.series; } catch { /* per-site fallback */ }
  }
  const decoded = (json) => {
    try {
      const series = parse(json);
      const points = series?.['00060'];
      return Array.isArray(points) && points.length ? { json, series, latest: points.at(-1).t } : null;
    } catch { return null; }
  };
  const series = await Promise.all(sites.map(async (site) => {
    const saved = store.get(`usgs:${site}`);
    const cached = decoded(saved?.json);
    const shared = decoded(proxy?.[site]);
    if (shared) {
      if (cached && cached.latest > shared.latest) return cached.series;
      store.set(`usgs:${site}`, { at: now, json: shared.json });
      return shared.series;
    }
    if (cached && Number.isFinite(saved.at) && now >= saved.at && now - saved.at < reuseMs) return cached.series;
    try {
      const direct = decoded(await fetchJson(directUrl(site)));
      if (direct) {
        if (cached && cached.latest > direct.latest) return cached.series;
        store.set(`usgs:${site}`, { at: now, json: direct.json });
        return direct.series;
      }
    } catch (e) { if (e.status === 429) busy = true; }
    return cached?.series ?? null;
  }));
  return { series, busy };
}
