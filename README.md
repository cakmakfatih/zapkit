# zapkit-tv

A React-like web UI library for TV devices: incremental-dom based rendering,
remote-control (D-pad) focus management, a store, a stack router, virtual lists and
a complete video player with HLS/DASH/DRM support.

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

## Highlights

- **Focus first.** Spatial D-pad navigation, focus groups with wrap/trap/memory, focus
  locks, focus restoration in the router and key normalisation for Tizen, webOS,
  VIDAA and Android TV.
- **Generic player.** HLS (native or hls.js), a built-in DASH/MSE engine with ABR and
  DRM, subtitles, playlists and storyboard previews. The UI ships only the controls
  every player needs; apps add their own (next episode, channel zapping, "go live", an
  "up next" card…) through `transportStart`, `transportEnd`, `extraControls` and
  `children`, using the player API.
- **Everything is replaceable.** All visible text lives in `PlayerStrings` (English by
  default, pass `strings` to translate), and built-in buttons the app does not want are not
  rendered at all (`controls` prop).
- **TV UI parts.** `VirtualList` (lists and grids), `OnScreenKeyboard` (D-pad keyboard with a
  phone-style shift key), `Button`, `Image`, `Marquee`, overlays, toasts, scaling to a 1920×1080 design canvas and icon helpers (filled and
  outline icon sets).

## Documentation

See the [guide](docs/GUIDE.md).

## Development

```bash
npm install
npm test
npm run build
npm run demo
```

## License

See `package.json`.
