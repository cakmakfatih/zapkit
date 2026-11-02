import { Component } from '../core/component';
import { createContext, type Context } from '../core/context';
import { useContext, useSubscription } from '../core/hooks';
import { h, type Child, type ComponentType, type VNode } from '../core/vnode';
import { focus as defaultFocus, type FocusManager } from '../focus/focus-manager';

/*
 * Stack router for TV apps.
 *
 * TV navigation is a stack: Back returns to the previous screen with the
 * previously focused item focused again. Navigations have types
 * (forward / back / reload) and focus is restored per entry; this router
 * registers itself as the focus manager's Back handler.
 */

export type NavType = 'FORWARD' | 'BACK' | 'REPLACE' | 'RELOAD';

export interface RouteProps<P extends Record<string, string> = Record<string, string>> {
  params: P;
  query: Record<string, string>;
  state: unknown;
  entry: RouteEntry;
  router: Router;
}

export interface RouteDef {
  path: string;
  component: ComponentType<RouteProps<any>>;
  /** Keep the screen mounted (hidden) while other screens are pushed on top. */
  keepAlive?: boolean;
}

export interface RouteEntry {
  id: number;
  path: string;
  route: RouteDef;
  params: Record<string, string>;
  query: Record<string, string>;
  state: unknown;
  /** focusId of the element focused when this entry was left. */
  savedFocusId: string | null;
}

export interface RouterOptions {
  routes: RouteDef[];
  initial?: string;
  focus?: FocusManager;
  /** Called when Back is pressed on the first screen. Return true if handled. */
  onExit?: () => boolean | void;
  /** Mirror the top entry into location.hash and start from it. */
  syncHash?: boolean;
}

interface Matcher {
  route: RouteDef;
  regex: RegExp;
  names: string[];
}

function compile(route: RouteDef): Matcher {
  const names: string[] = [];
  const pattern = route.path
    .replace(/\/+$/, '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:([A-Za-z0-9_]+)(\\\?)?/g, (_m, name: string, optional: string) => {
      names.push(name);
      return optional ? '(?:/([^/]+))?' : '/([^/]+)';
    })
    .replace(/\/\*$/, () => {
      names.push('rest');
      return '(?:/(.*))?';
    });
  return { route, regex: new RegExp('^' + (pattern || '') + '/?$'), names };
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
    out[k] = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
  }
  return out;
}

export class Router {
  stack: RouteEntry[] = [];
  lastNav: NavType = 'RELOAD';
  private matchers: Matcher[];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private focusManager: FocusManager;
  private releaseBack: (() => void) | null = null;
  private options: RouterOptions;

  constructor(options: RouterOptions) {
    this.options = options;
    this.matchers = options.routes.map(compile);
    this.focusManager = options.focus || defaultFocus;
    let initial = options.initial || '/';
    if (options.syncHash && typeof location !== 'undefined' && location.hash.length > 1) initial = location.hash.slice(1);
    const entry = this.resolve(initial, undefined);
    if (entry) this.stack.push(entry);
  }

  get current(): RouteEntry | null {
    return this.stack[this.stack.length - 1] || null;
  }
  get canGoBack(): boolean {
    return this.stack.length > 1;
  }

  /** Finds the route for `path` (with optional `?query`). */
  match(path: string): { route: RouteDef; params: Record<string, string>; query: Record<string, string> } | null {
    const q = path.indexOf('?');
    const pathname = q < 0 ? path : path.slice(0, q);
    const query = parseQuery(q < 0 ? '' : path.slice(q + 1));
    for (const m of this.matchers) {
      const res = m.regex.exec(pathname.replace(/\/+$/, '') || '');
      if (!res) continue;
      const params: Record<string, string> = {};
      m.names.forEach((n, i) => {
        if (res[i + 1] !== undefined) params[n] = decodeURIComponent(res[i + 1]);
      });
      return { route: m.route, params, query };
    }
    return null;
  }

  private resolve(path: string, state: unknown): RouteEntry | null {
    const m = this.match(path);
    if (!m) {
      // eslint-disable-next-line no-console
      console.warn('[zapkit-tv router] no route for', path);
      return null;
    }
    return { id: this.nextId++, path, route: m.route, params: m.params, query: m.query, state, savedFocusId: null };
  }

  private saveFocus() {
    const top = this.current;
    const el = this.focusManager.current;
    if (top && el) {
      const owner = el.closest('[data-focus-id]');
      top.savedFocusId = owner ? owner.getAttribute('data-focus-id') : null;
    }
    this.focusManager.snapshot();
  }

  navigate(path: string, opts: { replace?: boolean; state?: unknown } = {}): boolean {
    const entry = this.resolve(path, opts.state);
    if (!entry) return false;
    this.saveFocus();
    if (opts.replace && this.stack.length) {
      this.stack[this.stack.length - 1] = entry;
      this.lastNav = 'REPLACE';
    } else {
      this.stack.push(entry);
      this.lastNav = 'FORWARD';
    }
    this.emit();
    return true;
  }

  /** Pops the top entry. Returns false on the first screen. */
  back(): boolean {
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    this.lastNav = 'BACK';
    this.emit();
    return true;
  }

  /** Pops entries until one with `path` is on top (or the root). */
  backTo(path: string): void {
    while (this.stack.length > 1 && this.current!.path !== path) this.stack.pop();
    this.lastNav = 'BACK';
    this.emit();
  }

  /** Clears the stack and shows `path`. */
  reset(path: string, state?: unknown): void {
    const entry = this.resolve(path, state);
    if (!entry) return;
    this.stack = [entry];
    this.lastNav = 'RELOAD';
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Registers the router as the Back key handler. */
  attach(): () => void {
    if (!this.releaseBack) {
      this.releaseBack = this.focusManager.onBack(() => {
        if (this.back()) return true;
        return this.options.onExit ? this.options.onExit() : false;
      });
    }
    return () => this.detach();
  }

  detach(): void {
    if (this.releaseBack) this.releaseBack();
    this.releaseBack = null;
  }

  private emit() {
    if (this.options.syncHash && typeof history !== 'undefined' && this.current) {
      history.replaceState(null, '', '#' + this.current.path);
    }
    for (const l of this.listeners) l();
  }

  /** @internal Called by RouterView after a navigation is rendered. */
  restoreFocus(): void {
    const top = this.current;
    if (!top) return;
    const fm = this.focusManager;
    const screen = fm.root && fm.root.querySelector(`[data-kb-screen="${top.id}"]`);
    if (this.lastNav === 'BACK' && top.savedFocusId && fm.focusById(top.savedFocusId, { reason: 'restore', force: true })) return;
    if (screen && !(fm.current && screen.contains(fm.current))) fm.focusFirst(screen);
  }
}

export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}

export const RouterContext: Context<Router | null> = createContext<Router | null>(null, 'Router');

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error('zapkit-tv: useRouter needs a <RouterView> or <RouterContext.Provider> above');
  return router;
}

/** The top route entry; re-renders on navigation. */
export function useRoute(): RouteEntry | null {
  const router = useRouter();
  return useSubscription((cb) => router.subscribe(cb), () => router.current);
}

interface RouterViewProps {
  router: Router;
  /** Class for each screen wrapper. Default 'kb-screen'. */
  screenClass?: string;
  children?: Child;
}

/**
 * Renders the stack. The top entry is visible; entries with `keepAlive` stay
 * mounted but hidden (and out of focus navigation) underneath.
 */
export class RouterView extends Component<RouterViewProps> {
  private unsub: (() => void) | null = null;
  private detachBack: (() => void) | null = null;

  override componentDidMount(): void {
    const router = this.props.router;
    this.unsub = router.subscribe(() => this.forceUpdate(() => router.restoreFocus()));
    this.detachBack = router.attach();
  }
  override componentWillUnmount(): void {
    if (this.unsub) this.unsub();
    if (this.detachBack) this.detachBack();
  }

  render(): VNode {
    const { router, screenClass = 'kb-screen', children } = this.props;
    const stack = router.stack;
    const top = stack.length - 1;
    const screens: VNode[] = [];
    stack.forEach((entry, i) => {
      if (i !== top && !entry.route.keepAlive) return;
      const props: RouteProps = { params: entry.params, query: entry.query, state: entry.state, entry, router };
      screens.push(
        h(
          'div',
          { key: 'screen-' + entry.id, className: screenClass, 'data-kb-screen': entry.id, hidden: i !== top, 'aria-hidden': i !== top ? 'true' : null },
          h(entry.route.component, props),
        ),
      );
    });
    return h(RouterContext.Provider, { value: router }, h('div', { className: 'kb-router' }, screens, children));
  }
}
