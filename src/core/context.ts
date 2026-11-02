import { Component, type Instance } from './component';
import { current } from './current';
import { scheduleUpdate } from './scheduler';
import type { Child, ComponentClass, FunctionComponent } from './vnode';

/**
 * Context: a Provider makes
 * a value available to every descendant, and consumers re-render when the
 * value changes, even if an ancestor in between skipped its render.
 */
export interface Context<T> {
  readonly id: number;
  readonly defaultValue: T;
  displayName?: string;
  readonly Provider: ComponentClass<{ value: T; children?: Child }>;
  readonly Consumer: FunctionComponent<{ children: (value: T) => Child }>;
}

let nextId = 0;

/** @internal */
export abstract class ProviderBase<T> extends Component<{ value: T }> {
  static ctx: Context<any>;
  subs = new Set<Instance>();

  render(): Child {
    return this.props.children ?? null;
  }

  override componentDidUpdate(prev: { value: T }): void {
    if (Object.is(prev.value, this.props.value)) return;
    const pass = this.__kb ? this.__kb.lastPass : -1;
    for (const sub of this.subs) {
      if (sub.unmounted) this.subs.delete(sub);
      else if (sub.lastPass !== pass) scheduleUpdate(sub);
    }
  }

  override componentWillUnmount(): void {
    this.subs.clear();
  }
}

export function createContext<T>(defaultValue: T, displayName?: string): Context<T> {
  const ctx = { id: ++nextId, defaultValue, displayName } as { -readonly [K in keyof Context<T>]: Context<T>[K] };
  class Provider extends ProviderBase<T> {
    static override ctx = ctx as Context<T>;
    static override displayName = (displayName ?? 'Context') + '.Provider';
  }
  ctx.Provider = Provider as unknown as Context<T>['Provider'];
  const Consumer: FunctionComponent<{ children: (value: T) => Child }> = (props) =>
    props.children(readContext(current.instance, ctx as Context<T>));
  Consumer.displayName = (displayName ?? 'Context') + '.Consumer';
  ctx.Consumer = Consumer;
  return ctx as Context<T>;
}

/** @internal Resolves the nearest Provider above `inst` and subscribes to it. */
export function readContext<T>(inst: Instance | null, ctx: Context<T>): T {
  let p = inst ? inst.parent : null;
  while (p) {
    const c = p.component;
    if (c instanceof ProviderBase && (p.type as unknown as { ctx: unknown }).ctx === ctx) {
      if (inst) {
        c.subs.add(inst);
        (inst.contexts || (inst.contexts = new Set())).add(c);
      }
      return (c.props as { value: T }).value;
    }
    p = p.parent;
  }
  return ctx.defaultValue;
}

/** @internal */
export function releaseContexts(inst: Instance): void {
  if (!inst.contexts) return;
  for (const provider of inst.contexts) provider.subs.delete(inst);
  inst.contexts = null;
}
