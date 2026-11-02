import type { JSX as ZapkitJSX } from '../jsx-runtime';
import type { ReadonlySignal } from './signal';

/** Marker type for fragments: `<>...</>` or `h(Fragment, null, ...)`. */
export const Fragment = Symbol.for('zapkit-tv.fragment');
export type FragmentType = typeof Fragment;

export type Key = string | number;

/** Anything that can appear as a child in a tree. */
export type Child =
  | VNode
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlySignal<unknown>
  | ChildArray;
export interface ChildArray extends Array<Child> {}

export type FunctionComponent<P = {}> = ((props: P & { children?: Child }) => Child) & {
  displayName?: string;
};

export interface ComponentClass<P = {}> {
  new (props: P): import('./component').Component<P, any>;
  displayName?: string;
  contextType?: import('./context').Context<any>;
  getDerivedStateFromProps?(props: any, state: any): any;
  getDerivedStateFromError?(error: unknown): any;
}

export type ComponentType<P = {}> = FunctionComponent<P> | ComponentClass<P>;
export type VNodeType = string | FragmentType | ComponentType<any>;

export interface VNode<P = any> {
  readonly type: VNodeType;
  readonly props: P & { children?: Child };
  readonly key: Key | null;
  /** Brand used to recognise vnodes created by this library. */
  readonly $kb: 1;
}

export type Ref<T> = { current: T | null } | ((value: T | null) => void);

export function isVNode(value: unknown): value is VNode {
  return typeof value === 'object' && value !== null && (value as VNode).$kb === 1;
}

/**
 * Creates a virtual node. `h` is the JSX factory (`jsxFactory: "h"`) and can be
 * called directly when JSX is not available.
 */
export function h<P>(type: VNodeType, props?: (P & { key?: Key | null }) | null, ...children: Child[]): VNode<P> {
  const normalized: Record<string, unknown> = {};
  let key: Key | null = null;
  if (props) {
    for (const name in props) {
      const value = (props as Record<string, unknown>)[name];
      if (name === 'key' || name === 'idomKey') {
        if (value != null) key = value as Key;
      } else {
        normalized[name] = value;
      }
    }
  }
  if (children.length === 1) normalized.children = children[0];
  else if (children.length > 1) normalized.children = children;
  return { type, props: normalized as P & { children?: Child }, key, $kb: 1 };
}

// Classic JSX (jsxFactory: "h") looks up the JSX namespace on the factory.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace h {
  namespace JSX {
    type Element = ZapkitJSX.Element;
    interface ElementClass extends ZapkitJSX.ElementClass {}
    interface ElementAttributesProperty extends ZapkitJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ZapkitJSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends ZapkitJSX.IntrinsicAttributes {}
    interface IntrinsicElements extends ZapkitJSX.IntrinsicElements {}
  }
}

/** Same as `h` but with children already inside `props` (used by the JSX runtime). */
export function createVNode(type: VNodeType, props: Record<string, unknown> | null, key?: Key | null): VNode {
  const normalized: Record<string, unknown> = {};
  let k: Key | null = key ?? null;
  if (props) {
    for (const name in props) {
      if (name === 'key' || name === 'idomKey') {
        if (props[name] != null) k = props[name] as Key;
      } else {
        normalized[name] = props[name];
      }
    }
  }
  return { type, props: normalized, key: k, $kb: 1 };
}

/** Flattens children into an array, dropping null/boolean holes. */
export function toChildArray(children: Child, out: Child[] = []): Child[] {
  if (children == null || typeof children === 'boolean') return out;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) toChildArray(children[i], out);
  } else {
    out.push(children);
  }
  return out;
}

/** Returns a copy of `vnode` with merged props, like React.cloneElement. */
export function cloneElement<P>(vnode: VNode<P>, props?: Partial<P> & { key?: Key }, ...children: Child[]): VNode<P> {
  const merged: Record<string, unknown> = { ...(vnode.props as object) };
  let key = vnode.key;
  if (props) {
    for (const name in props) {
      if (name === 'key') key = (props as { key?: Key }).key ?? null;
      else merged[name] = (props as Record<string, unknown>)[name];
    }
  }
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return { type: vnode.type, props: merged as P & { children?: Child }, key, $kb: 1 };
}
