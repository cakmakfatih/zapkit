import type { ByteRange } from './mpd';

/*
 * HTTP loader with byte ranges, retries with backoff, abort support and
 * bandwidth samples for ABR.
 */

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface LoadOptions {
  range?: ByteRange;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number;
  onSample?: (ms: number, bytes: number) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal && signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export async function loadBytes(url: string, opts: LoadOptions = {}): Promise<Uint8Array> {
  const retries = opts.retries ?? 3;
  let attempt = 0;
  for (;;) {
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (opts.range) headers.Range = `bytes=${opts.range.start}-${opts.range.end}`;
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers, signal: opts.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (opts.onSample) opts.onSample(performance.now() - t0, buf.byteLength);
      return buf;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // 4xx other than 408/429 will not get better by retrying.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      if (attempt++ >= retries) throw e;
      await sleep(500 * Math.pow(2, attempt - 1), opts.signal);
    }
  }
}

export async function loadText(url: string, opts: LoadOptions = {}): Promise<{ text: string; url: string }> {
  const retries = opts.retries ?? 2;
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(url, { headers: opts.headers, signal: opts.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      return { text: await res.text(), url: res.url || url };
    } catch (e) {
      if ((e as Error).name === 'AbortError' || attempt++ >= retries) throw e;
      await sleep(500 * attempt, opts.signal);
    }
  }
}
