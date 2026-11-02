import { Component, shallowEqual, type Instance } from './component';
import { current } from './current';
import { readContext, type Context } from './context';
import { scheduleUpdate } from './scheduler';
import type { ReadonlySignal } from './signal';
import type { Child, ComponentType, FunctionComponent, Ref } from './vnode';

type Deps = readonly unknown[] | undefined;

interface EffectHook {
  kind: 'effect';
  fn: () => void | (() => void);
  deps: Deps;
  cleanup: void | (() => void);
  pending: boolean;
  layout: boolean;
}
type Hook = { kind: 'state'; value: unknown; set: (v: unknown) => void } | EffectHook | { kind: 'memo'; value: unknown; deps: Deps } | { kind: 'ref'; value: { current: unknown } } | { kind: 'sub'; unsub: () => void; source: unknown };

/**
 * Function components run inside this host, which wraps plain render
 * functions in a component instance so they share one lifecycle.
 */
export class FunctionHost extends Component<Record<string, unknown>> {
  fn!: (props: any) => Child;
  hooks: Hook[] = [];
  hookIndex = 0;
  memoCompare: ((a: any, b: any) => boolean) | null = null;

  render(): Child {
    this.hookIndex = 0;
    return this.fn(this.props);
  }

  override shouldComponentUpdate(nextProps: Record<string, unknown>): boolean {
    if (!this.memoCompare) return true;
    return !this.memoCompare(this.props, nextProps);
  }

  override componentDidMount(): void {
    this.runEffects();
  }
  override componentDidUpdate(): void {
    this.runEffects();
  }
  override componentWillUnmount(): void {
    for (const hook of this.hooks) {
      if (hook.kind === 'effect' && typeof hook.cleanup === 'function') hook.cleanup();
      if (hook.kind === 'sub') hook.unsub();
    }
  }

  private runEffects() {
    // Layout effects first, then passive effects, both after the DOM commit.
    for (const layout of [true, false]) {
      for (const hook of this.hooks) {
        if (hook.kind !== 'effect' || !hook.pending || hook.layout !== layout) continue;
        hook.pending = false;
        if (typeof hook.cleanup === 'function') hook.cleanup();
        hook.cleanup = hook.fn();
      }
    }
  }
}

function host(): FunctionHost {
  const inst = current.instance;
  if (!inst || !(inst.component instanceof FunctionHost)) {
    throw new Error('zapkit-tv: hooks can only be called while a function component renders');
  }
  return inst.component;
}

function nextHook<T extends Hook>(init: () => T): T {
  const h = host();
  const i = h.hookIndex++;
  if (i >= h.hooks.length) h.hooks.push(init());
  return h.hooks[i] as T;
}

function depsChanged(a: Deps, b: Deps): boolean {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const inst = current.instance as Instance;
  const hook = nextHook(() => {
    const h = {
      kind: 'state' as const,
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
      set: (_: unknown) => {},
    };
    h.set = (next: unknown) => {
      const value = typeof next === 'function' ? (next as (p: unknown) => unknown)(h.value) : next;
      if (Object.is(value, h.value)) return;
      h.value = value as T;
      if (!inst.unmounted) scheduleUpdate(inst);
    };
    return h;
  });
  return [hook.value as T, hook.set as (next: T | ((prev: T) => T)) => void];
}

export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void] {
  const [state, setState] = useState(initial);
  const dispatch = useMemo(() => (action: A) => setState((prev) => reducer(prev, action)), []);
  return [state, dispatch];
}

function effectHook(fn: () => void | (() => void), deps: Deps, layout: boolean) {
  const hook = nextHook<EffectHook>(() => ({ kind: 'effect', fn, deps: undefined, cleanup: undefined, pending: true, layout }));
  if (hook.pending || depsChanged(hook.deps, deps)) {
    hook.fn = fn;
    hook.pending = true;
  }
  hook.deps = deps;
}

/** Runs after the component is committed to the DOM (and again when deps change). */
export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void {
  effectHook(fn, deps, false);
}

/** Like useEffect but runs before other effects; use for DOM measurement. */
export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void {
  effectHook(fn, deps, true);
}

export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  const hook = nextHook(() => ({ kind: 'memo' as const, value: factory(), deps }));
  if (depsChanged(hook.deps, deps)) {
    hook.value = factory();
    hook.deps = deps;
  }
  return hook.value as T;
}

export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T {
  return useMemo(() => fn, deps);
}

export function useRef<T>(initial: T): { current: T };
export function useRef<T>(initial?: T | null): { current: T | null };
export function useRef<T>(initial?: T): { current: T | undefined } {
  return nextHook(() => ({ kind: 'ref' as const, value: { current: initial } })).value as { current: T | undefined };
}

export function useContext<T>(ctx: Context<T>): T {
  return readContext(current.instance, ctx);
}

/**
 * Subscribes the component to an external source and re-renders when it
 * changes. `subscribe` must return an unsubscribe function.
 */
export function useSubscription<T>(subscribe: (onChange: () => void) => () => void, getValue: () => T): T {
  const inst = current.instance as Instance;
  const hook = nextHook(() => ({ kind: 'sub' as const, unsub: () => {}, source: null as unknown }));
  if (hook.source !== subscribe) {
    hook.unsub();
    hook.source = subscribe;
    hook.unsub = subscribe(() => {
      if (!inst.unmounted) scheduleUpdate(inst);
    });
  }
  return getValue();
}

/** Re-renders the component whenever the signal changes and returns its value. */
export function useSignalValue<T>(sig: ReadonlySignal<T>): T {
  return useSubscription(useMemo(() => (cb: () => void) => sig.subscribe(cb), [sig]), () => sig.peek());
}

/** Returns a function that forces a re-render. */
export function useForceUpdate(): () => void {
  const inst = current.instance as Instance;
  return useMemo(() => () => {
    if (!inst.unmounted) {
      inst.forced = true;
      scheduleUpdate(inst);
    }
  }, []);
}

/** Assigns a value to a ref (callback or object ref). */
export function assignRef<T>(ref: Ref<T> | null | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
}

/**
 * Skips re-rendering a component when its props are shallowly equal (or when
 * `areEqual` returns true).
 */
export function memo<P>(component: FunctionComponent<P>, areEqual?: (prev: P, next: P) => boolean): ComponentType<P> {
  const compare = areEqual || ((a: P, b: P) => shallowEqual(a as Record<string, unknown>, b as Record<string, unknown>));
  class Memo extends FunctionHost {
    static override displayName = 'Memo(' + (component.displayName || component.name || 'Anonymous') + ')';
    constructor(props: Record<string, unknown>) {
      super(props);
      this.fn = component as (props: any) => Child;
      this.memoCompare = compare;
    }
  }
  return Memo as unknown as ComponentType<P>;
}
