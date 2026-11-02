import { tick } from './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Component,
  Fragment,
  createContext,
  flushSync,
  h,
  memo,
  render,
  signal,
  useContext,
  useEffect,
  useState,
  type Child,
} from '../src/index';

function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('renders host elements, attributes, classes and styles', () => {
  const root = container();
  render(h('div', { className: ['a', { b: true, c: false }], style: { width: 10, opacity: 0.5 }, id: 'x' }, 'hi'), root);
  const el = root.firstElementChild as HTMLElement;
  assert.equal(el.className, 'a b');
  assert.equal(el.style.width, '10px');
  assert.equal(el.style.opacity, '0.5');
  assert.equal(el.id, 'x');
  assert.equal(el.textContent, 'hi');
  render(h('div', { className: 'z' }, 'bye'), root);
  assert.equal(root.firstElementChild, el, 'element is patched in place');
  assert.equal(el.className, 'z');
  assert.equal(el.getAttribute('style'), null);
  assert.equal(el.id, '');
});

test('keyed children keep identity when reordered', () => {
  const root = container();
  const list = (keys: string[]) => h('ul', null, keys.map((k) => h('li', { key: k }, k)));
  render(list(['a', 'b', 'c']), root);
  const [a, b, c] = Array.from(root.querySelectorAll('li'));
  render(list(['c', 'a', 'b']), root);
  const after = Array.from(root.querySelectorAll('li'));
  assert.deepEqual(after.map((x) => x.textContent), ['c', 'a', 'b']);
  assert.equal(after[0], c);
  assert.equal(after[1], a);
  assert.equal(after[2], b);
});

test('events are delegated through a stable proxy', () => {
  const root = container();
  let hits = '';
  render(h('button', { onClick: () => (hits += '1') }), root);
  const btn = root.querySelector('button')!;
  btn.click();
  render(h('button', { onClick: () => (hits += '2') }), root);
  btn.click();
  render(h('button', {}), root);
  btn.click();
  assert.equal(hits, '12');
});

test('class component lifecycle and setState batching', async () => {
  const root = container();
  const log: string[] = [];
  let inst!: Counter;
  class Counter extends Component<{ label: string }, { n: number }> {
    override state = { n: 0 };
    constructor(p: { label: string }) {
      super(p);
      inst = this;
    }
    override componentDidMount() {
      log.push('mount');
    }
    override componentDidUpdate(_pp: unknown, ps: { n: number }) {
      log.push('update ' + ps.n + '->' + this.state.n);
    }
    override componentWillUnmount() {
      log.push('unmount');
    }
    render() {
      return h('span', null, this.props.label + this.state.n);
    }
  }
  render(h(Counter, { label: 'n=' }), root);
  assert.equal(root.textContent, 'n=0');
  inst.setState({ n: 1 });
  inst.setState((s) => ({ n: s.n + 1 }));
  await tick();
  assert.equal(root.textContent, 'n=2');
  render(null, root);
  assert.deepEqual(log, ['mount', 'update 0->2', 'unmount']);
});

test('function components with hooks re-render only themselves', async () => {
  const root = container();
  let parentRenders = 0;
  let set!: (n: number) => void;
  const effects: string[] = [];
  function Child() {
    const [n, setN] = useState(0);
    set = setN;
    useEffect(() => {
      effects.push('effect ' + n);
      return () => effects.push('cleanup ' + n);
    }, [n]);
    return h('b', null, String(n));
  }
  function Parent() {
    parentRenders++;
    return h('div', null, h(Child, null), h('i', null, 'static'));
  }
  render(h(Parent, null), root);
  set(5);
  await tick();
  assert.equal(root.querySelector('b')!.textContent, '5');
  assert.equal(parentRenders, 1);
  assert.deepEqual(effects, ['effect 0', 'cleanup 0', 'effect 5']);
});

test('fragment-returning component re-renders through its parent', async () => {
  const root = container();
  let set!: (n: number) => void;
  function Frag() {
    const [n, setN] = useState(1);
    set = setN;
    return h(Fragment, null, Array.from({ length: n }, (_, i) => h('span', { key: i }, String(i))));
  }
  render(h('div', null, h('p', null, 'before'), h(Frag, null), h('p', null, 'after')), root);
  assert.equal(root.textContent, 'before0after');
  set(3);
  await tick();
  assert.equal(root.textContent, 'before012after');
  set(0);
  await tick();
  assert.equal(root.textContent, 'beforeafter');
});

test('context reaches consumers past memoized parents', async () => {
  const root = container();
  const Theme = createContext('light');
  const Reader = () => h('em', null, useContext(Theme));
  const Static = memo(() => h('section', null, h(Reader, null)));
  let setTheme!: (t: string) => void;
  function App() {
    const [t, setT] = useState('light');
    setTheme = setT;
    return h(Theme.Provider, { value: t }, h(Static, null));
  }
  render(h(App, null), root);
  assert.equal(root.textContent, 'light');
  setTheme('dark');
  await tick();
  assert.equal(root.textContent, 'dark');
});

test('signal text nodes update without re-rendering', () => {
  const root = container();
  const time = signal('0:00');
  let renders = 0;
  function Clock() {
    renders++;
    return h('span', null, 'Time ', time);
  }
  render(h(Clock, null), root);
  time.value = '0:01';
  assert.equal(root.textContent, 'Time 0:01');
  assert.equal(renders, 1);
});

test('unmounting removes components inside deleted elements', () => {
  const root = container();
  const log: string[] = [];
  class Leaf extends Component<{ id: string }> {
    override componentWillUnmount() {
      log.push('bye ' + this.props.id);
    }
    render() {
      return h('i', null, this.props.id);
    }
  }
  const view = (ids: string[]) => h('div', null, ids.map((id) => h('p', { key: id }, h(Leaf, { id }))));
  render(view(['a', 'b', 'c']), root);
  render(view(['a', 'c']), root);
  assert.deepEqual(log, ['bye b']);
});

test('error boundaries catch render errors', () => {
  const root = container();
  class Boundary extends Component<{ children?: Child }, { error: string | null }> {
    override state = { error: null as string | null };
    static getDerivedStateFromError(e: Error) {
      return { error: e.message };
    }
    render() {
      return this.state.error ? h('p', null, 'caught ' + this.state.error) : h('div', null, this.props.children);
    }
  }
  const Boom = () => {
    throw new Error('boom');
  };
  flushSync(() => render(h(Boundary, null, h('span', null, h(Boom, null))), root));
  assert.equal(root.textContent, 'caught boom');
});

test('refs and dangerouslySetInnerHTML', () => {
  const root = container();
  const ref = { current: null as Element | null };
  render(h('div', { ref, dangerouslySetInnerHTML: { __html: '<b>x</b>' } }), root);
  assert.equal(ref.current, root.firstElementChild);
  assert.equal(root.querySelector('b')!.textContent, 'x');
  render(null, root);
  assert.equal(ref.current, null);
});
