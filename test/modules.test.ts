import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, combineReducers, applyMiddleware, thunk, createSlice, createSelector } from '../src/state/store';
import { signal, computed, effect, batch } from '../src/core/signal';
import { scoreCandidate, FocusManager } from '../src/focus/focus-manager';
import { normalizeKey } from '../src/focus/keys';
import { parseVtt, parseCueText, activeCues, parseTimestamp } from '../src/player/captions/vtt';
import { parseMpd, parseDuration, fillTemplate } from '../src/player/engines/dash/mpd';
import { BandwidthEstimator, chooseLevel } from '../src/player/engines/dash/abr';
import { parseSidx } from '../src/player/engines/dash/boxes';
import { formatTime } from '../src/player/ui/context';

// ---- state ----------------------------------------------------------------

test('store: slices, combineReducers, thunk and selectors', async () => {
  const counter = createSlice({
    name: 'counter',
    initialState: { n: 0 },
    reducers: {
      add: (s: { n: number }, a: { payload: number }) => ({ n: s.n + a.payload }),
    },
  });
  const store = createStore(combineReducers({ counter: counter.reducer }), undefined, applyMiddleware(thunk()));
  let calls = 0;
  store.subscribe(() => calls++);
  store.dispatch(counter.actions.add(2));
  await store.dispatch(((dispatch: any) => Promise.resolve().then(() => dispatch(counter.actions.add(3)))) as any);
  assert.equal(store.getState().counter.n, 5);
  assert.equal(calls, 2);

  let runs = 0;
  const doubled = createSelector([(s: any) => s.counter.n], (n: number) => (runs++, n * 2));
  assert.equal(doubled(store.getState()), 10);
  assert.equal(doubled(store.getState()), 10);
  assert.equal(runs, 1);
});

test('signals: computed, effect and batch', () => {
  const a = signal(1);
  const b = signal(2);
  const sum = computed(() => a.value + b.value);
  const seen: number[] = [];
  const stop = effect(() => {
    seen.push(sum.value);
  });
  batch(() => {
    a.value = 10;
    b.value = 20;
  });
  assert.deepEqual(seen, [3, 30]);
  stop();
  a.value = 0;
  assert.deepEqual(seen, [3, 30]);
});

// ---- focus ----------------------------------------------------------------

test('focus scoring prefers aligned, nearer candidates', () => {
  const from = { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 };
  const aligned = { left: 120, top: 0, right: 220, bottom: 50, width: 100, height: 50 };
  const far = { left: 400, top: 0, right: 500, bottom: 50, width: 100, height: 50 };
  const diagonal = { left: 120, top: 200, right: 220, bottom: 250, width: 100, height: 50 };
  const behind = { left: -200, top: 0, right: -100, bottom: 50, width: 100, height: 50 };
  const s = (to: typeof from) => scoreCandidate(from as any, to as any, 'right');
  assert.ok(s(aligned) < s(far));
  assert.ok(s(aligned) < s(diagonal));
  assert.equal(s(behind), Infinity);
});

test('focus manager: key handlers by priority, then back handlers', () => {
  const fm = new FocusManager({ autoFocusFirst: false, pointer: false }).start(document.body);
  const order: string[] = [];
  const offLow = fm.onKey((k) => (order.push('low:' + k), false), 0);
  const offHigh = fm.onKey((k) => (order.push('high:' + k), k === 'enter'), 10);
  const offBack = fm.onBack(() => (order.push('back'), true));
  const press = (key: string, keyCode: number) => window.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true } as any));
  press('Enter', 13);
  press('Escape', 27);
  assert.deepEqual(order.slice(0, 1), ['high:enter']);
  assert.ok(order.includes('back'));
  offLow();
  offHigh();
  offBack();
  fm.stop();
});

test('keys: TV keycodes map to logical keys', () => {
  const k = (key: string, keyCode: number) => normalizeKey({ key, keyCode, target: null } as any);
  assert.equal(k('ArrowLeft', 37), 'left');
  assert.equal(k('Enter', 13), 'enter');
  assert.equal(k('', 461), 'back'); // webOS / LG back
  assert.equal(k('MediaPlayPause', 179), 'playPause');
});

// ---- captions -------------------------------------------------------------

const VTT = `WEBVTT

NOTE a comment

1
00:00:01.000 --> 00:00:03.500 align:start
Hello <b>world</b>

00:04.000 --> 00:06.000
<c.yellow>Second</c>
line
`;

test('vtt: cues, settings, markup and lookup', () => {
  const cues = parseVtt(VTT);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].id, '1');
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 3.5);
  assert.equal(cues[0].settings.align, 'start');
  assert.equal(cues[1].text, '<c.yellow>Second</c>\nline');
  assert.equal(activeCues(cues, 2).length, 1);
  assert.equal(activeCues(cues, 3.8).length, 0);
  assert.equal(parseTimestamp('01:02:03.250'), 3723.25);
  const nodes = parseCueText('a <i>b</i>');
  assert.equal(nodes.length, 2);
  assert.equal(nodes[1].tag, 'i');
});

// ---- DASH -----------------------------------------------------------------

const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4" codecs="avc1.64001f">
      <SegmentTemplate timescale="1000" initialization="v/$RepresentationID$/init.mp4" media="v/$RepresentationID$/$Number%03d$.m4s" startNumber="1">
        <SegmentTimeline><S t="0" d="4000" r="1"/><S d="2000"/></SegmentTimeline>
      </SegmentTemplate>
      <Representation id="360" bandwidth="800000" width="640" height="360"/>
      <Representation id="720" bandwidth="2500000" width="1280" height="720"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2" lang="tr">
      <SegmentTemplate timescale="48000" duration="192000" initialization="a/init.mp4" media="a/$Number$.m4s"/>
      <Representation id="a" bandwidth="128000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

test('mpd: durations, templates, timeline and duration-based segments', () => {
  assert.equal(parseDuration('PT1H2M3.5S'), 3723.5);
  assert.equal(fillTemplate('$RepresentationID$/$Number%05d$.m4s', { RepresentationID: 'v1', Number: 7 }), 'v1/00007.m4s');
  const m = parseMpd(MPD, 'https://cdn.example/x/manifest.mpd');
  assert.equal(m.type, 'static');
  assert.equal(m.duration, 10);
  assert.equal(m.video.length, 2);
  const v = m.video[1];
  assert.equal(v.height, 720);
  assert.equal(v.init!.url, 'https://cdn.example/x/v/720/init.mp4');
  assert.deepEqual(
    v.segments.map((s) => [s.start, s.end]),
    [
      [0, 4],
      [4, 8],
      [8, 10],
    ],
  );
  assert.equal(v.segments[2].url, 'https://cdn.example/x/v/720/003.m4s');
  const a = m.audio[0];
  assert.equal(a.lang, 'tr');
  assert.equal(a.segments.length, 3); // 4s segments over 10s
  assert.equal(a.segments[2].end, 10);
});

test('sidx: parses references into byte ranges', () => {
  // version 0 sidx: timescale 1000, ept 0, first_offset 0, 2 refs.
  const body = [
    0, 0, 0, 0, // version/flags
    0, 0, 0, 1, // reference_ID
    0, 0, 3, 232, // timescale 1000
    0, 0, 0, 0, // earliest_presentation_time
    0, 0, 0, 0, // first_offset
    0, 0, 0, 2, // reserved + reference_count
    0, 0, 3, 232, 0, 0, 7, 208, 0x90, 0, 0, 0, // ref1: size 1000, dur 2000
    0, 0, 1, 244, 0, 0, 3, 232, 0x90, 0, 0, 0, // ref2: size 500, dur 1000
  ];
  const size = 8 + body.length;
  const box = new Uint8Array([0, 0, 0, size, 0x73, 0x69, 0x64, 0x78, ...body]);
  const segs = parseSidx(box, 'v.mp4', 100, 0, 0);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].range, { start: 100 + size, end: 100 + size + 999 });
  assert.equal(segs[1].start, 2);
  assert.equal(segs[1].end, 3);
});

test('abr: estimator warm-up and level choice', () => {
  const est = new BandwidthEstimator(1_000_000);
  assert.equal(est.estimate(), 1_000_000);
  for (let i = 0; i < 4; i++) est.sample(1000, 625_000); // 5 Mbps
  assert.ok(Math.abs(est.estimate() - 5_000_000) < 1);
  const levels = [
    { bandwidth: 800_000, height: 360 },
    { bandwidth: 2_500_000, height: 720 },
    { bandwidth: 6_000_000, height: 1080 },
  ];
  assert.equal(chooseLevel(levels, 5_000_000, 20, 1), 1);
  assert.equal(chooseLevel(levels, 10_000_000, 20, 1), 2);
  assert.equal(chooseLevel(levels, 10_000_000, 4, 1), 1); // thin buffer: no up-switch
  assert.equal(chooseLevel(levels, 10_000_000, 20, 1, { maxHeight: 720 }), 1);
});

test('formatTime', () => {
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
});
