/*
 * Serialised SourceBuffer access. MSE allows one operation at a time per
 * SourceBuffer; this queue chains appends/removes on `updateend`, evicts back
 * buffer on QuotaExceededError and supports codec switches via changeType.
 */

type Op =
  | { kind: 'append'; data: BufferSource; resolve: () => void; reject: (e: unknown) => void }
  | { kind: 'remove'; start: number; end: number; resolve: () => void; reject: (e: unknown) => void }
  | { kind: 'offset'; offset: number; resolve: () => void; reject: (e: unknown) => void };

export class BufferQueue {
  readonly sb: SourceBuffer;
  private queue: Op[] = [];
  private running: Op | null = null;
  private destroyed = false;
  private readonly media: HTMLMediaElement;
  mime: string;

  constructor(ms: MediaSource, mime: string, media: HTMLMediaElement) {
    this.sb = ms.addSourceBuffer(mime);
    this.mime = mime;
    this.media = media;
    this.sb.addEventListener('updateend', this.onUpdateEnd);
    this.sb.addEventListener('error', this.onError);
  }

  append(data: BufferSource | Uint8Array): Promise<void> {
    return this.enqueue({ kind: 'append', data } as Op);
  }

  remove(start: number, end: number): Promise<void> {
    if (end <= start) return Promise.resolve();
    return this.enqueue({ kind: 'remove', start, end } as Op);
  }

  setTimestampOffset(offset: number): Promise<void> {
    if (Math.abs(this.sb.timestampOffset - offset) < 1e-6) return Promise.resolve();
    return this.enqueue({ kind: 'offset', offset } as Op);
  }

  /** Switches codec/container in place where supported (returns false otherwise). */
  changeType(mime: string): boolean {
    const sb = this.sb as SourceBuffer & { changeType?: (t: string) => void };
    if (mime === this.mime) return true;
    if (!sb.changeType) return false;
    sb.changeType(mime);
    this.mime = mime;
    return true;
  }

  /** Seconds buffered ahead of `time` in the range containing it. */
  bufferedAhead(time: number): number {
    const b = this.safeBuffered();
    if (!b) return 0;
    for (let i = 0; i < b.length; i++) {
      if (time >= b.start(i) - 0.1 && time < b.end(i)) return b.end(i) - time;
    }
    return 0;
  }

  bufferedEnd(): number {
    const b = this.safeBuffered();
    return b && b.length ? b.end(b.length - 1) : 0;
  }

  safeBuffered(): TimeRanges | null {
    try {
      return this.sb.buffered;
    } catch {
      return null; // SourceBuffer removed from its MediaSource
    }
  }

  /** Drops pending operations and aborts the current one (used on seek). */
  async abort(): Promise<void> {
    const pending = this.queue;
    this.queue = [];
    for (const op of pending) op.resolve();
    if (this.sb.updating) {
      await new Promise<void>((r) => this.sb.addEventListener('updateend', () => r(), { once: true }));
    }
  }

  destroy() {
    this.destroyed = true;
    this.queue = [];
    this.sb.removeEventListener('updateend', this.onUpdateEnd);
    this.sb.removeEventListener('error', this.onError);
  }

  get updating(): boolean {
    return this.sb.updating || !!this.running || this.queue.length > 0;
  }

  private enqueue(op: Op): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      op.resolve = resolve;
      op.reject = reject;
      this.queue.push(op);
      this.next();
    });
  }

  private next() {
    if (this.running || this.destroyed || this.sb.updating) return;
    const op = this.queue.shift();
    if (!op) return;
    this.running = op;
    try {
      if (op.kind === 'append') this.sb.appendBuffer(op.data);
      else if (op.kind === 'remove') this.sb.remove(op.start, op.end);
      else {
        this.sb.timestampOffset = op.offset;
        this.running = null;
        op.resolve();
        this.next();
      }
    } catch (e) {
      this.running = null;
      if (op.kind === 'append' && (e as DOMException).name === 'QuotaExceededError') {
        this.evictAndRetry(op);
        return;
      }
      op.reject(e);
      this.next();
    }
  }

  /** Frees buffer behind the playhead, then retries the append once. */
  private evictAndRetry(op: Op & { kind: 'append' }) {
    const t = this.media.currentTime;
    const b = this.safeBuffered();
    const start = b && b.length ? b.start(0) : 0;
    if (t - 8 <= start) {
      op.reject(new DOMException('Buffer full', 'QuotaExceededError'));
      this.next();
      return;
    }
    this.queue.unshift(op);
    this.queue.unshift({ kind: 'remove', start, end: t - 8, resolve: () => {}, reject: () => {} });
    this.next();
  }

  private onUpdateEnd = () => {
    const op = this.running;
    this.running = null;
    if (op) op.resolve();
    this.next();
  };

  private onError = () => {
    const op = this.running;
    this.running = null;
    if (op) op.reject(new Error('SourceBuffer error'));
    this.next();
  };
}
