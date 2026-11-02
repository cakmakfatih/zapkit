import './setup';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { exitApp } from '../src/focus/keys';
import { FocusManager } from '../src/focus/focus-manager';
import { createRouter } from '../src/router/router';

const g = globalThis as Record<string, unknown>;
const PLATFORM_GLOBALS = ['PalmSystem', 'Hisense_ExitApp', 'tizen', 'webapis', 'close'];

afterEach(() => {
  for (const k of PLATFORM_GLOBALS) delete g[k];
});

test('exitApp: webOS PalmSystem.platformBack wins and stops the search', () => {
  const calls: string[] = [];
  g.PalmSystem = { platformBack: () => calls.push('palm') };
  g.close = () => calls.push('close');
  exitApp();
  assert.deepEqual(calls, ['palm']);
});

test('exitApp: Tizen exits through the application API', () => {
  const calls: string[] = [];
  g.tizen = { application: { getCurrentApplication: () => ({ exit: () => calls.push('tizen') }) } };
  g.close = () => calls.push('close');
  exitApp();
  assert.deepEqual(calls, ['tizen']);
});

test('exitApp: Hisense/VIDAA hook is used when present', () => {
  const calls: string[] = [];
  g.Hisense_ExitApp = () => calls.push('hisense');
  exitApp();
  assert.deepEqual(calls, ['hisense']);
});

test('exitApp: a platform that throws falls through to the next one', () => {
  const calls: string[] = [];
  g.PalmSystem = { platformBack: () => { throw new Error('boom'); } };
  g.close = () => calls.push('close');
  exitApp();
  assert.deepEqual(calls, ['close']);
});

test('exitApp: plain browser ends with window.close and never throws without it', () => {
  const calls: string[] = [];
  g.close = () => calls.push('close');
  exitApp();
  assert.deepEqual(calls, ['close']);
  delete g.close;
  assert.doesNotThrow(() => exitApp());
});

test('router: Back on the first screen leaves the app by default', () => {
  const calls: string[] = [];
  g.PalmSystem = { platformBack: () => calls.push('palm') };
  const fm = new FocusManager({ autoFocusFirst: false, pointer: false }).start(document.body);
  const router = createRouter({ routes: [{ path: '/', component: () => null as never }, { path: '/b', component: () => null as never }], focus: fm });
  router.attach();
  router.navigate('/b');
  assert.equal(fm.dispatchKey('back'), true);
  assert.deepEqual(calls, [], 'Back on a later screen just goes back');
  assert.equal(router.current?.path, '/');
  assert.equal(fm.dispatchKey('back'), true);
  assert.deepEqual(calls, ['palm'], 'Back on the first screen exits');
  router.detach();
  fm.stop();
});

test('router: a custom onExit still takes precedence', () => {
  const calls: string[] = [];
  g.PalmSystem = { platformBack: () => calls.push('palm') };
  const fm = new FocusManager({ autoFocusFirst: false, pointer: false }).start(document.body);
  const router = createRouter({ routes: [{ path: '/', component: () => null as never }], focus: fm, onExit: () => { calls.push('custom'); return true; } });
  router.attach();
  fm.dispatchKey('back');
  assert.deepEqual(calls, ['custom']);
  router.detach();
  fm.stop();
});
