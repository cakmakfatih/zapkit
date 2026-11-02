import { tick } from './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render, flushSync, OnScreenKeyboard } from '../src/index';

function mount(props: Record<string, unknown>) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const calls: string[] = [];
  flushSync(() => render(h(OnScreenKeyboard, { value: '', onChange: (v: string) => calls.push(v), onSubmit: () => calls.push('<done>'), ...props } as any), root));
  return { root, calls };
}

const keys = (root: Element) => [...root.querySelectorAll('.kb-key')] as HTMLElement[];
const byText = (root: Element, text: string) => keys(root).find((k) => k.textContent!.trim() === text)!;
const byLabel = (root: Element, label: string) => keys(root).find((k) => k.getAttribute('aria-label') === label);
const shiftKey = (root: Element) => byLabel(root, 'Shift')!;
const mode = (root: Element) => shiftKey(root).textContent!.trim();
const click = async (el: HTMLElement) => {
  el.click();
  await tick();
};

test('keyboard: starts on Aa when empty, one capital letter, then back to lower case', async () => {
  const { root, calls } = mount({});
  assert.equal(mode(root), 'Aa');
  await click(byText(root, 'A'));
  assert.deepEqual(calls, ['A']);
  assert.equal(mode(root), 'abc');
  await click(byText(root, 'b'));
  assert.deepEqual(calls, ['A', 'b']);
});

test('keyboard: shift cycles abc → Aa → AA → abc and caps lock stays on', async () => {
  const { root, calls } = mount({ initialShift: false });
  assert.equal(mode(root), 'abc');
  await click(shiftKey(root));
  assert.equal(mode(root), 'Aa');
  await click(shiftKey(root));
  assert.equal(mode(root), 'AA');
  await click(byText(root, 'X'));
  await click(byText(root, 'Y'));
  assert.deepEqual(calls, ['X', 'Y']);
  assert.equal(mode(root), 'AA');
  await click(shiftKey(root));
  assert.equal(mode(root), 'abc');
});

test('keyboard: digits and symbols do not use up the shift, only letters do', async () => {
  const { root } = mount({});
  await click(byText(root, '7'));
  assert.equal(mode(root), 'Aa');
  await click(byText(root, '@'));
  assert.equal(mode(root), 'Aa');
});

test('keyboard: a non-empty value starts in lower case; locale pairs I/ı', async () => {
  const { root, calls } = mount({ value: 'x', locale: 'tr-TR' });
  assert.equal(mode(root), 'abc');
  await click(byText(root, 'ı'));
  assert.deepEqual(calls, ['xı']);
});

test('keyboard: action keys the host leaves out are not rendered; reveal appears when given', async () => {
  const a = mount({ buttons: { clear: false, shift: false } });
  assert.equal(byLabel(a.root, 'Clear'), undefined);
  assert.equal(byLabel(a.root, 'Shift'), undefined);
  assert.ok(byLabel(a.root, 'Delete') && byLabel(a.root, 'Done'));
  assert.equal(byLabel(a.root, 'Show'), undefined);

  let toggled = 0;
  const b = mount({ reveal: { shown: false, onToggle: () => toggled++ } });
  await click(byLabel(b.root, 'Show')!);
  assert.equal(toggled, 1);
});

test('keyboard: delete, clear, space and done report to the host; strings and layout are replaceable', async () => {
  const { root, calls } = mount({ value: 'ab', layout: [['Q', 'W']], strings: { done: 'OK' } });
  await click(byLabel(root, 'Delete')!);
  await click(byLabel(root, 'Clear')!);
  await click(byLabel(root, 'Space')!);
  await click(byLabel(root, 'OK')!);
  assert.deepEqual(calls, ['a', '', 'ab ', '<done>']);
  assert.equal(keys(root).filter((k) => /^[qw]$/i.test(k.textContent!.trim())).length, 2);
});
