import { useEffect, useRef, useSignalValue, useState } from '../../core/hooks';
import { h, type Child, type VNode } from '../../core/vnode';
import { focus as defaultFocus, type FocusManager } from '../../focus/focus-manager';
import type { LogicalKey } from '../../focus/keys';
import type { Player, UpNextInfo } from '../player';
import { PlayerState } from '../types';
import { DEFAULT_STRINGS, PlayerContext, StringsContext, type PlayerStrings } from './context';
import { BufferingIndicator, CaptionsLayer, MetadataSection, PlayerSurface, ProgressBar, TimeCounter, ToggleIndicator, TransportControls } from './controls';
import { ErrorPanel, SettingsPanel, StatsOverlay, UpNextCard, type SettingsSection } from './panels';

/**
 * Remote media keys (play/pause, stop, FF/RW, next/previous, subtitle and
 * audio buttons) for a player, active while the component is mounted.
 * `onCommand` lets the UI flash an indicator or show the OSD.
 */
export function usePlayerKeys(
  player: Player,
  options: { onCommand?: (key: LogicalKey, icon: string | null) => void; onSubtitle?: () => void; onAudio?: () => void; onInfo?: () => void; priority?: number; focusManager?: FocusManager } = {},
): void {
  const latest = useRef(options);
  latest.current = options;
  const manager = options.focusManager || defaultFocus;
  useEffect(
    () =>
      manager.onKey((key) => {
        const o = latest.current;
        const live = player.liveMode.peek() === 'live';
        let icon: string | null = null;
        switch (key) {
          case 'playPause':
            player.togglePlay();
            icon = player.video.paused ? 'pause' : 'play';
            break;
          case 'play':
            player.play();
            icon = 'play';
            break;
          case 'pause':
            player.pause();
            icon = 'pause';
            break;
          case 'stop':
            player.pause();
            player.seekTo(0);
            icon = 'stop';
            break;
          case 'fastForward':
            if (live) return false;
            player.seekBy(30);
            icon = 'forward';
            break;
          case 'rewind':
            if (live) return false;
            player.seekBy(-30);
            icon = 'rewind';
            break;
          case 'next':
          case 'channelUp':
            if (!player.hasNext()) return false;
            player.nextVideo();
            icon = 'next';
            break;
          case 'previous':
          case 'channelDown':
            if (!player.hasPrevious() && player.liveMode.peek() !== 'none') return false;
            player.previousVideo();
            icon = 'previous';
            break;
          case 'subtitle':
            if (o.onSubtitle) o.onSubtitle();
            break;
          case 'audioTrack':
            if (o.onAudio) o.onAudio();
            break;
          case 'info':
            if (o.onInfo) o.onInfo();
            break;
          default:
            return false;
        }
        if (o.onCommand) o.onCommand(key, icon);
        return true;
      }, options.priority ?? 20),
    [player, manager],
  );
}

export interface VideoPlayerProps {
  player: Player;
  strings?: Partial<PlayerStrings>;
  /** Back pressed with nothing left to close (OSD hidden). */
  onBack?: () => void;
  /** Called by the error panel's Retry button. Default: reload the source. */
  onRetry?: () => void;
  /** Auto-hide delay for the controls while playing (ms). Default 4000. */
  osdTimeout?: number;
  /** Show the stats-for-nerds button. Default true. */
  showStats?: boolean;
  /** Custom content for the "Up next" card. */
  renderUpNext?: (info: UpNextInfo) => Child;
  /** Extra buttons in the control bar. */
  extraControls?: Child;
  /** Extra content under the title. */
  metadata?: Child;
  /** Overlay drawn above the video (e.g. a channel list). */
  children?: Child;
  className?: unknown;
  focusManager?: FocusManager;
}

/**
 * Complete TV player: video surface, captions, buffering spinner, on-screen
 * controls that hide while playing, D-pad scrubbing, settings sheet, stats,
 * "Up next" with countdown for playlists/series, and error handling.
 *
 * Remote behaviour (OSD hidden): left/right seek 10 s, Enter toggles play,
 * up/down show the controls, Back calls `onBack`. With the OSD visible the
 * keys navigate the controls and Back hides them.
 */
export function VideoPlayer(props: VideoPlayerProps): VNode {
  const { player } = props;
  const manager = props.focusManager || defaultFocus;
  const strings = props.strings ? { ...DEFAULT_STRINGS, ...props.strings } : DEFAULT_STRINGS;
  const state = useSignalValue(player.state);
  const upNext = useSignalValue(player.upNext);
  const error = useSignalValue(player.error);
  const live = useSignalValue(player.liveMode);
  const [osd, setOsd] = useState(true);
  const [activity, setActivity] = useState(0);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [settingsEntry, setSettingsEntry] = useState<SettingsSection>('root');
  const [stats, setStats] = useState(false);
  const [indicator, setIndicator] = useState<{ icon: string | null; nonce: number }>({ icon: null, nonce: 0 });
  const root = useRef<HTMLDivElement>(null);
  const timeout = props.osdTimeout ?? 4000;

  const bump = () => setActivity((n) => n + 1);
  const show = (focusId?: string) => {
    setOsd(true);
    bump();
    if (focusId) requestAnimationFrame(() => manager.focusById(focusId));
  };
  const flash = (icon: string | null) => icon && setIndicator((s) => ({ icon, nonce: s.nonce + 1 }));
  const openSettings = (section: SettingsSection = 'root') => {
    setSettingsEntry(section);
    setSettings(section);
    setOsd(true);
  };
  const closeSettings = () => {
    setSettings(null);
    requestAnimationFrame(() => manager.focusById('kb-player-settings') || manager.focusById('kb-player-play'));
  };

  // Auto-hide while playing and idle.
  const playing = state === PlayerState.PLAYING;
  useEffect(() => {
    if (!osd || !playing || settings || error) return;
    const t = setTimeout(() => setOsd(false), timeout);
    return () => clearTimeout(t);
  }, [osd, playing, settings, activity, error]);

  // Show controls when playback pauses or ends.
  useEffect(() => {
    if (state === PlayerState.PAUSED || state === PlayerState.ENDED) setOsd(true);
  }, [state]);

  // Focus the play button whenever the OSD appears without focus inside it.
  useEffect(() => {
    if (!osd || settings) return;
    const cur = manager.current;
    const el = root.current;
    if (!el || !cur || !el.querySelector('.kb-osd') || !el.querySelector('.kb-osd')!.contains(cur)) {
      requestAnimationFrame(() => manager.focusById('kb-player-play'));
    }
  }, [osd]);

  // "Up next" takes focus when it appears.
  const upNextKey = upNext ? upNext.index + ':' + (upNext.countdown != null) : '';
  useEffect(() => {
    if (upNext) requestAnimationFrame(() => manager.focusById('kb-upnext-play'));
  }, [upNextKey]);

  usePlayerKeys(player, {
    focusManager: manager,
    onCommand: (_key, icon) => {
      flash(icon);
      bump();
    },
    onSubtitle: () => openSettings('captions'),
    onAudio: () => openSettings('audio'),
    onInfo: () => (osd ? setOsd(false) : show()),
  });

  const latest = useRef({ osd, settings, settingsEntry, upNext, error, live });
  latest.current = { osd, settings, settingsEntry, upNext, error, live };
  useEffect(
    () =>
      manager.onKey((key) => {
        const s = latest.current;
        if (s.error && s.error.fatal) {
          if (key === 'back' && props.onBack) {
            props.onBack();
            return true;
          }
          return false;
        }
        if (s.settings) {
          if (key === 'back') {
            if (s.settings !== s.settingsEntry && s.settings !== 'root') setSettings(s.settings === 'captionStyle' ? 'captions' : 'root');
            else closeSettings();
            return true;
          }
          bump();
          return false;
        }
        if (s.upNext) {
          if (key === 'back') {
            player.dismissUpNext();
            show('kb-player-play');
            return true;
          }
          if (key === 'enter' || ((key === 'left' || key === 'right') && !s.osd)) return false;
        }
        if (!s.osd) {
          if ((key === 'left' || key === 'right') && s.live !== 'live') {
            show('kb-player-progress');
            return false; // the focused progress bar handles the scrub
          }
          if (key === 'enter') {
            player.togglePlay();
            flash(player.video.paused ? 'pause' : 'play');
            show();
            return true;
          }
          if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
            show();
            return true;
          }
          if (key === 'back') {
            if (props.onBack) props.onBack();
            return true;
          }
          return false;
        }
        bump();
        if (key === 'back') {
          if (player.state.peek() === PlayerState.PLAYING) {
            setOsd(false);
            return true;
          }
          if (props.onBack) props.onBack();
          return true;
        }
        return false;
      }, 10),
    [player, manager],
  );

  const retry = props.onRetry || (() => {
    const src = player.source.peek();
    if (src) player.load(src, player.video.currentTime || undefined);
  });

  return h(
    PlayerContext.Provider,
    { value: player },
    h(
      StringsContext.Provider,
      { value: strings },
      <div ref={root} className={['kb-player', { 'kb-player--osd': osd, 'kb-player--settings': !!settings }, props.className]} focusGroup={{ trap: true }}>
        <PlayerSurface />
        <CaptionsLayer raised={osd} />
        <BufferingIndicator />
        <ToggleIndicator icon={indicator.icon} nonce={indicator.nonce} />
        {props.children}
        <div className={['kb-osd', { 'kb-osd--hidden': !osd }]} disableFocus={!osd} aria-hidden={osd ? null : 'true'}>
          <div className="kb-osd__top">
            <MetadataSection>{props.metadata}</MetadataSection>
          </div>
          <div className="kb-osd__bottom" focusGroup={{ orientation: 'vertical', enterTo: 'first' }}>
            <div className="kb-osd__timeline">
              <ProgressBar onActivity={bump} />
              <TimeCounter />
            </div>
            <TransportControls onOpenSettings={(sec) => openSettings(sec || 'root')} onToggleStats={props.showStats === false ? undefined : () => setStats((v) => !v)} extra={props.extraControls} onActivity={bump} />
          </div>
        </div>
        {stats ? <StatsOverlay /> : null}
        {upNext && !error ? <UpNextCard info={upNext} render={props.renderUpNext} /> : null}
        {settings ? <SettingsPanel section={settings} onSection={setSettings} onClose={closeSettings} /> : null}
        <ErrorPanel onRetry={retry} onBack={props.onBack} />
      </div>,
    ),
  );
}
VideoPlayer.displayName = 'VideoPlayer';
