import { onNodesCreated, onNodesDeleted } from '../core/renderer';
import { isDirection, normalizeKey, type LogicalKey } from './keys';

/*
 * D-pad focus management.
 *
 * The focus manager has an initial "NEVER_FOCUSED" state, focus ids
 * (data-focus-id), focus/input locks that warn when they expire, and spatial
 * navigation in JS:
 *
 *  - Elements become targets with the `focusable` prop (data-kb-focusable).
 *  - `focusGroup` elements scope navigation: orientation, wrap, trap, memory
 *    (return to the last focused child) and an entry rule.
 *  - Arrow keys pick the geometrically best candidate inside the innermost
 *    group, then escalate to outer groups.
 *  - Keys are first offered to the focused element as a bubbling `kbkey`
 *    event (`onKbKey` prop); Enter falls back to `click()`, Back to handlers
 *    registered with `onBack()` (the router registers one).
 *  - When the focused node is removed by a render, focus moves to the node
 *    with the same focusId or to the nearest candidate.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusGroupOptions {
  /** Which arrows navigate inside the group. Others escalate to the parent group. Default 'grid'. */
  orientation?: 'horizontal' | 'vertical' | 'grid';
  /** Wrap from the last item to the first along the orientation. */
  wrap?: boolean;
  /** Keep focus inside the group: true for all directions or a list of blocked directions. */
  trap?: boolean | Direction[];
  /** Re-entering the group focuses the child that was focused last. Default true. */
  memory?: boolean;
  /** Child chosen when focus enters the group without memory: 'nearest' (default), 'first' or a focusId. */
  enterTo?: 'nearest' | 'first' | string;
}

export interface KbKeyDetail {
  key: LogicalKey;
  repeat: boolean;
  originalEvent: KeyboardEvent | null;
}

export type FocusState = 'NEVER_FOCUSED' | 'FOCUSED' | 'BLURRED';

export interface FocusManagerOptions {
  /** Minimum ms between repeated (held) arrow keys. 0 disables throttling. Default 60. */
  repeatInterval?: number;
  /** Focus the first target as soon as one is rendered. Default true. */
  autoFocusFirst?: boolean;
  /** Move focus with the mouse pointer (LG Magic Remote, desktop testing). Default true. */
  pointer?: boolean;
  /** Call `scrollIntoView` on focus. Most TV layouts scroll themselves, so default false. */
  scrollIntoView?: boolean;
  /** Class added to the focused element. Default 'kb-focused'. */
  focusedClass?: string;
  /** Class added to groups that contain the focused element. Default 'kb-focus-within'. */
  focusWithinClass?: string;
}

type KeyHandler = (key: LogicalKey, e: KbKeyDetail) => boolean | void;

interface Lock {
  reason: string;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

type GroupEl = Element & { __kbGroup?: FocusGroupOptions };

const FOCUSABLE = '[data-kb-focusable]';
const GROUP = '[data-kb-group]';

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function groupOptions(el: Element): FocusGroupOptions {
  return (el as GroupEl).__kbGroup || {};
}

function allows(orientation: FocusGroupOptions['orientation'], dir: Direction): boolean {
  if (!orientation || orientation === 'grid') return true;
  return orientation === 'horizontal' ? dir === 'left' || dir === 'right' : dir === 'up' || dir === 'down';
}

function isTrapped(opts: FocusGroupOptions, dir: Direction): boolean {
  const trap = opts.trap;
  return trap === true || (Array.isArray(trap) && trap.indexOf(dir) >= 0);
}

/**
 * Scores `to` as a move from `from` in `dir`; lower is better, Infinity means
 * not in that direction. Primary-axis distance dominates; misalignment on the
 * secondary axis is penalised, overlap on it is rewarded.
 */
export function scoreCandidate(from: Rect, to: Rect, dir: Direction): number {
  const EPS = 1;
  let primary: number;
  let overlap: number;
  let offset: number;
  if (dir === 'left' || dir === 'right') {
    primary = dir === 'right' ? to.left - from.right : from.left - to.right;
    if (primary < -EPS) {
      // Allow partially overlapping boxes whose centre is clearly beyond.
      const fc = (from.left + from.right) / 2;
      const tc = (to.left + to.right) / 2;
      if (dir === 'right' ? tc <= from.right : tc >= from.left) return Infinity;
      if (dir === 'right' ? tc <= fc : tc >= fc) return Infinity;
      primary = 0;
    }
    overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
    offset = Math.abs((from.top + from.bottom) / 2 - (to.top + to.bottom) / 2);
  } else {
    primary = dir === 'down' ? to.top - from.bottom : from.top - to.bottom;
    if (primary < -EPS) {
      const fc = (from.top + from.bottom) / 2;
      const tc = (to.top + to.bottom) / 2;
      if (dir === 'down' ? tc <= from.bottom : tc >= from.top) return Infinity;
      if (dir === 'down' ? tc <= fc : tc >= fc) return Infinity;
      primary = 0;
    }
    overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
    offset = Math.abs((from.left + from.right) / 2 - (to.left + to.right) / 2);
  }
  primary = Math.max(0, primary);
  if (overlap > 0) return primary + offset * 0.1;
  // No overlap: the gap on the secondary axis (-overlap) weighs more than distance.
  return primary + offset * 0.5 - overlap * 2;
}

export class FocusManager {
  state: FocusState = 'NEVER_FOCUSED';
  current: Element | null = null;
  root: Element | null = null;
  readonly options: Required<FocusManagerOptions>;

  private keyHandlers: Array<{ fn: KeyHandler; priority: number }> = [];
  private backHandlers: Array<() => boolean | void> = [];
  private listeners = new Set<(el: Element | null, prev: Element | null) => void>();
  private memory = new WeakMap<Element, Element>();
  private focusLocks: Lock[] = [];
  private inputLocks: Lock[] = [];
  private lastKeyTime = 0;
  private lastRect: Rect | null = null;
  private lastFocusId: string | null = null;
  private recoverQueued = false;
  private autoQueued: Element | null = null;
  private cleanups: Array<() => void> = [];

  constructor(options: FocusManagerOptions = {}) {
    this.options = {
      repeatInterval: 60,
      autoFocusFirst: true,
      pointer: true,
      scrollIntoView: false,
      focusedClass: 'kb-focused',
      focusWithinClass: 'kb-focus-within',
      ...options,
    };
  }

  /** Starts listening for keys and DOM changes under `root` (default `document.body`). */
  start(root: Element = document.body): this {
    this.stop();
    this.root = root;
    const win = root.ownerDocument.defaultView as Window;
    const onKeyDown = (e: KeyboardEvent) => this.handleKeyEvent(e);
    win.addEventListener('keydown', onKeyDown, true);
    this.cleanups.push(() => win.removeEventListener('keydown', onKeyDown, true));
    if (this.options.pointer) {
      const onMove = (e: MouseEvent) => {
        const target = (e.target as Element | null)?.closest?.(FOCUSABLE);
        if (target && target !== this.current && this.isFocusable(target)) this.focus(target, { reason: 'pointer' });
      };
      root.addEventListener('mouseover', onMove as EventListener);
      this.cleanups.push(() => root.removeEventListener('mouseover', onMove as EventListener));
    }
    this.cleanups.push(onNodesCreated((nodes) => this.onCreated(nodes)));
    this.cleanups.push(onNodesDeleted(() => this.onDeleted()));
    if (this.options.autoFocusFirst) this.queueMicrotask(() => this.ensureFocus());
    return this;
  }

  stop(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  // -------------------------------------------------------------------------
  // Focus

  /** Moves focus to `el`. Returns false when locked or `el` is not focusable. */
  focus(el: Element | null, opts: { reason?: string; force?: boolean } = {}): boolean {
    if (!el) return false;
    if (this.focusLocks.length && !opts.force) return false;
    if (el === this.current) return true;
    const prev = this.current;
    const { focusedClass, focusWithinClass } = this.options;
    if (prev) {
      prev.classList.remove(focusedClass);
      for (let g = prev.closest(GROUP); g; g = g.parentElement && g.parentElement.closest(GROUP)) {
        if (!g.contains(el)) g.classList.remove(focusWithinClass);
      }
      prev.dispatchEvent(new CustomEvent('kbblur', { bubbles: true, detail: { next: el } }));
    }
    this.current = el;
    this.state = 'FOCUSED';
    el.classList.add(focusedClass);
    for (let g = el.closest(GROUP); g; g = g.parentElement && g.parentElement.closest(GROUP)) {
      g.classList.add(focusWithinClass);
      this.memory.set(g, el);
    }
    const html = el as HTMLElement;
    if (typeof html.focus === 'function') {
      try {
        html.focus({ preventScroll: true });
      } catch {
        html.focus();
      }
    }
    if (this.options.scrollIntoView && typeof html.scrollIntoView === 'function') {
      html.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.lastFocusId = el.getAttribute('data-focus-id');
    el.dispatchEvent(new CustomEvent('kbfocus', { bubbles: true, detail: { prev, reason: opts.reason || 'api' } }));
    for (const l of this.listeners) l(el, prev);
    return true;
  }

  /** Focuses the element with `data-focus-id="id"`. */
  focusById(id: string, opts?: { reason?: string; force?: boolean }): boolean {
    if (!this.root) return false;
    const el = this.root.querySelector(`[data-focus-id="${cssEscape(id)}"]`);
    if (!el) return false;
    return this.focus(this.isFocusable(el) ? el : this.entryOf(el, null, null), opts);
  }

  /** Focuses the first target inside `scope` (default: root), respecting group entry rules. */
  focusFirst(scope: Element | null = this.root): boolean {
    if (!scope) return false;
    const target = this.isFocusable(scope) ? scope : this.entryOf(scope, null, null);
    return this.focus(target, { reason: 'first' });
  }

  /** Clears focus (state becomes BLURRED). */
  blur(): void {
    if (!this.current) return;
    const prev = this.current;
    prev.classList.remove(this.options.focusedClass);
    this.current = null;
    this.state = 'BLURRED';
    prev.dispatchEvent(new CustomEvent('kbblur', { bubbles: true, detail: { next: null } }));
    for (const l of this.listeners) l(null, prev);
  }

  /** Subscribes to focus changes. Returns an unsubscribe function. */
  subscribe(fn: (el: Element | null, prev: Element | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Last focused element inside a group (its memory), if still connected. */
  remembered(group: Element): Element | null {
    const el = this.memory.get(group);
    return el && el.isConnected && group.contains(el) ? el : null;
  }

  // -------------------------------------------------------------------------
  // Locks

  /**
   * Prevents focus from moving (e.g. during a transition). Returns a release
   * function. The lock expires after `timeoutMs` with a warning, so a missed
   * release cannot freeze the UI.
   */
  lockFocus(reason: string, timeoutMs = 3000): () => void {
    return this.addLock(this.focusLocks, reason, timeoutMs, 'Focus lock expired.');
  }

  /** Ignores all remote keys until released (or until it expires). */
  lockInput(reason: string, timeoutMs = 3000): () => void {
    return this.addLock(this.inputLocks, reason, timeoutMs, 'Input lock expired.');
  }

  get isFocusLocked(): boolean {
    return this.focusLocks.length > 0;
  }
  get isInputLocked(): boolean {
    return this.inputLocks.length > 0;
  }

  private addLock(list: Lock[], reason: string, timeoutMs: number, message: string): () => void {
    const lock: Lock = { reason, timer: null };
    const release = () => {
      if (lock.timer) clearTimeout(lock.timer);
      const i = list.indexOf(lock);
      if (i >= 0) list.splice(i, 1);
    };
    if (timeoutMs > 0) {
      lock.timer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn('[zapkit-tv] ' + message, reason);
        release();
      }, timeoutMs);
    }
    list.push(lock);
    return release;
  }

  // -------------------------------------------------------------------------
  // Keys

  /**
   * Adds a global key handler. Handlers run before the focused element sees
   * the key, highest priority first; return true to consume it.
   */
  onKey(fn: KeyHandler, priority = 0): () => void {
    const entry = { fn, priority };
    this.keyHandlers.push(entry);
    this.keyHandlers.sort((a, b) => b.priority - a.priority);
    return () => {
      const i = this.keyHandlers.indexOf(entry);
      if (i >= 0) this.keyHandlers.splice(i, 1);
    };
  }

  /** Adds a Back handler (last added runs first). Return true to consume. */
  onBack(fn: () => boolean | void): () => void {
    this.backHandlers.push(fn);
    return () => {
      const i = this.backHandlers.indexOf(fn);
      if (i >= 0) this.backHandlers.splice(i, 1);
    };
  }

  private handleKeyEvent(e: KeyboardEvent) {
    const key = normalizeKey(e);
    if (!key) return;
    if (this.inputLocks.length) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.repeat && isDirection(key) && this.options.repeatInterval > 0) {
      const now = Date.now();
      if (now - this.lastKeyTime < this.options.repeatInterval) {
        e.preventDefault();
        return;
      }
      this.lastKeyTime = now;
    } else {
      this.lastKeyTime = Date.now();
    }
    if (this.dispatchKey(key, { key, repeat: e.repeat, originalEvent: e })) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Runs the key pipeline: global handlers, `kbkey` event on the focused
   * element, then default behaviour (navigate / click / back). Returns true if
   * something handled the key. Exposed for tests and virtual remotes.
   */
  dispatchKey(key: LogicalKey, detail: KbKeyDetail = { key, repeat: false, originalEvent: null }): boolean {
    for (const h of this.keyHandlers.slice()) if (h.fn(key, detail) === true) return true;
    if (this.current && !this.current.isConnected) this.recover();
    const target = this.current || this.root;
    if (target) {
      const ev = new CustomEvent<KbKeyDetail>('kbkey', { bubbles: true, cancelable: true, detail });
      if (!target.dispatchEvent(ev)) return true;
    }
    if (isDirection(key)) {
      if (!this.current) return this.ensureFocus();
      this.move(key);
      return true;
    }
    if (key === 'enter') {
      if (this.current && typeof (this.current as HTMLElement).click === 'function') {
        (this.current as HTMLElement).click();
        return true;
      }
      return false;
    }
    if (key === 'back') {
      for (let i = this.backHandlers.length - 1; i >= 0; i--) if (this.backHandlers[i]() === true) return true;
      return false;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Spatial navigation

  /** Moves focus one step in `dir`. Returns the new element or null if nothing qualifies. */
  move(dir: Direction): Element | null {
    const from = this.current;
    if (!from || !this.root) return null;
    if (this.focusLocks.length) return null;
    const fromRect = rectOf(from);
    let scope: Element | null = from.closest(GROUP);
    let exclude: Element | null = null;
    while (true) {
      const container: Element = scope && this.root.contains(scope) ? scope : this.root;
      const opts = scope ? groupOptions(scope) : {};
      if (!scope || allows(opts.orientation, dir)) {
        const best = this.bestIn(container, fromRect, dir, from, exclude);
        if (best) {
          const target = this.isFocusable(best) ? best : this.entryOf(best, fromRect, dir);
          if (target && this.focus(target, { reason: 'navigation' })) return target;
        }
        if (scope && opts.wrap) {
          const wrapped = this.wrapTarget(container, fromRect, dir, from);
          if (wrapped && this.focus(wrapped, { reason: 'navigation' })) return wrapped;
        }
      }
      if (!scope || container === this.root) break;
      if (isTrapped(opts, dir)) break;
      exclude = scope;
      const parent: Element | null = scope.parentElement;
      scope = parent ? parent.closest(GROUP) : null;
      if (scope && !this.root.contains(scope)) scope = null;
    }
    from.dispatchEvent(new CustomEvent('kbedge', { bubbles: true, detail: { direction: dir } }));
    return null;
  }

  /**
   * Candidates in a container: focusables whose nearest group is the
   * container, plus nested groups (as one box each), excluding `exclude`.
   */
  private candidates(container: Element, exclude: Element | null): Element[] {
    const out: Element[] = [];
    const nested = container.querySelectorAll(FOCUSABLE + ',' + GROUP);
    for (let i = 0; i < nested.length; i++) {
      const el = nested[i];
      if (el === exclude) continue;
      const owner = el.parentElement ? el.parentElement.closest(GROUP) : null;
      const ownerInScope = owner === container || (container === this.root && (!owner || !this.root.contains(owner)));
      if (!ownerInScope) continue;
      if (el.matches(GROUP)) {
        if (el.hasAttribute('data-kb-nofocus') || !this.hasTarget(el)) continue;
        out.push(el);
      } else if (this.isFocusable(el)) {
        out.push(el);
      }
    }
    return out;
  }

  private bestIn(container: Element, fromRect: Rect, dir: Direction, from: Element, exclude: Element | null): Element | null {
    let best: Element | null = null;
    let bestScore = Infinity;
    for (const el of this.candidates(container, exclude)) {
      if (el === from || el.contains(from)) continue;
      const r = rectOf(el);
      if (r.width === 0 && r.height === 0) continue;
      const s = scoreCandidate(fromRect, r, dir);
      if (s < bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return best;
  }

  private wrapTarget(container: Element, fromRect: Rect, dir: Direction, from: Element): Element | null {
    // Pick the farthest candidate in the opposite direction on the same line.
    const opposite: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };
    let target: Element | null = null;
    let cur = fromRect;
    for (let guard = 0; guard < 500; guard++) {
      const next = this.bestIn(container, cur, opposite[dir], from, null);
      if (!next || next === target) break;
      target = next;
      cur = rectOf(next);
    }
    if (!target) return null;
    return this.isFocusable(target) ? target : this.entryOf(target, fromRect, dir);
  }

  /** Resolves the element to focus when entering `group`. */
  private entryOf(group: Element, fromRect: Rect | null, dir: Direction | null): Element | null {
    const opts = groupOptions(group);
    if (opts.memory !== false) {
      const mem = this.remembered(group);
      if (mem && this.isFocusable(mem)) return mem;
    }
    const enterTo = opts.enterTo || 'nearest';
    if (enterTo !== 'nearest' && enterTo !== 'first') {
      const el = group.querySelector(`[data-focus-id="${cssEscape(enterTo)}"]`);
      if (el && this.isFocusable(el)) return el;
    }
    const list = this.candidates(group, null);
    if (!list.length) return null;
    let pick = list[0];
    if (enterTo === 'nearest' && fromRect) {
      let best = Infinity;
      for (const el of list) {
        const r = rectOf(el);
        const s = dir ? scoreCandidate(fromRect, r, dir) : 0;
        const d = s === Infinity ? distance(fromRect, r) + 1e6 : s;
        if (d < best) {
          best = d;
          pick = el;
        }
      }
    }
    return this.isFocusable(pick) ? pick : this.entryOf(pick, fromRect, dir);
  }

  private hasTarget(group: Element): boolean {
    const list = group.querySelectorAll(FOCUSABLE);
    for (let i = 0; i < list.length; i++) if (this.isFocusable(list[i])) return true;
    return false;
  }

  /** True when `el` can receive focus right now. */
  isFocusable(el: Element): boolean {
    if (!el.hasAttribute('data-kb-focusable')) return false;
    if (!el.isConnected) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.hasAttribute('data-kb-nofocus-blurred') && el !== this.current) return false;
    if (el.closest('[data-kb-nofocus],[hidden],[inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.getClientRects().length === 0) {
      // jsdom reports empty rects for everything; treat "no layout" as visible.
      return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // DOM change handling

  private queueMicrotask(fn: () => void) {
    Promise.resolve().then(fn);
  }

  private ensureFocus(): boolean {
    if (this.current && this.current.isConnected) return true;
    return this.root ? this.focusFirst(this.root) : false;
  }

  private onCreated(nodes: Node[]) {
    for (const n of nodes) {
      if (n.nodeType === 1 && (n as Element).hasAttribute('data-kb-autofocus')) this.autoQueued = n as Element;
    }
    if (this.autoQueued || (this.state === 'NEVER_FOCUSED' && this.options.autoFocusFirst)) {
      this.queueMicrotask(() => {
        const el = this.autoQueued;
        this.autoQueued = null;
        if (el && el.isConnected) {
          const target = this.isFocusable(el) ? el : this.entryOf(el, null, null);
          if (target) this.focus(target, { reason: 'autofocus' });
        } else if (this.state === 'NEVER_FOCUSED') {
          this.ensureFocus();
        }
      });
    }
  }

  private onDeleted() {
    if (this.current) this.lastRect = this.current.isConnected ? rectOf(this.current) : this.lastRect;
    if (this.recoverQueued) return;
    this.recoverQueued = true;
    this.queueMicrotask(() => {
      this.recoverQueued = false;
      if (this.current && !this.current.isConnected) this.recover();
    });
  }

  /** Moves focus away from a removed element: same focusId, else nearest target. */
  recover(): void {
    const lost = this.current;
    if (!lost || lost.isConnected || !this.root) return;
    this.current = null;
    if (this.lastFocusId) {
      const el = this.root.querySelector(`[data-focus-id="${cssEscape(this.lastFocusId)}"]`);
      if (el && this.focus(el.matches(FOCUSABLE) ? el : this.entryOf(el, null, null), { reason: 'recover', force: true })) return;
    }
    const from = this.lastRect;
    let best: Element | null = null;
    let bestD = Infinity;
    const all = this.root.querySelectorAll(FOCUSABLE);
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!this.isFocusable(el)) continue;
      const d = from ? distance(from, rectOf(el)) : i;
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (best) this.focus(best, { reason: 'recover', force: true });
    else this.state = 'BLURRED';
  }

  /** Remembers the rect of the focused element; call before replacing a screen. */
  snapshot(): void {
    if (this.current && this.current.isConnected) this.lastRect = rectOf(this.current);
  }
}

function distance(a: Rect, b: Rect): number {
  const dx = (a.left + a.right) / 2 - (b.left + b.right) / 2;
  const dy = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
  return Math.sqrt(dx * dx + dy * dy);
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** The application-wide focus manager. Call `focus.start()` once at startup. */
export const focus = new FocusManager();
