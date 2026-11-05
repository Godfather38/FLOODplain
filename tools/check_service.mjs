// Read-only post-deploy checks. Never log response bodies, URLs, or exception text.
import { pathToFileURL } from 'node:url';

export async function checkJson(url, label, valid, {
  fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 3, timeoutMs = 30000, delayMs = 5000, maxBytes = 1048576,
  log = console.log,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
      !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 30000) throw Error('Invalid check limits');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reason = 'network or timeout';
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) {
        reason = `HTTP ${response.status}`;
        await response.body?.cancel();
      } else {
        const reader = response.body?.getReader();
        let bytes = 0, text = '', oversized = false;
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) { oversized = true; await reader.cancel(); break; }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        }
        reason = oversized ? 'response too large' : bytes === 0 ? 'empty response' : 'invalid JSON';
        if (!oversized && bytes) {
          let data;
          try { data = JSON.parse(text); } catch { /* Do not log a response or parse error. */ }
          if (data !== undefined) {
            reason = 'unexpected JSON shape';
            if (valid(data)) {
              log(`${label}: OK (attempt ${attempt}/${attempts})`);
              return data;
            }
          }
        }
      }
    } catch { /* Only the bounded category is safe to report. */ }
    finally { clearTimeout(timer); }
    log(`${label}: ${reason} (attempt ${attempt}/${attempts})`);
    if (attempt < attempts) await pause(delayMs);
  }
  throw Error(`${label}: verification failed after ${attempts} attempts; upload is not retried`);
}

export const validStatus = d => d?.ok === true && d.service === 'wash-watch-alerts';
export const validRiverFeed = d => !!d && typeof d.fetched_at === 'string' &&
  Number.isFinite(Date.parse(d.fetched_at)) && d.series !== null &&
  typeof d.series === 'object' && !Array.isArray(d.series) && Object.keys(d.series).length > 0;

export async function checkService(baseUrl, options) {
  await checkJson(baseUrl, 'Alert service', validStatus, options);
  const url = new URL(baseUrl); url.searchParams.set('feed', 'usgs');
  await checkJson(url, 'River feed', validRiverFeed, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.env.DEPLOYMENT_ID;
  if (!id || !/^[\w-]+$/.test(id)) { console.error('Missing or invalid deployment ID'); process.exitCode = 1; }
  else await checkService(`https://script.google.com/macros/s/${id}/exec`).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
