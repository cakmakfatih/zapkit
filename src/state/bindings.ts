import { Component, shallowEqual } from '../core/component';
import { createContext, type Context } from '../core/context';
import { useContext, useMemo, useRef, useSubscription } from '../core/hooks';
import { h, type Child, type ComponentType, type VNode } from '../core/vnode';
import type { Action, Dispatch, Store } from './store';

/** Context carrying the store, around the app. */
export const StoreContext: Context<Store | null> = createContext<Store | null>(null, 'Store');

export function StoreProvider(props: { store: Store; children?: Child }): VNode {
  return h(StoreContext.Provider, { value: props.store }, props.children);
}
StoreProvider.displayName = 'StoreProvider';

export function useStore<S = any>(): Store<S> {
  const store = useContext(StoreContext);
  if (!store) throw new Error('zapkit-tv: useStore/useSelector need a <StoreProvider> above');
  return store as Store<S>;
}

export function useDispatch<A extends Action = Action>(): Dispatch<A> {
  return useStore().dispatch as Dispatch<A>;
}

/**
 * Returns `selector(state)` and re-renders when that value changes (compared
 * with `equals`, default Object.is).
 */
export function useSelector<S, R>(selector: (state: S) => R, equals: (a: R, b: R) => boolean = Object.is): R {
  const store = useStore<S>();
  const last = useRef<{ value: R } | null>(null);
  const latest = useRef({ selector, equals });
  latest.current = { selector, equals };
  const subscribe = useMemo(
    () => (onChange: () => void) =>
      store.subscribe(() => {
        const { selector: select, equals: eq } = latest.current;
        const next = select(store.getState());
        if (!last.current || !eq(last.current.value, next)) onChange();
      }),
    [store],
  );
  const value = useSubscription(subscribe, () => selector(store.getState()));
  last.current = { value };
  return value;
}

/** Shallow comparison helper for selectors returning objects. */
export const shallow = <T>(a: T, b: T) => shallowEqual(a as Record<string, unknown>, b as Record<string, unknown>);

/**
 * Higher-order component binding store state and actions to props, the way
 * react-redux's connect() does. The wrapped component only
 * re-renders when the mapped props change shallowly.
 */
export function connect<S, OwnProps, StateProps, DispatchProps = { dispatch: Dispatch }>(
  mapState: ((state: S, own: OwnProps) => StateProps) | null,
  mapDispatch?: ((dispatch: Dispatch, own: OwnProps) => DispatchProps) | Record<string, (...args: any[]) => Action>,
) {
  return function wrap(Inner: ComponentType<OwnProps & StateProps & DispatchProps>): ComponentType<OwnProps> {
    class Connected extends Component<OwnProps> {
      static override displayName = 'Connect(' + ((Inner as { displayName?: string; name?: string }).displayName || Inner.name || 'Component') + ')';
      static override contextType = StoreContext;
      private unsub: (() => void) | null = null;
      private mapped: StateProps | null = null;

      private compute(): OwnProps & StateProps & DispatchProps {
        const store = this.context as Store<S>;
        if (!store) throw new Error('zapkit-tv: connect() needs a <StoreProvider> above');
        const stateProps = mapState ? mapState(store.getState(), this.props) : ({} as StateProps);
        this.mapped = stateProps;
        let dispatchProps: DispatchProps;
        if (!mapDispatch) dispatchProps = { dispatch: store.dispatch } as unknown as DispatchProps;
        else if (typeof mapDispatch === 'function') dispatchProps = mapDispatch(store.dispatch, this.props);
        else {
          const bound: Record<string, unknown> = {};
          for (const k in mapDispatch) bound[k] = (...args: unknown[]) => store.dispatch(mapDispatch[k](...args));
          dispatchProps = bound as DispatchProps;
        }
        return { ...this.props, ...stateProps, ...dispatchProps };
      }

      override componentDidMount() {
        const store = this.context as Store<S>;
        if (!mapState) return;
        this.unsub = store.subscribe(() => {
          const next = mapState(store.getState(), this.props);
          if (!shallowEqual(next as Record<string, unknown>, this.mapped as Record<string, unknown>)) this.forceUpdate();
        });
      }
      override componentWillUnmount() {
        if (this.unsub) this.unsub();
      }
      render(): Child {
        return h(Inner as ComponentType<any>, this.compute() as Record<string, unknown>);
      }
    }
    return Connected as unknown as ComponentType<OwnProps>;
  };
}
