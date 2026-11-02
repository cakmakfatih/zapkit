# zapkit-tv

TV cihazları için React benzeri web UI kütüphanesi: incremental-dom tabanlı
render, kumanda (D-pad) odak yönetimi, store, yığın router, sanal listeler ve
HLS/DASH/DRM destekli tam bir video oynatıcı.

```tsx
import { h, render, focus, installScaling } from 'zapkit-tv';
import { Player, VideoPlayer } from 'zapkit-tv/player';
import 'zapkit-tv/styles.css';

installScaling();
const player = new Player();
render(<VideoPlayer player={player} />, document.getElementById('app')!);
focus.start(document.body);
player.load({ url: 'https://example.com/stream.m3u8', title: 'Örnek' });
player.play();
```

Ayrıntılı kılavuz: [docs/KILAVUZ.md](docs/KILAVUZ.md)

```bash
npm install
npm test
npm run build
npm run demo
```
