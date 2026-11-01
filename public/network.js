// Bound the entire read, including a stalled response body. Writes are never retried here.
export async function getJson(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const r = await fetch(url, { cache: 'no-store', ...opts, signal: controller.signal });
      if (!r.ok) {
        const error = new Error(`HTTP ${r.status}`);
        error.status = r.status;
        throw error;
      }
      return r.json();
    })()]);
  } finally {
    clearTimeout(timer);
  }
}
