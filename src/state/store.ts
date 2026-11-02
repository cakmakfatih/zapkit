/*
 * Redux-compatible store.
 *
 * A small store with the Redux contract, so reducers and middleware written for
 * Redux work unchanged.
 */

export interface Action<T extends string = string> {
  type: T;
  [extra: string]: unknown;
}
export interface PayloadAction<P = unknown, T extends string = string> {
  type: T;
  payload: P;
}

export type Reducer<S = any, A extends Action = Action> = (state: S | undefined, action: A) => S;
export type Dispatch<A extends Action = Action> = <T extends A | ThunkAction<any, any>>(action: T) => T extends ThunkAction<infer R, any> ? R : T;
export type ThunkAction<R, S> = (dispatch: Dispatch, getState: () => S, extra: unknown) => R;
export type Listener = () => void;

export interface Store<S = any, A extends Action = Action> {
  getState(): S;
  dispatch: Dispatch<A>;
  subscribe(listener: Listener): () => void;
  replaceReducer(next: Reducer<S, A>): void;
}

export interface MiddlewareAPI<S = any> {
  getState(): S;
  dispatch: Dispatch;
}
export type Middleware<S = any> = (api: MiddlewareAPI<S>) => (next: (action: any) => any) => (action: any) => any;
export type Enhancer<S = any> = (create: typeof createStore) => (reducer: Reducer<S>, preloaded?: S) => Store<S>;

const INIT = { type: '@@zapkit-tv/INIT' };

export function createStore<S, A extends Action = Action>(reducer: Reducer<S, A>, preloaded?: S, enhancer?: Enhancer<S>): Store<S, A> {
  if (enhancer) return enhancer(createStore as typeof createStore)(reducer as Reducer<S>, preloaded) as unknown as Store<S, A>;
  let current = reducer;
  let state = preloaded as S;
  let listeners: Listener[] = [];
  let dispatching = false;

  const store: Store<S, A> = {
    getState: () => state,
    dispatch: ((action: A) => {
      if (typeof action !== 'object' || action === null || typeof action.type !== 'string') {
        throw new Error('zapkit-tv store: actions must be objects with a string `type` (use thunk() for functions)');
      }
      if (dispatching) throw new Error('zapkit-tv store: reducers may not dispatch actions');
      try {
        dispatching = true;
        state = current(state, action);
      } finally {
        dispatching = false;
      }
      const snapshot = listeners;
      for (let i = 0; i < snapshot.length; i++) snapshot[i]();
      return action;
    }) as Dispatch<A>,
    subscribe(listener) {
      listeners = listeners.concat(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
    replaceReducer(next) {
      current = next;
      store.dispatch(INIT as A);
    },
  };
  store.dispatch(INIT as A);
  return store;
}

export function combineReducers<M extends Record<string, Reducer>>(reducers: M): Reducer<{ [K in keyof M]: ReturnType<M[K]> }> {
  const keys = Object.keys(reducers);
  return (state = {} as { [K in keyof M]: ReturnType<M[K]> }, action) => {
    let changed = false;
    const next = {} as Record<string, unknown>;
    for (const k of keys) {
      const prev = (state as Record<string, unknown>)[k];
      const value = reducers[k](prev, action);
      next[k] = value;
      if (value !== prev) changed = true;
    }
    return (changed || keys.length !== Object.keys(state).length ? next : state) as { [K in keyof M]: ReturnType<M[K]> };
  };
}

export function compose<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {
  return (arg) => fns.reduceRight((acc, fn) => fn(acc), arg);
}

export function applyMiddleware<S>(...middlewares: Middleware<S>[]): Enhancer<S> {
  return (create) => (reducer, preloaded) => {
    const store = create(reducer, preloaded);
    let dispatch: Dispatch = () => {
      throw new Error('zapkit-tv store: dispatching while constructing middleware');
    };
    const api: MiddlewareAPI<S> = { getState: store.getState, dispatch: ((a: any) => dispatch(a)) as Dispatch };
    const chain = middlewares.map((m) => m(api));
    dispatch = compose<(a: any) => any>(...chain)(store.dispatch) as Dispatch;
    return { ...store, dispatch };
  };
}

/** Lets `dispatch` accept functions `(dispatch, getState, extra) => result`. */
export function thunk(extra?: unknown): Middleware {
  return ({ dispatch, getState }) => (next) => (action) =>
    typeof action === 'function' ? action(dispatch, getState, extra) : next(action);
}

/** Logs actions and resulting state (development aid). */
export const logger: Middleware = ({ getState }) => (next) => (action) => {
  const result = next(action);
  // eslint-disable-next-line no-console
  console.debug('[store]', action.type, getState());
  return result;
};

type CaseReducers<S> = Record<string, (state: S, action: PayloadAction<any>) => S | void>;
type ActionCreators<S, R extends CaseReducers<S>> = {
  [K in keyof R]: R[K] extends (state: S, action: infer A) => any
    ? A extends PayloadAction<infer P> ? (unknown extends P ? () => PayloadAction<undefined> : (payload: P) => PayloadAction<P>) : () => PayloadAction<undefined>
    : never;
};

export interface Slice<S, R extends CaseReducers<S>> {
  name: string;
  reducer: Reducer<S>;
  actions: ActionCreators<S, R>;
}

/**
 * Builds a reducer plus action creators from case functions. Case functions
 * return the next state (they receive a shallow copy for objects, so
 * `state.x = 1` style updates also work at the top level).
 */
export function createSlice<S, R extends CaseReducers<S>>(config: { name: string; initialState: S; reducers: R }): Slice<S, R> {
  const { name, initialState, reducers } = config;
  const actions = {} as Record<string, (payload?: unknown) => PayloadAction<unknown>>;
  const byType: Record<string, R[keyof R]> = {};
  for (const key of Object.keys(reducers)) {
    const type = name + '/' + key;
    byType[type] = reducers[key] as R[keyof R];
    const creator = (payload?: unknown) => ({ type, payload });
    (creator as { type?: string }).type = type;
    actions[key] = creator;
  }
  const reducer: Reducer<S> = (state = initialState, action) => {
    const fn = byType[action.type];
    if (!fn) return state;
    const draft = state && typeof state === 'object' && !Array.isArray(state) ? { ...(state as object) } as S : state;
    const result = fn(draft, action as unknown as PayloadAction<unknown>);
    return result === undefined ? draft : (result as S);
  };
  return { name, reducer, actions: actions as unknown as ActionCreators<S, R> };
}

/** Memoises a derived value on its input selectors (like reselect). */
export function createSelector<S, I extends unknown[], R>(
  inputs: { [K in keyof I]: (state: S) => I[K] },
  combine: (...args: I) => R,
): (state: S) => R {
  let lastArgs: unknown[] | null = null;
  let lastResult: R;
  return (state) => {
    const args = inputs.map((fn) => fn(state));
    if (lastArgs && args.every((a, i) => Object.is(a, lastArgs![i]))) return lastResult;
    lastArgs = args;
    lastResult = combine(...(args as I));
    return lastResult;
  };
}
