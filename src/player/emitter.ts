/** Minimal typed event emitter. */
export class Emitter<Events extends object> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    (this.handlers[event] || (this.handlers[event] = [])).push(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): void {
    const list = this.handlers[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(event: K, ...payload: Events[K] extends void ? [] : [Events[K]]): void {
    const list = this.handlers[event];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(payload[0] as Events[K]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[zapkit-tv player] listener error for ' + String(event), err);
      }
    }
  }

  removeAll(): void {
    this.handlers = {};
  }
}
