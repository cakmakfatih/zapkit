/**
 * Minimal fine-grained reactivity.
 *
 * Some text nodes are "signal text nodes": the node subscribes to
 * a value and patches only its own `data` when the value changes, without
 * re-rendering the component. Placing a signal directly in a tree does the same
 * here: `<span>{player.timeLabel}</span>`.
 */

type Subscriber = () => void;

interface Source {
  subs: Set<Subscriber>;
}

let activeObserver: Observer | null = null;
let batchDepth = 0;
const pending = new Set<Subscriber>();

interface Observer {
  sources: Set<Source>;
  run: Subscriber;
}

export interface ReadonlySignal<T> {
  readonly value: T;
  /** Reads the value without tracking it as a dependency. */
  peek(): T;
  /** Calls `fn` with each new value. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
  readonly $signal: true;
}

export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
}

function track(source: Source) {
  if (activeObserver) {
    activeObserver.sources.add(source);
    source.subs.add(activeObserver.run);
  }
}

function notify(source: Source) {
  for (const sub of Array.from(source.subs)) {
    if (batchDepth > 0) pending.add(sub);
    else sub();
  }
}

class SignalImpl<T> implements Signal<T> {
  readonly $signal = true as const;
  /** @internal */ subs = new Set<Subscriber>();
  constructor(private v: T) {}

  get value(): T {
    track(this);
    return this.v;
  }
  set value(next: T) {
    if (Object.is(next, this.v)) return;
    this.v = next;
    notify(this);
  }
  peek(): T {
    return this.v;
  }
  subscribe(fn: (value: T) => void): () => void {
    const sub = () => fn(this.v);
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}

class ComputedImpl<T> implements ReadonlySignal<T> {
  readonly $signal = true as const;
  /** @internal */ subs = new Set<Subscriber>();
  private v!: T;
  private dirty = true;
  private observer: Observer;

  constructor(private fn: () => T) {
    this.observer = {
      sources: new Set(),
      run: () => {
        if (!this.dirty) {
          this.dirty = true;
          notify(this);
        }
      },
    };
  }

  private recompute() {
    for (const src of this.observer.sources) src.subs.delete(this.observer.run);
    this.observer.sources.clear();
    const prev = activeObserver;
    activeObserver = this.observer;
    try {
      this.v = this.fn();
    } finally {
      activeObserver = prev;
    }
    this.dirty = false;
  }

  get value(): T {
    track(this);
    if (this.dirty) this.recompute();
    return this.v;
  }
  peek(): T {
    if (this.dirty) this.recompute();
    return this.v;
  }
  subscribe(fn: (value: T) => void): () => void {
    let last = this.peek();
    const sub = () => {
      const next = this.peek();
      if (!Object.is(next, last)) {
        last = next;
        fn(next);
      }
    };
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }
}

export function signal<T>(initial: T): Signal<T> {
  return new SignalImpl(initial);
}

export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return new ComputedImpl(fn);
}

/** Runs `fn` now and again whenever a signal it read changes. Returns a disposer. */
export function effect(fn: () => void | (() => void)): () => void {
  let cleanup: void | (() => void);
  let disposed = false;
  const observer: Observer = {
    sources: new Set(),
    run: () => {
      if (disposed) return;
      if (typeof cleanup === 'function') cleanup();
      for (const src of observer.sources) src.subs.delete(observer.run);
      observer.sources.clear();
      const prev = activeObserver;
      activeObserver = observer;
      try {
        cleanup = fn();
      } finally {
        activeObserver = prev;
      }
    },
  };
  observer.run();
  return () => {
    disposed = true;
    if (typeof cleanup === 'function') cleanup();
    for (const src of observer.sources) src.subs.delete(observer.run);
    observer.sources.clear();
  };
}

/** Groups several signal writes so subscribers run once at the end. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) {
      const subs = Array.from(pending);
      pending.clear();
      for (const sub of subs) sub();
    }
  }
}

export function isSignal(value: unknown): value is ReadonlySignal<unknown> {
  return typeof value === 'object' && value !== null && (value as ReadonlySignal<unknown>).$signal === true;
}
