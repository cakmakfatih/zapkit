# zapkit-tv Guide

> A React-like, standalone web UI library for TV devices. It covers D-pad
> navigation, state management, a router, TV UI building blocks and **a complete
> video player** (HLS / DASH / progressive, ABR, DRM, subtitles, playlists).

Contents

1. [What it is and how it was made](#1-what-it-is-and-how-it-was-made)
3. [Architecture](#3-architecture)
4. [Installation and first app](#4-installation-and-first-app)
5. [Core: components, hooks, signals](#5-core-components-hooks-signals)
6. [Focus and remote keys](#6-focus-and-remote-keys)
7. [State management (store)](#7-state-management-store)
8. [Router](#8-router)
9. [UI building blocks](#9-ui-building-blocks)
10. [Player](#10-player)
11. [Theme and CSS](#11-theme-and-css)
12. [Development commands](#12-development-commands)
14. [Limits and known gaps](#14-limits-and-known-gaps)

---

## 1. What it is and how it was made

zapkit-tv is a small, standalone UI library for TV web apps (Tizen, webOS, VIDAA, Android TV and
desktop browsers) with a complete video player. It was inspired by the approach of YouTube's TV
app: render with Google's open-source incremental-dom, put a thin component layer on top, and
make remote-control (D-pad) navigation and a rich player first-class. Everything here is original
code written for this library; no YouTube code was copied, and there is no stream-signature
handling, ad handling or DRM circumvention. The player is built purely on standard web APIs
(HTMLMediaElement, Media Source Extensions, EME).

---

## 3. Architecture

```
                  ┌──────────────────────────────────────────────┐
  Application     │  Screens (JSX components)                    │
                  └──────────────────────────────────────────────┘
                     │ h()/JSX          │ useSelector      │ <VideoPlayer>
  zapkit-tv  ┌──────▼──────┐   ┌───────▼──────┐   ┌───────▼─────────────┐
              │ core        │   │ state        │   │ player              │
              │ vnode, hook │   │ store, slice │   │ Player (signals)    │
              │ component   │   │ selector     │   │ engines: native,    │
              │ signal, ctx │   └──────────────┘   │   hls.js, DASH(MSE) │
              │ renderer ───┼──► incremental-dom   │ ui: OSD, settings,  │
              └──────┬──────┘                      │   error panel       │
              ┌──────▼──────┐   ┌──────────────┐   └─────────────────────┘
              │ focus       │   │ router       │   ┌─────────────────────┐
              │ FocusManager│◄──┤ stack, back  │   │ ui: VirtualList,    │
              │ keys        │   │ focus restore│   │ Button, overlay,    │
              └─────────────┘   └──────────────┘   │ toast, scaling      │
                                                   └─────────────────────┘
```

Directory layout:

| Path | Content |
|---|---|
| `src/core` | `h`/JSX, VNode, Component, hooks, signals, context, portal, renderer, custom elements |
| `src/focus` | FocusManager (spatial navigation), key normalisation, FocusGroup |
| `src/state` | Redux-like store, slices, thunks, selectors, component bindings |
| `src/router` | Stack-based router, back key, focus restoration |
| `src/ui` | Scaling, VirtualList, Button/Image/Marquee/Spinner/Icon, overlays and toasts |
| `src/player` | Player, engines, subtitles, storyboards, player UI |
| `styles/zapkit-tv.css` | Base theme (CSS variables) |
| `examples/demo` | A working demo (Vite) |
| `test` | jsdom + node:test tests |

---

## 4. Installation and first app

There are two ways in local projects:

**a) From source (recommended, fastest development):** use `src` directly through a Vite alias.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'zapkit-tv/player': resolve(__dirname, '../zapkit-tv/src/player/index.ts'),
      'zapkit-tv/styles.css': resolve(__dirname, '../zapkit-tv/styles/zapkit-tv.css'),
      'zapkit-tv': resolve(__dirname, '../zapkit-tv/src/index.ts'),
    },
  },
  optimizeDeps: { include: ['incremental-dom'] },
  esbuild: { jsxFactory: 'h', jsxFragment: 'Fragment' },
});
```

**b) Built package:** run `npm run build` in `zapkit-tv`, then add
`"zapkit-tv": "file:../zapkit-tv"` to your project.

TypeScript settings (classic JSX):

```json
{ "compilerOptions": { "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" } }
```

First app:

```tsx
import { h, render, focus, installScaling, registerPlatformKeys, Button, useState } from 'zapkit-tv';
import 'zapkit-tv/styles.css';

function Counter() {
  const [n, setN] = useState(0);
  return (
    <div focusGroup={{ orientation: 'horizontal' }}>
      <Button label="-" onClick={() => setN(n - 1)} />
      <span style={{ fontSize: '3rem', margin: '0 2rem' }}>{n}</span>
      <Button label="+" autoFocus onClick={() => setN(n + 1)} />
    </div>
  );
}

installScaling();          // 1920×1080 design canvas, the same look at every resolution
registerPlatformKeys();    // registers media/colour keys on Tizen
render(<Counter />, document.getElementById('app')!);
focus.start(document.body); // start listening to the remote
```

---

## 5. Core: components, hooks, signals

### Elements and prop mapping

`h(type, props, ...children)` or JSX. On host elements:

| Prop | Meaning |
|---|---|
| `className` | string, array or `{ className: boolean }` object (can be nested) |
| `style` | string or object (`width: 10` → `10px`, `--variable` is supported) |
| `onClick`, `onKeyDown`… | `on` + event name; events are attached through a fixed proxy |
| `onKbkey` | The logical key delivered to the focused element (`CustomEvent<KbKeyDetail>`); `preventDefault()` consumes the key |
| `onKbFocus` / `onKbBlur` | Focus arrived / left |
| `focusable` | Make the element focusable with the remote |
| `focusId` | Stable identity (`focus.focusById`, router focus restoration) |
| `focusGroup` | Navigation scope: `{ orientation, wrap, trap, memory, enterTo }` |
| `autoFocus` | Focus it when rendered |
| `disableFocus` | No focus in this subtree (hidden menus) |
| `skip` | Do not touch the children (video element, third-party DOM) |
| `ref` | A `useRef()` object or a function |
| `key` | Identity in lists |
| `dangerouslySetInnerHTML` | `{ __html }` |

### Components

```tsx
// Function component
function Hello({ name }: { name: string }) { return <div>Hello {name}</div>; }

// Class component
class Clock extends Component<{}, { now: number }> {
  state = { now: Date.now() };
  timer = 0;
  componentDidMount() { this.timer = setInterval(() => this.setState({ now: Date.now() }), 1000); }
  componentWillUnmount() { clearInterval(this.timer); }
  render() { return <span>{new Date(this.state.now).toLocaleTimeString()}</span>; }
}
```

- `PureComponent` / `memo(fn, areEqual?)`: avoid needless renders with a shallow comparison.
- `Fragment` (`<>...</>`), `createPortal(children, container)` / `<Portal>`.
- **Error boundary:** a class component that defines `componentDidCatch(error, info)` catches render errors in its subtree.
- `defineElement('my-card', Card, { observedAttributes: ['title'] })`: registers the component as a web component (usable as a plain HTML tag).

### Hooks

`useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`,
`useRef`, `useContext`, `useSubscription(subscribe, getValue)`, `useSignalValue(signal)`,
`useForceUpdate`. Updates are batched into the next frame; `flushSync(fn)` applies
them immediately.

### Signals

Fine-grained reactive values. The player publishes all of its state as signals.

```ts
const count = signal(0);
const double = computed(() => count.value * 2);
effect(() => console.log(double.value));
batch(() => { count.value = 1; count.value = 2; }); // a single trigger
```

If you put a signal directly into JSX, only that text node is updated (the component is not re-rendered).

### Context

```tsx
const Theme = createContext('dark');
<Theme.Provider value="light"><Child /></Theme.Provider>
const theme = useContext(Theme);
```

---

## 6. Focus and remote keys

`focus` (the default `FocusManager` instance) handles all remote input.

### Key handling order

1. **Global** handlers added with `focus.onKey(handler, priority)` (highest priority first). Returning `true` consumes the key.
2. A `kbkey` event on the focused element (`onKbkey`), bubbling up the DOM.
3. Direction keys → spatial navigation (groups are respected).
4. `enter` → `click()` on the focused element.
5. `back` → handlers added with `focus.onBack(handler)` (last added first); if none consumes it, the router goes back.

### Navigation groups

```tsx
<div focusGroup={{ orientation: 'horizontal', wrap: true }}>…</div>   // horizontal row
<div focusGroup={{ orientation: 'vertical', trap: true }}>…</div>     // a menu you cannot leave
<div focusGroup={{ enterTo: 'first', memory: false }}>…</div>        // the first element on every entry
```

- `orientation`: `'horizontal' | 'vertical' | 'grid'`; directions the group does not handle pass to the parent group.
- `trap`: `true` or an array of blocked directions (`['left','right']`).
- `wrap`: past an edge the focus continues on the opposite side, in every direction the group handles.
- `memory` (default `true`): the child that was focused last when you return to the group.
- `enterTo`: `'nearest'` (default), `'first'` or a `focusId`.

Candidate selection is geometric (`scoreCandidate`): the aligned and nearer one wins, and candidates in the opposite direction are discarded.

### Useful API

| API | Description |
|---|---|
| `focus.start(root)` / `stop()` | Start/stop listening |
| `focus.focus(el)` / `focusById(id)` / `focusFirst(scope)` | Programmatic focus |
| `focus.current` | The focused element |
| `focus.move('down')` | Move in a direction |
| `focus.subscribe(fn)` | Listen to focus changes |
| `focus.lockFocus(reason, ms)` / `lockInput(reason, ms)` | Lock focus/input during animations etc. (with a timeout) |
| `useKeyHandler(fn, priority)` | A global key handler for as long as the component lives |
| `useFocusWithin(ref)` | Whether the subtree holds focus |
| `useFocusLock(reason, active)` | A focus lock for the lifetime of the component |

### Logical keys

`normalizeKey(e)` turns browser/TV events into these names:
`up down left right enter back exit home menu info search play pause playPause stop
fastForward rewind next previous channelUp channelDown volumeUp volumeDown mute
subtitle audioTrack red green yellow blue 0-9`.

Some of the platform codes recognised: webOS back **461**, Tizen back **10009**,
VIDAA/Hisense back **8 / 27**, media keys **415/19/413/417/412**, colour keys
**403-406**. For a missing code use `registerKeyCodes({ 1234: 'back' })` or
`registerKeyNames({ XF86Foo: 'menu' })`. On Tizen, `registerPlatformKeys()` must be
called for the media keys.

---

## 7. State management (store)

The same model as Redux; no extra library is needed.

```ts
const auth = createSlice({
  name: 'auth',
  initialState: { user: null as string | null },
  reducers: {
    login: (s, a: { payload: string }) => ({ ...s, user: a.payload }),
    logout: (s) => ({ ...s, user: null }),
  },
});
const store = createStore(combineReducers({ auth: auth.reducer }), undefined, applyMiddleware(thunk()));
store.dispatch(auth.actions.login('demo'));
```

In components:

```tsx
<StoreProvider store={store}><App /></StoreProvider>
const user = useSelector((s: RootState) => s.auth.user);
const dispatch = useDispatch();
```

There is also `createSelector` (memoised), `shallow` (shallow equality), `connect` (for class components) and a `logger` middleware.

---

## 8. Router

Stack-based, built for TV apps: going forward pushes a screen onto the stack, the
back key returns to the previous screen and **focus is restored to the element you
left**.

```tsx
const router = createRouter({
  routes: [
    { path: '/', component: Home, keepAlive: true },   // stays alive in the background
    { path: '/series/:id', component: SeriesDetail },
  ],
  onExit: () => { /* back on the first screen: leave the app */ },
  syncHash: false,
});

render(<RouterView router={router} />, root);
router.attach();                         // bind the back key

router.navigate('/series/42', { state: { from: 'home' } });
router.back(); router.backTo('/'); router.reset('/login');
```

A screen component receives `RouteProps`: `params`, `query`, `state`, `entry`, `router`.
The `useRouter()` / `useRoute()` hooks are available too.

---

## 9. UI building blocks

### Scaling

`installScaling({ width: 1920, height: 1080 })` sets the root font size from the screen.
Write all measurements in `rem` (1rem = 16 design pixels). `dp(24)` → `"1.5rem"`.

### VirtualList

Shows thousands of items by rendering only the visible ones, and keeps the focused item visible.

```tsx
<VirtualList
  items={channels}
  orientation="vertical"   // or 'horizontal'
  columns={5}              // grid
  itemSize={240} columnSize={320} gap={24}
  viewportSize={900}
  align="edge"             // 'edge' | 'center' | 'start'
  focusPrefix="ch"         // for focus restoration
  keyOf={(c) => c.id}
  renderItem={(c, i, { focused }) => <ChannelCard channel={c} active={focused} />}
  onFocusIndex={(i) => …}
  onSelect={(c, i) => open(c)}   // Enter or click on an item
  onEndReached={() => loadMore()}
/>
```

### Others

- `Button` (`label`, `icon`, `selected`, `disabled`), `IconButton`
- `Image` (loading/loaded/error states, `fallback`)
- `Marquee` (scrolls long text while focused), `Spinner`, `Icon`
- Icons: the built-in set is filled paths (`registerIcons({ name: 'M…' })`). Outline icon sets such as Lucide are registered as inner SVG markup with `registerStrokeIcons({ name: '<path d="…"/>' })` and drawn in `currentColor`.
- `openOverlay(close => <Dialog/>, { className: 'kb-overlay--sheet' })` + `<OverlayStage/>`: modal layers that close with the back key and keep focus inside
- `toast('Saved', { kind: 'success' })` + `<ToastStage/>`
- `animate(el, keyframes, opts)`, `fadeIn`, `fadeOut`

---

## 10. Player

The most important module. It has two layers:

- **The `Player` class** (no UI): loading sources, engine selection, states,
  playlists, subtitles, quality, live streams, statistics. All state is published
  as **signals**.
- **The `VideoPlayer` component**: a ready-made full-screen TV interface (OSD,
  progress bar, settings panel, error panel, remote shortcuts).

### Quick start

```tsx
import { Player, VideoPlayer, setHlsConstructor } from 'zapkit-tv/player';
import Hls from 'hls.js';                 // optional: for devices without native HLS
setHlsConstructor(Hls);

const player = new Player();
function Watch() {
  useEffect(() => {
    player.load({ url: 'https://…/master.m3u8', title: 'Movie', poster: '…' });
    player.play();
    return () => player.destroy();
  }, []);
  return <VideoPlayer player={player} onBack={() => router.back()} />;
}
```

### Engine selection

| Source | Engine chosen |
|---|---|
| `type` given | That type |
| `.mpd` | **DashEngine** (the built-in MSE engine) |
| `.m3u8` / `.m3u` | **NativeEngine** if the device supports HLS natively, otherwise **HlsJsEngine** (if hls.js was provided) |
| Anything else (`.mp4`, `.ts`, `.mkv`…) | **NativeEngine** |
| `PlayerOptions.engines` | Your factories are tried first |

If a source fails before playback starts, `source.fallbacks` are tried in order
(for example `.m3u8` → `.ts` for IPTV).

### VideoSource

```ts
{
  url, type?: 'auto'|'dash'|'hls'|'progressive', id?, title?, subtitle?, poster?,
  startTime?,                 // seconds, to resume where the viewer left off
  live?: boolean,             // an IPTV channel: treat as live before the engine can tell
  fallbacks?: [{ url, type? }],
  captions?: [{ url, lang, label?, kind? }],    // external WebVTT
  storyboard?: StoryboardSpec | 'thumbs.vtt',   // progress bar previews
  drm?: DrmConfig | DrmConfig[],
  headers?: Record<string,string>,              // DASH request headers
  upNextAt?: number,          // second at which `upNext` is published (credits start)
  metadata?: Record<string, unknown>,           // opaque to the player; handed back to your UI
}
```

The player knows nothing about movies, series or channels: it plays the sources it
is given and behaves according to their technical properties (for example
`live`). What a source *is* belongs to the app (see `metadata`).

### PlayerOptions

| Option | Default | Description |
|---|---|---|
| `video` | a new `<video>` | An existing video element |
| `engines` | `[]` | Custom engine factories |
| `dash` | – | `{ bufferGoal: 30, backBuffer: 30, liveDelay, defaultBandwidth, preferredAudioLanguage }` |
| `persistPrefs` | `true` | Volume, speed, subtitles and the quality cap are kept in `localStorage` |
| `pauseWhenHidden` | `true` | Pause when the page is hidden (Home key) |
| `autoAdvance` | `true` | Move on to the next item when a playlist item ends |
| `autoAdvanceDelay` | `10` | Countdown seconds |
| `upNextLead` | `20` | How many seconds before the end `upNext` appears when there is no `upNextAt` |
| `gapJumping` | `true` | Jump small gaps in the buffer and recover from stalls |
| `liveHeadTolerance` | `10` | Within this distance of the live edge counts as "live" |

### States and signals

`PlayerState`: `UNSTARTED -1`, `ENDED 0`, `PLAYING 1`, `PAUSED 2`, `BUFFERING 3`, `CUED 5`.

Readable signals (in a component use `useSignalValue(player.x)`):
`state, currentTime, duration, bufferedEnd, volume, muted, playbackRate, qualities,
quality, autoQuality, audioTracks, audioTrack, captionTracks, captionTrack,
captionSettings, cues, liveMode ('none'|'live'|'dvr'|'window'), seekable, error,
source, playlist, playlistIndex, upNext, squeezeback, engineName`.

### Methods

| Group | Methods |
|---|---|
| Loading | `load(source, startTime?)`, `cue(source)` (load without playing), `loadPlaylist(list, index, startTime?)` |
| Playback | `play()` (retries muted if autoplay is blocked), `pause()`, `togglePlay()`, `stop()` |
| Position | `seekTo(t)`, `seekBy(±s)`, `seekToLiveHead()`, `isAtLiveHead()` |
| Volume / speed | `setVolume(0..1)`, `mute()`, `unMute()`, `toggleMute()`, `setPlaybackRate(r)`, `getAvailablePlaybackRates()` |
| Quality | `setPlaybackQuality(id | 'auto')`, `setPlaybackQualityRange(minH, maxH)` |
| Audio track | `setAudioTrack(id)` |
| Subtitles | `setCaptionTrack(id | null)`, `setCaptionSettings({ fontScale, color, backgroundOpacity, edge… })` |
| Cue range | `addCueRange({ id, start, end })`, `removeCueRange(id)`, `clearCueRanges()`, `setLoopRange(range|null)` |
| Playlist | `playVideoAt(i)`, `nextVideo()`, `previousVideo()` (restarts the item if it played for more than 3 s), `hasNext()`, `hasPrevious()`, `setShuffle(b)`, `setLoop(b)` |
| Up next | `playUpNext()`, `dismissUpNext()` |
| Other | `getStoryboardFrame(t)`, `hasStoryboard()`, `getStatsForNerds()`, `setSqueezeback(rect|null)`, `getState()`, `on(event, fn)`, `destroy()` |

### Events

`player.on('onStateChange', s => …)`; the names follow the IFrame-style player API
player API:
`onReady, onStateChange, onError, onPlaybackQualityChange,
onAvailableQualityLevelsChange, onPlaybackRateChange, onVolumeChange,
onCaptionsTrackListChanged, onCaptionsChange, onAudioTracksChange,
onAudioTrackChange, onCueRangeEnter, onCueRangeExit, onLoadProgress,
onVideoProgress, onVideoDataChange, onSeek, onLiveMediaEnded, onPlaylistChange,
onSqueezebackChange, onEmsg`.

### Playlists and "up next"

```ts
player.loadPlaylist(
  episodes.map((e) => ({ id: e.id, url: e.url, title: e.title, subtitle: `S${e.season} E${e.num}`, poster: e.thumb })),
  startIndex,
);
```

- `upNextLead` seconds before the end of an item (or at `upNextAt`) the
  `player.upNext` signal is filled. When the item ends, an `autoAdvanceDelay`-second
  **countdown** starts (`info.countdown`); `player.playUpNext()` moves on at once and
  `player.dismissUpNext()` cancels.
- **The player draws no up-next card and no "go live" button:** those are the app's
  job. You build them with calls such as `player.upNext`, `playUpNext()` and
  `seekToLiveHead()` (an example is in the VideoPlayer section below). The
  **previous / next buttons** do exist: they appear in the control bar whenever a
  playlist has several items, and an app that does not want them leaves them out with
  `controls={{ previous: false, next: false }}`.
- With `onPlaylistChange` you can record which item you are on.

### Live streams

- `liveMode`: `live` (live edge only), `dvr` (a window you can rewind), `window`.
- `LiveBadge` is a plain LIVE indicator. For a "back to live" button, add your own
  and call `player.seekToLiveHead()` (use `player.isAtLiveHead()` to know when to show it).
- For DASH dynamic MPDs the manifest is refreshed periodically; when the stream
  becomes static `onLiveMediaEnded` fires.
- Passing `live: true` for IPTV channels puts the UI into live mode even before the engine can tell.

### The built-in DASH engine

- MPD: `SegmentTemplate` (timeline and duration based, formats such as `$Number%05d$`),
  `SegmentList`, `SegmentBase` (+ `sidx`), multi-period stitching, WebVTT subtitle
  AdaptationSets, `ContentProtection` (PSSH, default_KID).
- ABR: two exponential averages (fast 2 s, slow 5 s half-life), ignores small
  downloads, does not switch up on a low buffer, drops one level on a critical buffer.
- SourceBuffer queue: ordered append/remove, on `QuotaExceededError` it clears what is
  behind and retries, codec switches with `changeType`.
- `emsg` boxes arrive as `onEmsg` events.
- Error tolerance: retries with exponential back-off, a drop to a lower quality on a
  failed segment, 404 tolerance on live.

### DRM (EME)

```ts
player.load({
  url: 'https://…/manifest.mpd',
  drm: [
    { system: 'widevine', licenseUrl: 'https://lic/wv', headers: { Authorization: 'Bearer …' } },
    { system: 'playready', licenseUrl: 'https://lic/pr' },
  ],
});
// ClearKey: { system: 'clearkey', licenseUrl: '', clearKeys: { '<kid hex>': '<key hex>' } }
```

`transformRequest` / `transformResponse` handle licence envelopes, `certificateUrl`
sets the server certificate, and `videoRobustness` / `audioRobustness` are supported.

### hls.js

zapkit-tv does **not bundle** hls.js; the app that needs it provides it:

```ts
import Hls from 'hls.js';
setHlsConstructor(Hls, { maxBufferLength: 30 });   // the second parameter is the hls.js config
```

HlsJsEngine: quality levels, audio tracks, subtitles, live detection, 2 recoveries on
media errors and 3 retries on network errors.

### Custom engine

```ts
const myEngine: EngineFactory = (source, video) => source.url.startsWith('udp://') ? new MyEngine() : null;
new Player({ engines: [myEngine] });
```

The `Engine` interface: `load, destroy, setQuality, setQualityRange, setAudioTrack,
loadCaptionTrack?, isLive, seekableRange, liveEdge, onSeek?, stats`.

### VideoPlayer component

```tsx
<VideoPlayer
  player={player}
  onBack={() => router.back()}
  strings={{ play: 'Reproducir', pause: 'Pausa', … }}   // every visible word can be replaced
  controls={{ previous: false, next: false, stats: false }}   // leave built-in buttons out
  osdTimeout={4000}
  metadata={<ChannelLogo />}            // extra content under the title
  extraControls={<Button icon="list" onClick={openChannels} />}   // extra buttons in the right group
  transportStart={<MyButton />}                                   // left of the previous button
  transportEnd={<NextEpisodeButton player={player} />}            // right of the next button
>
  {/* layers drawn over the video (a channel list, an "up next" card…) */}
</VideoPlayer>
```

**Text.** Every word the player shows (button labels, the settings menu, subtitle
style names, colours, the stats overlay, the error panel) comes from `PlayerStrings`;
English is the default and `strings` takes a partial object to replace any of them.

**Buttons.** The app decides which built-in transport buttons it includes. `controls`
takes `previous`, `next`, `seek`, `captions`, `audio`, `stats` and `settings` (all `true` by default); a button
set to `false` is **not rendered at all**: it is not hidden with CSS, it is simply not in
the DOM. `showStats={false}` is the same as `controls={{ stats: false }}`. For full
control, compose your own bar from the exported parts (`TransportControls`,
`ProgressBar`, …).

**The default controls of the player:**

| Where | Button | Shown when |
|---|---|---|
| Left group | Previous (`previous`) | the playlist has several items; disabled on the first one |
| | Back 10 s (`seek`) | not on a pure live stream |
| | Play / pause | always |
| | Forward 10 s (`seek`) | not on a pure live stream |
| | Next (`next`) | the playlist has several items; disabled on the last one |
| Right group | Subtitles (`captions`) | the video has subtitle tracks |
| | Audio (`audio`) | there are several audio tracks |
| | Stats for nerds (`stats`) | always (until removed) |
| | Settings (`settings`) | always (until removed) |

Above them are the progress bar, the time (a LIVE indicator on live streams) and the
title/subtitle of the source. The names in brackets are the `controls` keys that leave
a button out. Anything specific to one app, such as a "next episode" button with its
own label, "go live", an "up next" card or the playlist position, is not in the SDK:
**the app** adds its own parts through `transportStart`, `transportEnd`, `extraControls`
and `children`:

```tsx
// e.g. a labelled "next episode" button (switch off the built-in one with controls={{ next: false }})
function NextEpisodeButton({ player }: { player: Player }) {
  useSignalValue(player.playlistIndex);
  return <Button icon="next" label="Next episode" disabled={!player.hasNext()} onClick={() => player.nextVideo()} />;
}

function UpNext({ player }: { player: Player }) {
  const info = useSignalValue(player.upNext);
  if (!info) return null;
  return (
    // data-kb-overlay: while focus is inside this box the player leaves the keys alone (D-pad/OK stay free)
    <div data-kb-overlay focusGroup={{ orientation: 'horizontal' }}>
      <div>{info.source.title} {info.countdown != null ? `· ${info.countdown} s` : ''}</div>
      <Button label="Play now" autoFocus onClick={() => player.playUpNext()} />
      <Button label="Cancel" onClick={() => player.dismissUpNext()} />
    </div>
  );
}
```

`<VideoPlayer ...><UpNext player={player} /></VideoPlayer>`: `children` are drawn over the video.
The card handles the back key itself (with `focus.onKey`).

Remote behaviour:

| While the OSD is hidden | |
|---|---|
| ◀ / ▶ | The progress bar opens and seeking starts (VOD) |
| OK | Play / pause (an icon appears in the middle) |
| ▲ / ▼ | Show the controls |
| Back | `onBack` |

| While the OSD is visible | |
|---|---|
| Direction keys | Navigate between the controls |
| ◀ / ▶ on the progress bar | Accelerating seek (the step grows while held), applied after 700 ms or with OK; storyboard preview |
| Back | Hide the OSD if playing, otherwise `onBack` |

| Media keys (always) | |
|---|---|
| Play/Pause, Play, Pause, Stop | The matching action |
| FF / RW | ±30 s (inactive on live) |
| Next / Prev, CH+ / CH- | Next / previous item in the playlist |
| Subtitle / Audio | The matching page of the settings panel |
| Info | Toggle the OSD |

The individual parts are exported too, so you can build your own layout:
`PlayerSurface, CaptionsLayer, ProgressBar, TransportControls, TimeCounter, LiveBadge,
MetadataSection, ToggleIndicator, BufferingIndicator, SettingsPanel, StatsOverlay,
ErrorPanel` and `usePlayerKeys(player, opts)`. They work under
`<PlayerContext.Provider value={player}>`.

### Subtitles

- External WebVTT (`source.captions`) or manifest subtitles (DASH/HLS/native).
- `parseVtt` supports cue settings (`align`, `line`, `position`) and the
  `<b> <i> <u> <c.class> <v>` markup.
- User settings (size, colour, background opacity, edge style) are persistent.

---

## 11. Theme and CSS

`styles/zapkit-tv.css` gives every component its base style. Theme it with CSS variables:

```css
:root {
  --kb-bg: #0b0d12;  --kb-surface: #161a22;  --kb-surface-2: #1f2430;
  --kb-text: #f3f5f8; --kb-text-dim: #a5adbb;
  --kb-accent: #4f8cff; --kb-danger: #ff5468; --kb-live: #ff3344;
  --kb-radius: 1.125rem; --kb-focus-ring: …; --kb-focus-scale: 1.06;
  --kb-caption-size: 3.3rem;
}
```

The focused element gets the `kb-focused` class and a group that contains focus
gets `kb-focus-within`. `prefers-reduced-motion` is respected.

---

## 12. Development commands

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # esbuild + jsdom + node:test
npm run build         # dist/ (ESM + .d.ts)
npm run demo          # examples/demo, the Vite dev server
npm run demo:build
```

---

## 14. Limits and known gaps

- On devices without native HLS the app has to provide hls.js.
- FairPlay is only defined at the configuration level; it has not been tested on Safari/tvOS.
- The DASH engine targets CMAF/fMP4; WebM DASH and TTML subtitles are not supported.
- There is no low latency (LL-DASH, chunked transfer) for DASH live streams.
- The `dist/` output is meant for a bundler (Vite/esbuild/webpack); because of the
  extensionless imports it cannot be loaded directly in the browser with
  `<script type="module">`.
- incremental-dom is distributed as CommonJS; with Vite, `optimizeDeps.include: ['incremental-dom']` is recommended.
