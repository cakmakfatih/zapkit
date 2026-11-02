/*
 * Automatic JSX runtime (`"jsx": "react-jsx", "jsxImportSource": "zapkit-tv"`).
 * Classic mode works too: `"jsxFactory": "h", "jsxFragmentFactory": "Fragment"`.
 */
import { createVNode, Fragment, type Child, type Key, type VNode, type VNodeType } from './core/vnode';

export { Fragment };

export function jsx(type: VNodeType, props: Record<string, unknown> | null, key?: Key): VNode {
  return createVNode(type, props, key);
}
export const jsxs = jsx;
export const jsxDEV = jsx;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = VNode;
  export interface ElementClass {
    render(): Child;
  }
  export interface ElementAttributesProperty {
    props: {};
  }
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicAttributes {
    key?: Key | null;
  }
  export interface IntrinsicElements {
    [tag: string]: HostProps;
  }
}

/** Props accepted by every host element (in addition to any attribute). */
export interface HostProps {
  key?: Key | null;
  ref?: { current: any } | ((el: any) => void) | null;
  children?: Child;
  className?: unknown;
  class?: unknown;
  style?: string | Record<string, string | number | null | undefined>;
  tabIndex?: number;
  /** Makes the element a D-pad focus target (adds data-kb-focusable, tabindex=-1). */
  focusable?: boolean;
  /** Stable id used by focus restore and `focus.focusById()`. */
  focusId?: string;
  /** Marks a spatial navigation group; pass options to configure it. */
  focusGroup?: boolean | import('./focus/focus-manager').FocusGroupOptions;
  /** Removes this subtree from navigation. */
  disableFocus?: boolean;
  /** Not reachable by navigation unless it already holds focus. */
  disableFocusIfBlurred?: boolean;
  /** Focuses the element when it is first created. */
  autoFocus?: boolean;
  /** Children are not touched by the renderer (for DOM owned by other code). */
  skip?: boolean;
  dangerouslySetInnerHTML?: { __html: string };
  [attr: string]: unknown;
}
