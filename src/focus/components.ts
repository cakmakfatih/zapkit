import { useEffect, useRef, useState } from '../core/hooks';
import { h, type Child, type VNode } from '../core/vnode';
import { focus, type FocusGroupOptions, type FocusManager } from './focus-manager';

export interface FocusGroupProps extends FocusGroupOptions {
  /** Host tag. Default 'div'. */
  as?: string;
  className?: unknown;
  style?: string | Record<string, string | number>;
  focusId?: string;
  disableFocus?: boolean;
  autoFocus?: boolean;
  children?: Child;
  [attr: string]: unknown;
}

/** A navigation scope (row, column, grid, dialog). See FocusGroupOptions. */
export function FocusGroup(props: FocusGroupProps): VNode {
  const { as = 'div', orientation, wrap, trap, memory, enterTo, children, ...rest } = props;
  return h(as, { ...rest, focusGroup: { orientation, wrap, trap, memory, enterTo } }, children);
}
FocusGroup.displayName = 'FocusGroup';

/** Returns true while the element in `ref` (or any descendant) holds focus. */
export function useFocusWithin(ref: { current: Element | null }, manager: FocusManager = focus): boolean {
  const [within, setWithin] = useState(false);
  useEffect(() => {
    const check = (el: Element | null) => setWithin(!!(el && ref.current && ref.current.contains(el)));
    check(manager.current);
    return manager.subscribe(check);
  }, [manager]);
  return within;
}

/** Calls `handler` for remote keys while the component is mounted (global, before focus handling). */
export function useKeyHandler(
  handler: (key: import('./keys').LogicalKey) => boolean | void,
  priority = 0,
  manager: FocusManager = focus,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => manager.onKey((key) => latest.current(key), priority), [manager, priority]);
}

/** Holds a focus lock for the lifetime of the component (or while `active`). */
export function useFocusLock(reason: string, active = true, manager: FocusManager = focus): void {
  useEffect(() => (active ? manager.lockFocus(reason, 0) : undefined), [active, reason, manager]);
}
