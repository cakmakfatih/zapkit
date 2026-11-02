import type { Child, ComponentClass, Key } from './vnode';
import type { Context } from './context';
import { scheduleUpdate } from './scheduler';

/** Bookkeeping the renderer keeps for every mounted component. */
export interface Instance {
  id: number;
  type: ComponentClass<any> | ((props: any) => Child);
  component: Component<any, any>;
  key: Key | null;
  parent: Instance | null;
  depth: number;
  /** Slot owner this instance lives in (an Element or the parent Instance). */
  owner: object;
  /** Key given to the root host element (explicit key or a stable default). */
  hostKey: Key;
  /** Root element when the instance renders exactly one element, else null. */
  el: Element | null;
  /** Number of top-level DOM nodes produced by the last render. */
  rootCount: number;
  /** Container of the tree this instance belongs to (for root re-renders). */
  root: Element | DocumentFragment;
  dirty: boolean;
  forced: boolean;
  mounted: boolean;
  unmounted: boolean;
  lastPass: number;
  /** Context providers this instance subscribed to. */
  contexts: Set<{ subs: Set<Instance> }> | null;
}

export type StateUpdate<P, S> = Partial<S> | ((prev: Readonly<S>, props: Readonly<P>) => Partial<S> | null) | null;

/**
 * Base class for class components. The lifecycle follows the usual
 * class-component order on top of incremental-dom:
 * getDerivedStateFromProps -> shouldComponentUpdate -> render ->
 * componentDidMount / componentDidUpdate(prevProps, prevState).
 */
export abstract class Component<P = {}, S = {}> {
  static readonly isZapkitComponent = true;
  static displayName?: string;
  static contextType?: Context<any>;

  props: Readonly<P & { children?: Child }>;
  state: Readonly<S> = {} as S;
  /** Value of `static contextType`, refreshed before each render. */
  context: any;

  /** @internal */ __kb: Instance | null = null;
  /** @internal */ __pending: Array<StateUpdate<P, S>> = [];
  /** @internal */ __callbacks: Array<() => void> = [];

  constructor(props: P) {
    this.props = props as P & { children?: Child };
  }

  abstract render(): Child;

  componentDidMount?(): void;
  componentDidUpdate?(prevProps: Readonly<P & { children?: Child }>, prevState: Readonly<S>): void;
  componentWillUnmount?(): void;
  shouldComponentUpdate?(nextProps: Readonly<P & { children?: Child }>, nextState: Readonly<S>): boolean;
  componentDidCatch?(error: unknown, info: { componentStack: string }): void;

  /** Queues a state change. Updates are batched and applied on the next flush. */
  setState(update: StateUpdate<P, S>, callback?: () => void): void {
    this.__pending.push(update);
    if (callback) this.__callbacks.push(callback);
    if (this.__kb && !this.__kb.unmounted) scheduleUpdate(this.__kb);
  }

  /** Re-renders this component even if shouldComponentUpdate would return false. */
  forceUpdate(callback?: () => void): void {
    if (callback) this.__callbacks.push(callback);
    if (this.__kb && !this.__kb.unmounted) {
      this.__kb.forced = true;
      scheduleUpdate(this.__kb);
    }
  }

  /** The component's root element (null for fragments or before mount). */
  get el(): Element | null {
    return this.__kb ? this.__kb.el : null;
  }

  /** @internal Applies queued setState calls and returns the next state. */
  __nextState(props: P): S {
    let state = this.state;
    if (this.__pending.length) {
      const queue = this.__pending;
      this.__pending = [];
      for (const update of queue) {
        const partial = typeof update === 'function' ? update(state, props) : update;
        if (partial != null) state = { ...state, ...partial };
      }
    }
    return state;
  }
}

export function isComponentClass(type: unknown): type is ComponentClass<any> {
  return typeof type === 'function' && (type as { isZapkitComponent?: boolean }).isZapkitComponent === true;
}

/** Shallow equality used by PureComponent and memo(). */
export function shallowEqual(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** Component that only re-renders when props or state shallowly change. */
export abstract class PureComponent<P = {}, S = {}> extends Component<P, S> {
  override shouldComponentUpdate(nextProps: Readonly<P>, nextState: Readonly<S>): boolean {
    return !shallowEqual(this.props as Record<string, unknown>, nextProps as Record<string, unknown>) ||
      !shallowEqual(this.state as Record<string, unknown>, nextState as Record<string, unknown>);
  }
}
