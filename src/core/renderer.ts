import {
  attr,
  attributes,
  close,
  currentPointer,
  elementClose,
  elementOpenEnd,
  elementOpenStart,
  notifications,
  patchInner,
  patchOuter,
  skip,
  skipNode,
  symbols,
  text,
} from 'incremental-dom';
import { isComponentClass, type Component, type Instance } from './component';
import { releaseContexts, readContext } from './context';
import { current } from './current';
import { runtimeClasses } from './runtime-classes';
import { FunctionHost, assignRef } from './hooks';
import { setRerenderer, unscheduleUpdate } from './scheduler';
import { isSignal, type ReadonlySignal } from './signal';
import { Fragment, isVNode, type Child, type ComponentClass, type Key, type VNode } from './vnode';

/*
 * Renderer: maps vnodes onto incremental-dom instructions.
 *
 * incremental-dom (Google's open-source library) patches the real DOM in
 * place, matching nodes by tag + key. This module adds what is
 * layered on top of it: components with state and lifecycles, keyed component identity,
 * prop -> attribute/property/event mapping, signal text nodes, refs, focus
 * attributes and error boundaries.
 *
 * Component identity: every component lives in a "slot" of its owner. The
 * owner is the nearest host element opened inside the parent component, or the
 * parent component itself when the child is a direct (fragment-level) output.
 * Slots are keyed by component type + key (or type + position), so a partial
 * re-render of one component finds exactly the same instances as a full pass.
 */

export interface RenderOptions {
  /** Called for errors thrown while rendering that no error boundary handled. */
  onError(error: unknown, componentStack: string): void;
}

export const options: RenderOptions = {
  onError(error, componentStack) {
    // eslint-disable-next-line no-console
    console.error('[zapkit-tv] render error\n' + componentStack, error);
  },
};

interface SlotState {
  slots: Map<string, Instance>;
  visit: number;
  seen: Set<string> | null;
  counters: Map<string, number> | null;
}

interface Frame {
  depth: number;
  count: number;
  first: Node | null;
}

interface KbElement extends Element {
  __kbEv?: Record<string, ((e: Event) => void) | undefined>;
  __kbStyle?: Record<string, unknown>;
  __kbRef?: unknown;
  __kbHtml?: string;
  __kbInstance?: Instance;
}

interface KbText extends Text {
  __kbSig?: ReadonlySignal<unknown>;
  __kbUnsub?: () => void;
}

const slotStates = new WeakMap<object, SlotState>();
const typeIds = new WeakMap<object, string>();
const customElementTags = new Set<string>();
const createdListeners = new Set<(nodes: Node[]) => void>();
const deletedListeners = new Set<(nodes: Node[]) => void>();
const commitQueue: Array<() => void> = [];

let typeCounter = 0;
let instanceCounter = 0;
let visitCounter = 0;

// Render state for the patch in progress (saved/restored around nested patches).
let ownerStack: object[] = [];
let visitStack: number[] = [];
let frames: Frame[] = [];
let depth = 0;
let currentRoot: Element | DocumentFragment | null = null;
let patchDepth = 0;

// ---------------------------------------------------------------------------
// Attribute mutators

const UNITLESS = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'scale',
]);
const PROPERTIES = new Set([
  'value', 'checked', 'selected', 'muted', 'volume', 'currentTime', 'playbackRate', 'srcObject', 'indeterminate',
  'defaultValue', 'scrollTop', 'scrollLeft',
]);

function eventProxy(this: KbElement, e: Event) {
  const fn = this.__kbEv && this.__kbEv[e.type];
  if (fn) fn.call(this, e);
}
function eventProxyCapture(this: KbElement, e: Event) {
  const fn = this.__kbEv && this.__kbEv[e.type + '!'];
  if (fn) fn.call(this, e);
}

function setListener(el: KbElement, name: string, value: unknown) {
  // name format: "on:<type>" or "on:<type>!" for capture
  const slot = name.slice(3);
  const capture = slot.charCodeAt(slot.length - 1) === 33;
  const type = capture ? slot.slice(0, -1) : slot;
  const map = el.__kbEv || (el.__kbEv = {});
  if (typeof value === 'function') {
    if (!map[slot]) el.addEventListener(type, capture ? eventProxyCapture : eventProxy, capture);
    map[slot] = value as (e: Event) => void;
  } else if (map[slot]) {
    el.removeEventListener(type, capture ? eventProxyCapture : eventProxy, capture);
    map[slot] = undefined;
  }
}

function setStyleProp(style: CSSStyleDeclaration, name: string, value: unknown) {
  if (name.indexOf('-') >= 0) {
    if (value == null || value === '') style.removeProperty(name);
    else style.setProperty(name, String(value));
    return;
  }
  const v = value == null ? '' : typeof value === 'number' && !UNITLESS.has(name) ? value + 'px' : String(value);
  (style as unknown as Record<string, string>)[name] = v;
}

function applyStyle(el: Element, _name: string, value: unknown) {
  const node = el as KbElement & HTMLElement;
  const style = node.style;
  if (value == null || typeof value === 'string') {
    node.__kbStyle = undefined;
    if (value) style.cssText = value;
    else el.removeAttribute('style');
    return;
  }
  const next = value as Record<string, unknown>;
  const prev = node.__kbStyle || {};
  for (const k in prev) if (!(k in next)) setStyleProp(style, k, null);
  for (const k in next) if (prev[k] !== next[k]) setStyleProp(style, k, next[k]);
  node.__kbStyle = { ...next };
}

function applyGeneric(el: Element, name: string, value: unknown) {
  if (name.charCodeAt(0) === 111 && name.charCodeAt(2) === 58 && name.startsWith('on:')) {
    setListener(el as KbElement, name, value);
  } else if (name.startsWith('prop:')) {
    const prop = name.slice(5);
    (el as unknown as Record<string, unknown>)[prop] = value === undefined && prop === 'value' ? '' : value;
  } else if (value == null || value === false) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, '');
  } else if (typeof value === 'object' || typeof value === 'function') {
    (el as unknown as Record<string, unknown>)[name] = value;
  } else {
    el.setAttribute(name, String(value));
  }
}

function applyClass(el: Element, _name: string, value: unknown) {
  let next = value == null || value === false ? '' : String(value);
  if (runtimeClasses.size) {
    const list = el.classList;
    runtimeClasses.forEach((c) => {
      if (list.contains(c) && !(' ' + next + ' ').includes(' ' + c + ' ')) next = next ? next + ' ' + c : c;
    });
  }
  if (next) el.setAttribute('class', next);
  else el.removeAttribute('class');
}

attributes[symbols.default] = applyGeneric;
attributes.style = applyStyle;
attributes.class = applyClass;

const EVENT_ALIASES: Record<string, string> = { doubleclick: 'dblclick' };

function eventName(prop: string): string {
  let name = prop.slice(2);
  let capture = false;
  if (name.endsWith('Capture')) {
    capture = true;
    name = name.slice(0, -7);
  }
  name = name.toLowerCase();
  name = EVENT_ALIASES[name] || name;
  return 'on:' + name + (capture ? '!' : '');
}

/** Normalises className values: string, array, or { name: boolean } map. */
export function classNames(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const v of value) {
      const s = classNames(v);
      if (s) out = out ? out + ' ' + s : s;
    }
    return out;
  }
  if (typeof value === 'object') {
    let out = '';
    for (const k in value as Record<string, unknown>) {
      if ((value as Record<string, unknown>)[k]) out = out ? out + ' ' + k : k;
    }
    return out;
  }
  return String(value);
}

const RESERVED: Record<string, 1> = {
  children: 1, ref: 1, skip: 1, dangerouslySetInnerHTML: 1, key: 1,
};

const EMPTY_GROUP = Object.freeze({});

// ---------------------------------------------------------------------------
// Slot bookkeeping

function slotState(owner: object): SlotState {
  let st = slotStates.get(owner);
  if (!st) {
    st = { slots: new Map(), visit: 0, seen: null, counters: null };
    slotStates.set(owner, st);
  }
  return st;
}

function pushOwner(owner: object) {
  ownerStack.push(owner);
  visitStack.push(++visitCounter);
}

function popOwner(finalize: boolean) {
  const owner = ownerStack.pop() as object;
  const visit = visitStack.pop() as number;
  if (!finalize) return;
  const st = slotStates.get(owner);
  if (!st || st.slots.size === 0) return;
  if (st.visit !== visit) {
    for (const inst of st.slots.values()) unmountInstance(inst);
    st.slots.clear();
  } else {
    for (const [k, inst] of st.slots) {
      if (!st.seen!.has(k)) {
        unmountInstance(inst);
        st.slots.delete(k);
      }
    }
  }
  st.seen = null;
  st.counters = null;
}

function typeId(type: object): string {
  let id = typeIds.get(type);
  if (!id) {
    id = 'c' + ++typeCounter;
    typeIds.set(type, id);
  }
  return id;
}

/** Records a node emitted at the current element depth for enclosing components. */
function emit(node: Node) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.depth !== depth) break;
    if (f.count++ === 0) f.first = node;
  }
}

// ---------------------------------------------------------------------------
// Tree walking

function renderChild(child: Child): void {
  if (child == null || typeof child === 'boolean') return;
  if (typeof child === 'string' || typeof child === 'number') {
    emit(text(child));
    return;
  }
  if (Array.isArray(child)) {
    for (let i = 0; i < child.length; i++) renderChild(child[i]);
    return;
  }
  if (isVNode(child)) {
    const type = child.type;
    if (typeof type === 'string') renderHost(child);
    else if (type === Fragment) renderChild(child.props.children);
    else renderComponent(child);
    return;
  }
  if (isSignal(child)) {
    renderSignalText(child);
    return;
  }
  emit(text(String(child)));
}

function renderSignalText(sig: ReadonlySignal<unknown>) {
  const node = text(String(sig.peek() ?? '')) as KbText;
  emit(node);
  if (node.__kbSig !== sig) {
    if (node.__kbUnsub) node.__kbUnsub();
    node.__kbSig = sig;
    node.__kbUnsub = sig.subscribe((v) => {
      const s = String(v ?? '');
      if (node.data !== s) node.data = s;
    });
  }
}

function renderHost(vnode: VNode) {
  const tag = vnode.type as string;
  const props = vnode.props as Record<string, unknown>;
  elementOpenStart(tag, vnode.key as Key | undefined);
  let focusable = false;
  for (const name in props) {
    if (RESERVED[name] === 1) continue;
    const value = props[name];
    switch (name) {
      case 'className':
      case 'class':
        attr('class', classNames(value) || null);
        continue;
      case 'style':
        attr('style', value);
        continue;
      case 'htmlFor':
        attr('for', value);
        continue;
      case 'tabIndex':
        attr('tabindex', value);
        continue;
      case 'focusable':
        if (value) {
          focusable = true;
          attr('data-kb-focusable', '');
        }
        continue;
      case 'focusId':
        attr('data-focus-id', value);
        continue;
      case 'focusGroup':
        if (value) {
          attr('data-kb-group', '');
          attr('prop:__kbGroup', value === true ? EMPTY_GROUP : value);
        }
        continue;
      case 'disableFocus':
        attr('data-kb-nofocus', value ? '' : null);
        continue;
      case 'disableFocusIfBlurred':
        attr('data-kb-nofocus-blurred', value ? '' : null);
        continue;
      case 'autoFocus':
        attr('data-kb-autofocus', value ? '' : null);
        continue;
    }
    if (name.length > 2 && name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110 && name.charCodeAt(2) < 97) {
      attr(eventName(name), value);
    } else if (PROPERTIES.has(name)) {
      attr('prop:' + name, value);
    } else {
      attr(name, value);
    }
  }
  if (focusable && props.tabIndex == null) attr('tabindex', -1);
  const el = elementOpenEnd() as KbElement;
  emit(el);
  depth++;
  pushOwner(el);
  let rendered = true;
  const html = props.dangerouslySetInnerHTML as { __html: string } | undefined;
  if (html) {
    if (el.__kbHtml !== html.__html) {
      (el as HTMLElement).innerHTML = html.__html;
      el.__kbHtml = html.__html;
    }
    skip();
    rendered = false;
  } else if (props.skip || customElementTags.has(tag)) {
    if (customElementTags.has(tag)) (el as unknown as { kbProps: unknown }).kbProps = props;
    skip();
    rendered = false;
  } else {
    renderChild(props.children as Child);
  }
  popOwner(rendered);
  depth--;
  elementClose(tag);
  const ref = props.ref;
  if (ref !== el.__kbRef) {
    if (el.__kbRef) assignRef(el.__kbRef as never, null);
    el.__kbRef = ref;
    if (ref) assignRef(ref as never, el);
  }
}

function renderComponent(vnode: VNode) {
  const type = vnode.type as object;
  const top = ownerStack.length - 1;
  const owner = ownerStack[top];
  const visit = visitStack[top];
  const st = slotState(owner);
  if (st.visit !== visit) {
    st.visit = visit;
    st.seen = new Set();
    st.counters = new Map();
  }
  const uid = typeId(type);
  let slotKey: string;
  if (vnode.key != null) {
    slotKey = uid + '#' + vnode.key;
  } else {
    const n = st.counters!.get(uid) || 0;
    st.counters!.set(uid, n + 1);
    slotKey = uid + '@' + n;
  }
  st.seen!.add(slotKey);
  let inst = st.slots.get(slotKey);
  let isNew = false;
  if (!inst || inst.unmounted) {
    const hostKey = vnode.key != null ? vnode.key : ownerIsInstance(owner) ? (owner as Instance).id + ':' + slotKey : slotKey;
    try {
      inst = createInstance(vnode, owner, hostKey);
    } catch (err) {
      reportError(current.instance, err, describe(type));
      return;
    }
    st.slots.set(slotKey, inst);
    isNew = true;
  }
  inst.owner = owner;
  renderInstance(inst, vnode.props, isNew);
}

function ownerIsInstance(owner: object): boolean {
  return typeof (owner as Instance).id === 'number' && 'component' in owner;
}

function createInstance(vnode: VNode, owner: object, hostKey: Key): Instance {
  const type = vnode.type as ComponentClass<any> | ((p: any) => Child);
  const parent = current.instance;
  const inst: Instance = {
    id: ++instanceCounter,
    type,
    component: null as unknown as Component<any, any>,
    key: vnode.key,
    hostKey,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    owner,
    el: null,
    rootCount: 0,
    root: currentRoot as Element,
    dirty: false,
    forced: false,
    mounted: false,
    unmounted: false,
    lastPass: 0,
    contexts: null,
  };
  let c: Component<any, any>;
  if (isComponentClass(type)) {
    // Context must be readable from the constructor via contextType.
    const prev = current.instance;
    current.instance = inst;
    try {
      c = new type(vnode.props);
    } finally {
      current.instance = prev;
    }
  } else {
    const fh = new FunctionHost(vnode.props);
    fh.fn = type as (p: any) => Child;
    c = fh;
  }
  c.__kb = inst;
  inst.component = c;
  return inst;
}

function renderInstance(inst: Instance, props: Record<string, unknown>, isNew: boolean) {
  const c = inst.component;
  const type = inst.type as ComponentClass<any>;
  if (!isNew && !inst.forced && !inst.dirty && props === c.props) {
    skipInstance(inst);
    return;
  }
  let nextState = c.__nextState(props);
  if (type.getDerivedStateFromProps) {
    const derived = type.getDerivedStateFromProps(props, nextState);
    if (derived != null) nextState = { ...nextState, ...derived };
  }
  if (!isNew && !inst.forced && c.shouldComponentUpdate && !c.shouldComponentUpdate(props, nextState)) {
    c.props = props;
    c.state = nextState;
    inst.dirty = false;
    unscheduleUpdate(inst);
    queueCallbacks(c);
    skipInstance(inst);
    return;
  }
  const prevProps = c.props;
  const prevState = c.state;
  c.props = props;
  c.state = nextState;
  inst.dirty = false;
  inst.forced = false;
  inst.lastPass = current.pass;
  unscheduleUpdate(inst);

  const frame: Frame = { depth, count: 0, first: null };
  frames.push(frame);
  pushOwner(inst);
  const prevInstance = current.instance;
  current.instance = inst;
  const savedDepth = depth;
  const savedOwners = ownerStack.length;
  const savedFrames = frames.length;
  // Only a component whose output is structurally one element (a host vnode,
  // or a component that is itself element-rooted) can be re-patched through
  // that element; fragments/arrays that happen to yield one node cannot.
  let elementRooted = false;
  try {
    if (type.contextType) c.context = readContext(inst, type.contextType);
    let out = c.render();
    if (isVNode(out) && out.key == null && out.type !== Fragment) {
      out = { type: out.type, props: out.props, key: inst.hostKey, $kb: 1 };
    }
    renderChild(out);
    if (isVNode(out)) {
      if (typeof out.type === 'string') elementRooted = true;
      else if (out.type !== Fragment) {
        const st = slotStates.get(inst);
        const child = st && st.slots.get(typeId(out.type as object) + '#' + out.key);
        elementRooted = !!(child && child.el);
      }
    }
  } catch (err) {
    // Close any elements this component left open so incremental-dom's
    // cursor stays consistent, then route the error to a boundary.
    while (depth > savedDepth) {
      close();
      depth--;
    }
    ownerStack.length = savedOwners;
    visitStack.length = savedOwners;
    frames.length = savedFrames;
    reportError(inst, err, describe(inst.type));
  }
  popOwner(true);
  frames.pop();
  current.instance = prevInstance;

  inst.rootCount = frame.count;
  const first = frame.first;
  inst.el = elementRooted && frame.count === 1 && first && first.nodeType === 1 ? (first as Element) : null;
  if (inst.el) (inst.el as KbElement).__kbInstance = inst;

  if (isNew) {
    commitQueue.push(() => {
      if (inst.unmounted) return;
      inst.mounted = true;
      if (c.componentDidMount) c.componentDidMount();
      runCallbacks(c);
    });
  } else {
    commitQueue.push(() => {
      if (inst.unmounted) return;
      if (c.componentDidUpdate) c.componentDidUpdate(prevProps, prevState);
      runCallbacks(c);
    });
  }
}

function skipInstance(inst: Instance) {
  for (let i = 0; i < inst.rootCount; i++) {
    const node = currentPointer();
    if (!node) break;
    skipNode();
    emit(node);
  }
}

function queueCallbacks(c: Component<any, any>) {
  if (c.__callbacks.length) commitQueue.push(() => runCallbacks(c));
}

function runCallbacks(c: Component<any, any>) {
  if (!c.__callbacks.length) return;
  const cbs = c.__callbacks;
  c.__callbacks = [];
  for (const cb of cbs) cb();
}

function describe(type: unknown): string {
  const t = type as { displayName?: string; name?: string };
  return t && (t.displayName || t.name) || 'Anonymous';
}

function componentStack(inst: Instance | null): string {
  const lines: string[] = [];
  for (let p = inst; p; p = p.parent) lines.push('    in ' + describe(p.type));
  return lines.join('\n');
}

function reportError(inst: Instance | null, error: unknown, _name: string) {
  let boundary = inst ? inst.parent : null;
  while (boundary) {
    const t = boundary.type as ComponentClass<any>;
    if (!boundary.unmounted && (t.getDerivedStateFromError || boundary.component.componentDidCatch)) break;
    boundary = boundary.parent;
  }
  const stack = componentStack(inst);
  if (!boundary) {
    options.onError(error, stack);
    return;
  }
  const b = boundary;
  const t = b.type as ComponentClass<any>;
  if (t.getDerivedStateFromError) b.component.__pending.push(t.getDerivedStateFromError(error));
  commitQueue.push(() => {
    if (b.component.componentDidCatch) b.component.componentDidCatch(error, { componentStack: stack });
    if (!b.unmounted) b.component.forceUpdate();
  });
}

// ---------------------------------------------------------------------------
// Unmounting

function unmountInstance(inst: Instance) {
  if (inst.unmounted) return;
  inst.unmounted = true;
  unscheduleUpdate(inst);
  try {
    if (inst.component.componentWillUnmount) inst.component.componentWillUnmount();
  } catch (err) {
    options.onError(err, componentStack(inst));
  }
  releaseContexts(inst);
  const st = slotStates.get(inst);
  if (st) {
    for (const child of st.slots.values()) unmountInstance(child);
    st.slots.clear();
  }
}

function cleanupTree(root: Node) {
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop() as Node;
    if (node.nodeType === 3) {
      const t = node as KbText;
      if (t.__kbUnsub) {
        t.__kbUnsub();
        t.__kbUnsub = undefined;
        t.__kbSig = undefined;
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as KbElement;
    const st = slotStates.get(el);
    if (st) {
      for (const inst of st.slots.values()) unmountInstance(inst);
      st.slots.clear();
    }
    if (el.__kbRef) {
      assignRef(el.__kbRef as never, null);
      el.__kbRef = undefined;
    }
    for (let c = el.firstChild; c; c = c.nextSibling) stack.push(c);
  }
}

notifications.nodesDeleted = (nodes) => {
  for (const n of nodes) cleanupTree(n);
  for (const l of deletedListeners) l(nodes);
};
notifications.nodesCreated = (nodes) => {
  for (const l of createdListeners) l(nodes);
};

/** Subscribes to nodes added by any patch. Returns an unsubscribe function. */
export function onNodesCreated(listener: (nodes: Node[]) => void): () => void {
  createdListeners.add(listener);
  return () => createdListeners.delete(listener);
}

/** Subscribes to nodes removed by any patch. Returns an unsubscribe function. */
export function onNodesDeleted(listener: (nodes: Node[]) => void): () => void {
  deletedListeners.add(listener);
  return () => deletedListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Patching entry points

interface RootContainer {
  __kbVNode?: Child;
  __kbParent?: Instance | null;
}

function withPatchState(root: Element | DocumentFragment, fn: () => void) {
  const saved = [ownerStack, visitStack, frames, depth, currentRoot, current.instance] as const;
  ownerStack = [];
  visitStack = [];
  frames = [];
  depth = 0;
  currentRoot = root;
  patchDepth++;
  try {
    fn();
  } finally {
    patchDepth--;
    [ownerStack, visitStack, frames, depth, currentRoot] = [saved[0], saved[1], saved[2], saved[3], saved[4]];
    current.instance = saved[5];
  }
}

function flushCommit() {
  if (patchDepth > 0) return;
  while (commitQueue.length) {
    const queue = commitQueue.splice(0, commitQueue.length);
    for (const fn of queue) {
      try {
        fn();
      } catch (err) {
        options.onError(err, '');
      }
    }
  }
}

function patchRoot(container: Element | DocumentFragment, vnode: Child, parent: Instance | null) {
  withPatchState(container, () => {
    patchInner(container, () => {
      current.instance = parent;
      pushOwner(container);
      renderChild(vnode);
      popOwner(true);
    });
  });
}

/**
 * Renders `vnode` into `container`, patching whatever a previous render left
 * there. Pass `null` to unmount.
 */
export function render(vnode: Child, container: Element | DocumentFragment): void {
  renderInto(container, vnode, null);
}

/**
 * @internal Renders into a container while keeping `parent` as the logical
 * parent instance, so context flows into portals and overlays.
 */
export function renderInto(container: Element | DocumentFragment, vnode: Child, parent: Instance | null): void {
  const root = container as RootContainer;
  root.__kbVNode = vnode;
  root.__kbParent = parent;
  current.pass++;
  patchRoot(container, vnode, parent);
  flushCommit();
}

/** Removes everything rendered into `container` and unmounts its components. */
export function unmount(container: Element | DocumentFragment): void {
  render(null, container);
}

function patchInstance(inst: Instance) {
  const el = inst.el as Element;
  withPatchState(inst.root, () => {
    patchOuter(el, () => {
      current.instance = inst.parent;
      // Partial pass: the owner is only used for lookups of the instance's
      // direct children, so it is pushed without finalising its other slots.
      ownerStack.push(inst.owner);
      visitStack.push(++visitCounter);
      renderInstance(inst, inst.component.props as Record<string, unknown>, false);
      ownerStack.pop();
      visitStack.pop();
    });
  });
}

function rerenderInstances(batch: Instance[]) {
  current.pass++;
  const pass = current.pass;
  const roots = new Set<Element | DocumentFragment>();
  for (const inst of batch) {
    if (inst.unmounted || inst.lastPass === pass) continue;
    // Find the closest instance (self or ancestor) that owns exactly one
    // element it can be re-patched through. Components rendering fragments
    // re-render through their parent.
    let target: Instance | null = inst;
    while (target && !(target.el && target.rootCount === 1 && target.el.parentNode)) {
      target = target.parent;
      if (target) target.forced = true;
    }
    if (target) {
      if (target.lastPass !== pass) patchInstance(target);
    } else {
      roots.add(inst.root);
    }
  }
  for (const root of roots) {
    const r = root as RootContainer;
    if ('__kbVNode' in r) patchRoot(root, r.__kbVNode as Child, r.__kbParent || null);
  }
  flushCommit();
}

setRerenderer(rerenderInstances);

/** @internal Registers a tag whose children are owned by a custom element. */
export function registerCustomElementTag(tag: string): void {
  customElementTags.add(tag.toLowerCase());
}

/** Returns the component instance whose root element is `el` (debug helper). */
export function getInstance(el: Element): Component<any, any> | null {
  const inst = (el as KbElement).__kbInstance;
  return inst && !inst.unmounted ? inst.component : null;
}
