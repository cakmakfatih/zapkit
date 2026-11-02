/*
 * zapkit-tv demo: a home screen with focusable rows and the full player.
 * Run with `npm run demo` and use the arrow keys, Enter and Escape/Backspace.
 */
import {
  h,
  render,
  createRouter,
  RouterView,
  VirtualList,
  Button,
  FocusGroup,
  OverlayStage,
  ToastStage,
  focus,
  installScaling,
  registerPlatformKeys,
  toast,
  useEffect,
  useMemo,
  type RouteProps,
} from '../../src/index';
import { Player, VideoPlayer, type VideoSource } from '../../src/player/index';
import '../../styles/zapkit-tv.css';
import './demo.css';

// Public test streams.
const ITEMS: VideoSource[] = [
  { id: 'bbb-hls', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', title: 'Big Buck Bunny', subtitle: 'HLS · native or hls.js' },
  { id: 'bbb-dash', url: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd', title: 'Big Buck Bunny', subtitle: 'DASH · built-in MSE engine' },
  { id: 'sintel', url: 'https://bitdash-a.akamaihd.net/content/sintel/sintel.mpd', title: 'Sintel', subtitle: 'DASH · multi audio + subtitles' },
  { id: 'tears', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8', title: 'Tears of Steel', subtitle: 'HLS' },
];
const HUES = [210, 280, 150, 20, 330, 45];

function Home({ router }: RouteProps) {
  return (
    <div className="demo-home">
      <h1>zapkit-tv</h1>
      <p>React-like components, D-pad focus and a full TV player.</p>
      <div className="demo-row-title">Play a stream</div>
      <VirtualList
        items={ITEMS}
        orientation="horizontal"
        itemSize={420}
        gap={32}
        viewportSize={1728}
        focusPrefix="home"
        keyOf={(it) => it.id!}
        renderItem={(it, i) => (
          <div className="demo-card" onClick={() => router.navigate('/watch/' + i)}>
            <div className="demo-card__art" style={{ background: `linear-gradient(135deg, hsl(${HUES[i % 6]} 70% 45%), hsl(${HUES[(i + 2) % 6]} 60% 25%))` }} />
            <div className="demo-card__label">
              {it.title}
              <div style={{ fontSize: '1.1rem', opacity: 0.75, fontWeight: 400 }}>{it.subtitle}</div>
            </div>
          </div>
        )}
      />
      <FocusGroup className="demo-actions" orientation="horizontal">
        <Button icon="play" label="Play all as playlist" onClick={() => router.navigate('/watch/0?playlist=1')} />
        <Button label="Show a toast" onClick={() => toast('Hello from zapkit-tv', { kind: 'success' })} />
      </FocusGroup>
    </div>
  );
}

function Watch({ params, query, router }: RouteProps<{ index: string }>) {
  const player = useMemo(() => new Player(), []);
  useEffect(() => {
    const i = Number(params.index) || 0;
    if (query.playlist) player.loadPlaylist(ITEMS, i);
    else player.load(ITEMS[i]);
    player.play();
    return () => player.destroy();
  }, []);
  return <VideoPlayer player={player} onBack={() => router.back()} />;
}

const router = createRouter({
  routes: [
    { path: '/', component: Home, keepAlive: true },
    { path: '/watch/:index', component: Watch },
  ],
});

installScaling();
registerPlatformKeys();
render(
  <div className="kb-scale">
    <RouterView router={router} />
    <OverlayStage />
    <ToastStage />
  </div>,
  document.getElementById('app')!,
);
focus.start(document.body);
router.attach();
