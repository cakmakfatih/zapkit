/*
 * zapkit-tv: a React-like UI library for TV web apps.
 *
 * Rendering is done by incremental-dom (Google's open-source library); this
 * package adds components, hooks, context, signals, D-pad focus, a store, a
 * stack router, TV UI primitives and (in `zapkit-tv/player`) a video player.
 */

// Core
export { h, createVNode, cloneElement, toChildArray, isVNode, Fragment } from './core/vnode';
export type { Child, ComponentClass, ComponentType, FunctionComponent, Key, Ref, VNode } from './core/vnode';
export { Component, PureComponent, shallowEqual } from './core/component';
export { createContext } from './core/context';
export type { Context } from './core/context';
export {
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  useContext,
  useSubscription,
  useSignalValue,
  useForceUpdate,
  memo,
} from './core/hooks';
export { signal, computed, effect, batch, isSignal } from './core/signal';
export type { Signal, ReadonlySignal } from './core/signal';
export { render, unmount, options, classNames, getInstance, onNodesCreated, onNodesDeleted } from './core/renderer';
export { preserveClass } from './core/runtime-classes';
export { flushSync, flushUpdates, setScheduler } from './core/scheduler';
export { createPortal, Portal } from './core/portal';
export { defineElement } from './core/element';

// Focus & keys
export * from './focus/index';

// State
export * from './state/index';

// Router
export * from './router/index';

// UI
export * from './ui/index';
