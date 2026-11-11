// The words for "Share this check": the same sentence the texts and pushes use, plus when it was checked.
import { message } from './engine.js?v=dev';

export function shareText({ rec, rated }, data, area, timeZone = 'America/Phoenix') {
  const missing = [!data.closures && 'county', !data.alert && 'rain', !Object.values(data.flows ?? {}).some((f) => f.fresh) && 'river'].filter(Boolean);
  const { text } = message(rec.best, rec.order, rated, missing, data.now, area);
  const at = new Date(data.now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const link = text.match(/ https:\S+$/)?.[0] ?? '';
  return `${text.slice(0, text.length - link.length)} Checked ${at} Arizona time.${link}`;
}

// Opens the phone's share sheet; copies the words where there isn't one. Returns what to tell the person.
export async function shareCheck(text, nav = globalThis.navigator) {
  try {
    if (nav.share) { await nav.share({ text }); return ''; }
    await nav.clipboard.writeText(text);
    return 'Copied. Paste it into a message.';
  } catch (e) {
    return e?.name === 'AbortError' ? '' : 'Couldn’t share from this browser.';
  }
}
