import { Component } from '../core/component';
import { h, type Child, type VNode } from '../core/vnode';
import { focus as defaultFocus, type FocusManager } from '../focus/focus-manager';

/*
 * Overlay and toast stages.
 *
 * Dialogs, side sheets and toasts are mounted in dedicated layers above the
 * current screen. Overlays are modal: they trap focus, Back closes the top
 * one, and focus returns to where it was when the overlay opened.
 */

export interface OverlayOptions {
  /** Extra class for the overlay layer (e.g. 'kb-overlay--sheet'). */
  className?: string;
  /** Close when Back is pressed. Default true. */
  dismissible?: boolean;
  onClose?: () => void;
}

export interface OverlayHandle {
  close(): void;
  readonly closed: boolean;
}

interface OverlayEntry {
  id: number;
  render: (close: () => void) => Child;
  options: OverlayOptions;
  handle: OverlayHandle;
  returnFocus: Element | null;
}

type Listener = () => void;

export class OverlayController {
  entries: OverlayEntry[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  private releaseBack: (() => void) | null = null;

  constructor(private focusManager: FocusManager = defaultFocus) {}

  open(render: (close: () => void) => Child, options: OverlayOptions = {}): OverlayHandle {
    let closed = false;
    const entry: OverlayEntry = {
      id: this.nextId++,
      render,
      options,
      returnFocus: this.focusManager.current,
      handle: {
        close: () => {
          if (closed) return;
          closed = true;
          this.remove(entry);
        },
        get closed() {
          return closed;
        },
      },
    };
    this.entries = this.entries.concat(entry);
    if (!this.releaseBack) {
      this.releaseBack = this.focusManager.onBack(() => {
        const top = this.entries[this.entries.length - 1];
        if (!top) return false;
        if (top.options.dismissible !== false) top.handle.close();
        return true;
      });
    }
    this.emit();
    return entry.handle;
  }

  closeAll(): void {
    for (const e of this.entries.slice()) e.handle.close();
  }

  private remove(entry: OverlayEntry) {
    this.entries = this.entries.filter((e) => e !== entry);
    if (!this.entries.length && this.releaseBack) {
      this.releaseBack();
      this.releaseBack = null;
    }
    this.emit();
    if (entry.options.onClose) entry.options.onClose();
    const target = entry.returnFocus;
    Promise.resolve().then(() => {
      if (target && target.isConnected) this.focusManager.focus(target, { reason: 'overlay-close', force: true });
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }
}

export const overlays = new OverlayController();

/** Renders the overlay layer. Place it once, after the router. */
export class OverlayStage extends Component<{ controller?: OverlayController }> {
  static override displayName = 'OverlayStage';
  private unsub: (() => void) | null = null;
  private get controller() {
    return this.props.controller || overlays;
  }
  override componentDidMount() {
    this.unsub = this.controller.subscribe(() => this.forceUpdate());
  }
  override componentWillUnmount() {
    if (this.unsub) this.unsub();
  }
  render(): VNode {
    const entries = this.controller.entries;
    return h(
      'div',
      { className: 'kb-overlay-stage' },
      entries.map((e, i) =>
        h(
          'div',
          {
            key: e.id,
            className: ['kb-overlay', e.options.className],
            role: 'dialog',
            'aria-modal': 'true',
            focusGroup: { trap: true, memory: true },
            autoFocus: i === entries.length - 1,
            disableFocus: i !== entries.length - 1,
          },
          e.render(e.handle.close),
        ),
      ),
    );
  }
}

/** Opens an overlay. Shortcut for `overlays.open()`. */
export function openOverlay(render: (close: () => void) => Child, options?: OverlayOptions): OverlayHandle {
  return overlays.open(render, options);
}

// ---------------------------------------------------------------------------
// Toasts

interface ToastEntry {
  id: number;
  message: Child;
  kind: string;
}

class ToastController {
  entries: ToastEntry[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  show(message: Child, options: { duration?: number; kind?: 'info' | 'error' | 'success' } = {}): () => void {
    const entry: ToastEntry = { id: this.nextId++, message, kind: options.kind || 'info' };
    this.entries = this.entries.concat(entry);
    this.emit();
    const dismiss = () => {
      if (this.entries.indexOf(entry) < 0) return;
      this.entries = this.entries.filter((e) => e !== entry);
      this.emit();
    };
    setTimeout(dismiss, options.duration ?? 3000);
    return dismiss;
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }
}

export const toasts = new ToastController();

/** Shows a transient, non-focusable message. Returns a dismiss function. */
export function toast(message: Child, options?: { duration?: number; kind?: 'info' | 'error' | 'success' }): () => void {
  return toasts.show(message, options);
}

export class ToastStage extends Component<{}> {
  static override displayName = 'ToastStage';
  private unsub: (() => void) | null = null;
  override componentDidMount() {
    this.unsub = toasts.subscribe(() => this.forceUpdate());
  }
  override componentWillUnmount() {
    if (this.unsub) this.unsub();
  }
  render(): VNode {
    return h(
      'div',
      { className: 'kb-toast-stage', role: 'status', 'aria-live': 'polite' },
      toasts.entries.map((t) => h('div', { key: t.id, className: ['kb-toast', 'kb-toast--' + t.kind] }, t.message)),
    );
  }
}
