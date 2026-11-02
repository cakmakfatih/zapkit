import type { Instance } from './component';

export type SchedulerMode = 'microtask' | 'animationFrame' | ((flush: () => void) => void);

const dirty = new Set<Instance>();
let scheduled = false;
let mode: SchedulerMode = 'microtask';
let rerender: (batch: Instance[]) => void = () => {};

/** @internal The renderer registers itself here to avoid an import cycle. */
export function setRerenderer(fn: (batch: Instance[]) => void): void {
  rerender = fn;
}

/**
 * Chooses when batched updates are flushed. `microtask` (default) applies all
 * state changes from one event before the browser paints; `animationFrame`
 * coalesces bursts (e.g. key repeat on a TV remote) into one patch per frame.
 */
export function setScheduler(next: SchedulerMode): void {
  mode = next;
}

function requestFlush() {
  if (scheduled) return;
  scheduled = true;
  if (typeof mode === 'function') mode(flushUpdates);
  else if (mode === 'animationFrame' && typeof requestAnimationFrame === 'function') requestAnimationFrame(flushUpdates);
  else Promise.resolve().then(flushUpdates);
}

export function scheduleUpdate(inst: Instance): void {
  inst.dirty = true;
  dirty.add(inst);
  requestFlush();
}

export function unscheduleUpdate(inst: Instance): void {
  dirty.delete(inst);
}

/** Applies all pending updates now. Safe to call at any time outside a render. */
export function flushUpdates(): void {
  scheduled = false;
  // Updates triggered by lifecycles during this flush run in follow-up loops.
  let guard = 0;
  while (dirty.size) {
    if (++guard > 50) {
      dirty.clear();
      throw new Error('zapkit-tv: update loop detected (more than 50 nested flushes)');
    }
    const batch = Array.from(dirty).sort((a, b) => a.depth - b.depth);
    dirty.clear();
    rerender(batch);
  }
}

/** Runs `fn` and flushes the updates it caused synchronously. */
export function flushSync<T>(fn?: () => T): T | undefined {
  const result = fn ? fn() : undefined;
  flushUpdates();
  return result;
}
