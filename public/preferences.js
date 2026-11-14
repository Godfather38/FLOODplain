// Device-only preferences never affect route ranking or risk calculations.
export function savedRoutes(value, validIds) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && validIds.includes(id)))] : [];
}
export function toggleSavedRoute(value, id, validIds) {
  const saved = savedRoutes(value, validIds);
  if (!validIds.includes(id)) return saved;
  return saved.includes(id) ? saved.filter((x) => x !== id) : [...saved, id];
}
// County time stamps are Arizona local, like "11/01/26, 11:48". Arizona is UTC-7 all year.
export function countyTime(text) {
  const m = /^(\d\d)\/(\d\d)\/(\d\d), (\d\d):(\d\d)$/.exec(String(text ?? '').trim());
  return m ? Date.UTC(2000 + +m[3], +m[1] - 1, +m[2], +m[4] + 7, +m[5]) : null;
}
export function plainAge(time, now) {
  if (!Number.isFinite(time) || time > now + 300000) return null;
  const minutes = Math.floor(Math.max(0, now - time) / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `in ${new Date(time).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', year: 'numeric' })}`;
}
// Readable wording for people, leaving the source text used by alerts and tests alone.
export function plainWords(text, now) {
  return String(text ?? '')
    .replace(/No live readings right now; current road conditions are not established/g, 'No local reading is available.')
    .replace(/updated (\d\d\/\d\d\/\d\d, \d\d:\d\d)/g, (all, stamp) => { const age = plainAge(countyTime(stamp), now); return age ? `updated ${age}` : all; })
    .replace(/\bHAND model\b/g, 'Flood model')
    .replace(/\(NAVD88 elevation reference\)/g, '(above sea level)')
    .replace(/\bNAVD88\b/g, 'above sea level');
}
export function checkAge(checkedAt, now, online = true) {
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60000));
  const age = minutes < 1 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : `Checked ${Math.floor(minutes / 60)} h ago`;
  return `${online ? '' : 'Offline. '}${age}${minutes >= 5 ? '. Older check; refresh for an update.' : '.'}`;
}
