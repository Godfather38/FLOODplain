// Device-only preferences never affect route ranking or risk calculations.
export function savedRoutes(value, validIds) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && validIds.includes(id)))] : [];
}
export function toggleSavedRoute(value, id, validIds) {
  const saved = savedRoutes(value, validIds);
  if (!validIds.includes(id)) return saved;
  return saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id];
}
export function checkAge(checkedAt, now, online = true) {
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60000));
  const age = minutes < 1 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : `Checked ${Math.floor(minutes / 60)} h ago`;
  return `${online ? '' : 'Offline. '}${age}${minutes >= 5 ? '. Older check; refresh for an update.' : '.'}`;
}
