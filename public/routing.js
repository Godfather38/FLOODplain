// Route links select their own area, even when another area was saved on this browser.
// Resolve against every route before the app computes an area's ratings.
export function routeAreaForHash(hash, routes) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] !== 'r') return null;
  const route = routes.find((f) => f.properties.id === p[1]);
  return route ? route.properties.area ?? 'avra' : null;
}

// A stale or mistyped deep link must not select a crossing outside this route.
export function resolveScreen(hash, byId) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route = byId[p[1]];
  if (p[0] === 'r' && Array.isArray(route?.points)) {
    const point = route.points.find((fp) => fp.id === p[2] && !fp.routeBarricade);
    return point ? { screen: 'stretch', route: p[1], fp: point.id } : { screen: 'route', route: p[1] };
  }
  if (p[0] === 'report') return { screen: 'report', fp: p[1] };
  if (['map', 'how', 'settings', 'sources', 'alerts', 'privacy', 'updates', 'underpasses', 'closures'].includes(p[0])) return { screen: p[0] };
  return { screen: 'home' };
}
