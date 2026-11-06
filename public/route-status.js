// A low score describes the evidence that answered, not proof of a clear road.
// Keep missing road evidence separate without changing scores or warning priority.
export function conditionsNotEstablished(point) {
  return point.level === 'unknown' || point.evidenceAvailable === false || (point.checks ?? []).some((c) =>
    c.src === 'none' || c.roadStatus === 'unknown' ||
    (c.src === 'county' && c.level === 'unknown') ||
    ((c.bridgeClearance === 'unknown' || c.upstream === true) && c.level !== 'ok'));
}

export function groupRoutePoints(points, scoreOf) {
  const groups = { concerns: [], unestablished: [], quiet: [] };
  for (const point of points) {
    const score = scoreOf(point);
    if (score > 1) groups.concerns.push(point);
    else if (score == null || conditionsNotEstablished(point)) groups.unestablished.push(point);
    else groups.quiet.push(point);
  }
  return groups;
}
