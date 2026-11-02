# zapkit-tv

A small, React-like UI library for TV web apps, with a complete video player.
Remote-control (D-pad) navigation is a first-class feature, rendering is done by Google's
[incremental-dom](https://github.com/google/incremental-dom), and the player handles HLS, DASH,
subtitles, playlists and DRM.

> **Early stage.** zapkit-tv is new, it is not ready for production use, and its tests are not
> detailed yet (the suite covers the renderer, the focus rules, the keyboard and the player UI,
> not real TVs or real streams). APIs can change without notice. If you want to build on it,
> please **fork the repository** and treat it as experimental. Bug reports are welcome.

**Source:** <https://github.com/cakmakfatih/zapkit-tv>

**Example project:** [F-IPTV](https://github.com/cakmakfatih/f-iptv), an IPTV player for TVs (live TV,
movies, series, profiles and a PIN) built entirely on zapkit-tv. Its source shows how the library is used in a
real app.

```tsx
import { h, render, focus, installScaling } from 'zapkit-tv';
import { Player, VideoPlayer } from 'zapkit-tv/player';
import 'zapkit-tv/styles.css';

installScaling();
const player = new Player();
render(<VideoPlayer player={player} />, document.getElementById('app')!);
focus.start(document.body);
player.load({ url: 'https://example.com/stream.m3u8', title: 'Example' });
player.play();
```

```bash
npm install zapkit-tv
```

## How it was made

TV web apps have a different job from phone or desktop apps: the user has a remote with arrow keys,
the browser is old and the CPU is slow. YouTube's TV app solves this by keeping the rendering layer
thin (incremental-dom plus a small component layer) and by treating focus and the player as the core
of the app. zapkit-tv takes that same approach as its inspiration and builds it as a standalone,
original library: a thin component layer on top of incremental-dom, a spatial focus manager, a
store, a router and a player, all written from scratch for this project. No YouTube code was copied.
The player uses only standard web APIs (HTMLMediaElement, Media Source Extensions, Encrypted Media
Extensions).

## Technologies and what they are for

| Technology | What it does here |
| --- | --- |
| [incremental-dom](https://github.com/google/incremental-dom) 0.7 (Apache-2.0) | Patches the real DOM in place while rendering. There is no virtual-DOM tree to build and compare, so a render allocates little memory. It is the library's only dependency. |
| TypeScript, JSX (`h`) | Typed API and a React-like way to write views: components, hooks, context, keyed lists, class components for lifecycle needs. |
| Signals | A value can be placed straight in a view (`<span>{player.currentTime}</span>`). Only that text node updates, the component does not render again. The player publishes its state this way. |
| Focus manager | Spatial navigation for the arrow keys, focus groups (wrap, trap, memory), focus locks, restore on back, and key mapping for Tizen, webOS, VIDAA and Android TV remotes. |
| Store and router | A small Redux-compatible store and a stack router that returns to the previous screen with the previously focused item focused again. |
| `VirtualList` | Lists and grids with thousands of items: only the window around the focused item is in the DOM, and it scrolls with a CSS transform. |
| Media Source Extensions, EME | The built-in DASH engine (ABR, live/DVR) and DRM. HLS plays natively or through an hls.js build the app provides. |
| rem-based scaling | Layouts are designed on a 1920×1080 canvas and scale to any screen with one root font size. |

## Why it performs well on TVs

- **No virtual DOM.** incremental-dom writes only what changed into the real DOM while it walks the
  view, which keeps memory and garbage collection low on TV chipsets.
- **Fine-grained updates.** Signals and keyed rendering touch single nodes, so moving focus or a
  ticking progress bar does not re-render a screen.
- **Small windows of DOM.** `VirtualList` keeps a few dozen nodes alive however long the list is.
- **Compositor-friendly motion.** Scrolling and focus effects use `transform` and `opacity`, which
  low-end GPUs can animate without relayout.
- **Old-browser friendly.** The library compiles to ES2017 with a single dependency, and the example
  app targets Chrome 69 era TV browsers. F-IPTV's whole application script is about 73 kB gzipped; hls.js
  loads separately and only when needed. The stylesheet spaces flex items with margins instead of
  `gap`, which older TV browsers (before Chromium 84) ignore for flexbox.

## The player

- **Headless core plus a ready UI.** `Player` has no UI and publishes its state as signals, so you can use it
  with your own screens. `VideoPlayer` is a full OSD (play/pause, seek, settings, captions, quality,
  speed, stats) on top of it.
- **Many formats.** HLS (native or hls.js), DASH and progressive files, with ABR, live and DVR, DRM through
  EME, WebVTT subtitles and caption styling, audio tracks, and storyboard seek previews.
- **Generic and extensible.** It only ships controls every player needs. Next episode, channel zapping, "go live" or an
  "up next" card are added by the app through slots (`transportStart`, `transportEnd`, `extraControls`,
  `children`) and the player API. A control the app leaves out is not rendered at all.
- **Everything is replaceable.** All text lives in `PlayerStrings`, icons can be swapped, and preferences
  (volume, quality, caption style) are remembered.
- **Playlists.** Auto-advance, previous/next, shuffle and loop, and an "up next" countdown for series.
- **D-pad ready.** Every control is focusable and the keys map to seek, play/pause and the media keys of TV
  remotes.

## Highlights of the UI kit

`OnScreenKeyboard` (D-pad keyboard with a phone-style shift key and an optional caret),
`VirtualList`, `Button`, `Image`, `Marquee`, overlays, toasts, scaling helpers, filled and outline
icon sets, and helpers that stop a TV's own keyboard from appearing next to yours.

## Documentation

See the [guide](docs/GUIDE.md).

## Development

```bash
npm install
npm test        # unit tests (jsdom)
npm run build   # compiles to dist/
npm run demo    # demo app
```

## License

[Apache License 2.0](LICENSE)
