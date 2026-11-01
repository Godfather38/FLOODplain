// A stale or mistyped deep link must not select a crossing outside this route.
export function resolveScreen(hash, byId) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route = byId[p[1]];
  if (p[0] === 'r' && route) {
    const point = route.points.find((fp) => fp.id === p[2]);
    return point ? { screen: 'stretch', route: p[1], fp: point.id } : { screen: 'route', route: p[1] };
  }
  if (p[0] === 'report') return { screen: 'report', fp: p[1] };
  if (['how', 'settings', 'sources', 'alerts', 'privacy', 'updates', 'underpasses'].includes(p[0])) return { screen: p[0] };
  return { screen: 'home' };
}
