import { tick } from './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, render, flushSync } from '../src/index';
import { Player, VideoPlayer } from '../src/player/index';

// A button the app leaves out is not rendered at all (not merely hidden).
function mount(props: Record<string, unknown>) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const player = new Player({ persistPrefs: false });
  flushSync(() => render(h(VideoPlayer, { player, ...props } as any), root));
  return { root, player };
}

const has = (root: Element, focusId: string) => !!root.querySelector(`[data-focus-id="${focusId}"]`);

test('VideoPlayer: built-in buttons are present by default', async () => {
  const { root, player } = mount({});
  await tick();
  assert.ok(has(root, 'kb-player-play'));
  assert.ok(has(root, 'kb-player-settings'));
  assert.ok(root.querySelector('.kb-stats') === null);
  player.destroy();
});

test('VideoPlayer: controls={{ settings: false, seek: false }} leaves those buttons out of the DOM', async () => {
  const { root, player } = mount({ controls: { settings: false, seek: false, stats: false } });
  await tick();
  assert.ok(has(root, 'kb-player-play'));
  assert.equal(has(root, 'kb-player-settings'), false);
  assert.equal(root.querySelectorAll('.kb-transport .kb-button').length, 1, 'only play/pause remains');
  player.destroy();
});

test('VideoPlayer: transportStart/transportEnd/extraControls render what the app passes', async () => {
  const { root, player } = mount({
    transportStart: h('button', { id: 'start' }, 'a'),
    transportEnd: h('button', { id: 'end' }, 'b'),
    extraControls: h('button', { id: 'extra' }, 'c'),
  });
  await tick();
  assert.ok(root.querySelector('#start') && root.querySelector('#end') && root.querySelector('#extra'));
  player.destroy();
});

test('VideoPlayer: strings override the visible labels', async () => {
  const { root, player } = mount({ strings: { settings: 'Ajustes' } });
  await tick();
  assert.equal(root.querySelector('[data-focus-id="kb-player-settings"]')?.getAttribute('aria-label'), 'Ajustes');
  player.destroy();
});

test('VideoPlayer: previous/next appear for a playlist and controls={{ previous: false, next: false }} leaves them out', async () => {
  const items = [1, 2, 3].map((n) => ({ id: 'v' + n, url: 'https://example.com/' + n + '.mp4', title: 'Video ' + n }));
  const labels = (root: Element) => [...root.querySelectorAll('.kb-transport .kb-button')].map((b) => b.getAttribute('aria-label'));

  const a = mount({});
  await a.player.loadPlaylist(items, 1);
  flushSync(() => {});
  await tick();
  assert.ok(labels(a.root).includes('Previous') && labels(a.root).includes('Next'));
  a.player.destroy();

  const b = mount({ controls: { previous: false, next: false } });
  await b.player.loadPlaylist(items, 1);
  await tick();
  assert.equal(labels(b.root).includes('Previous'), false);
  assert.equal(labels(b.root).includes('Next'), false);
  b.player.destroy();
});

test('VideoPlayer: a WebVTT subtitle track adds the subtitles button; without tracks there is none', async () => {
  const labels = (root: Element) => [...root.querySelectorAll('.kb-transport .kb-button')].map((b) => b.getAttribute('aria-label'));

  const none = mount({});
  await none.player.load({ url: 'https://example.com/a.mp4', title: 'No subtitles' });
  await tick();
  assert.equal(labels(none.root).includes('Subtitles'), false);
  none.player.destroy();

  const withTrack = mount({});
  await withTrack.player.load({
    url: 'https://example.com/b.mp4',
    title: 'With subtitles',
    captions: [{ url: 'https://example.com/b.en.vtt', lang: 'en', label: 'English' }],
  });
  await tick();
  assert.equal(withTrack.player.captionTracks.peek().length, 1);
  assert.ok(labels(withTrack.root).includes('Subtitles'), 'the subtitles button appears');
  withTrack.player.destroy();
});
