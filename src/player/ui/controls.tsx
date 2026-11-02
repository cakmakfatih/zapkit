import { useEffect, useRef, useSignalValue, useState } from '../../core/hooks';
import { h, type Child, type VNode } from '../../core/vnode';
import type { KbKeyDetail } from '../../focus/focus-manager';
import { Button } from '../../ui/basic';
import { Icon } from '../../ui/icons';
import { parseCueText, type VttNode } from '../captions/vtt';
import { PlayerState } from '../types';
import { formatTime, usePlayer, useStrings } from './context';

/*
 * Player building blocks. Each reads the Player from context and subscribes
 * to the signals it needs, so they can be rearranged into any layout;
 * VideoPlayer is one such layout.
 */

/** Hosts the <video> element owned by the Player. Applies squeezeback. */
export function PlayerSurface(props: { className?: string }): VNode {
  const player = usePlayer();
  const host = useRef<HTMLDivElement>(null);
  const squeeze = useSignalValue(player.squeezeback);
  useEffect(() => {
    const el = host.current;
    if (el && player.video.parentNode !== el) el.appendChild(player.video);
  }, [player]);
  const style = squeeze
    ? { transform: `translate(${squeeze.left * 100}%, ${squeeze.top * 100}%) scale(${squeeze.width}, ${squeeze.height})` }
    : undefined;
  return <div ref={host} className={['kb-player__surface', { 'kb-player__surface--squeezed': !!squeeze }, props.className]} style={style} skip />;
}
PlayerSurface.displayName = 'PlayerSurface';

function renderCueNodes(nodes: VttNode[]): Child[] {
  return nodes.map((n, i) => {
    if (n.tag === 'text') return n.text!;
    if (n.tag === 'br') return <br key={i} />;
    const tag = n.tag === 'c' || n.tag === 'v' || n.tag === 'lang' ? 'span' : n.tag;
    return h(tag, { key: i, className: ['kb-cue-' + n.tag, ...(n.classes || []).map((c) => 'kb-cue-c-' + c)] }, ...renderCueNodes(n.children || []));
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

const EDGES: Record<string, string> = {
  none: 'none',
  outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
  'drop-shadow': '2px 2px 3px rgba(0,0,0,.9)',
  raised: '1px 1px 0 #000, 2px 2px 0 #000',
  depressed: '-1px -1px 0 #000',
};

/** Renders the active caption cues with the user's caption settings. */
export function CaptionsLayer(props: { raised?: boolean }): VNode {
  const player = usePlayer();
  const cues = useSignalValue(player.cues);
  const s = useSignalValue(player.captionSettings);
  return (
    <div className={['kb-captions', { 'kb-captions--raised': props.raised }]} aria-live="polite">
      {cues.map((cue) => (
        <div key={cue.id || cue.start + ':' + cue.text} className="kb-captions__cue" style={{ textAlign: cue.settings.align === 'start' || cue.settings.align === 'left' ? 'left' : cue.settings.align === 'end' || cue.settings.align === 'right' ? 'right' : 'center' }}>
          <span
            className="kb-captions__text"
            style={{
              fontSize: `calc(var(--kb-caption-size) * ${s.fontScale})`,
              color: s.color,
              background: hexToRgba(s.background, s.backgroundOpacity),
              fontFamily: s.fontFamily,
              textShadow: EDGES[s.edge] || 'none',
            }}
          >
            {renderCueNodes(parseCueText(cue.text))}
          </span>
        </div>
      ))}
    </div>
  );
}
CaptionsLayer.displayName = 'CaptionsLayer';

/** "12:34 / 45:00", or the live badge for live streams. */
export function TimeCounter(): VNode {
  const player = usePlayer();
  const t = useSignalValue(player.currentTime);
  const d = useSignalValue(player.duration);
  const live = useSignalValue(player.liveMode);
  if (live !== 'none') return <LiveBadge />;
  return (
    <div className="kb-time">
      <span className="kb-time__current">{formatTime(t)}</span>
      <span className="kb-time__sep"> / </span>
      <span className="kb-time__duration">{formatTime(d)}</span>
    </div>
  );
}
TimeCounter.displayName = 'TimeCounter';

/** LIVE indicator (not interactive; apps add their own "go live" control with player.seekToLiveHead()). */
export function LiveBadge(): VNode {
  const strings = useStrings();
  return (
    <div className="kb-live" aria-label={strings.live}>
      <span className="kb-live__dot" />
      {strings.live}
    </div>
  );
}
LiveBadge.displayName = 'LiveBadge';

export interface ProgressBarProps {
  /** Seconds per step on a single press. Default 10. */
  step?: number;
  /** Delay (ms) after the last press before the scrub position is committed. Default 700. */
  commitDelay?: number;
  onActivity?: () => void;
}

/**
 * Seek bar operated with left/right. Holding a direction accelerates (step
 * grows with the number of repeats); the target position is previewed with
 * a storyboard thumbnail and committed on Enter or after a short pause.
 */
export function ProgressBar(props: ProgressBarProps): VNode {
  const player = usePlayer();
  const t = useSignalValue(player.currentTime);
  const d = useSignalValue(player.duration);
  const buffered = useSignalValue(player.bufferedEnd);
  const seekable = useSignalValue(player.seekable);
  const live = useSignalValue(player.liveMode);
  const [scrub, setScrub] = useState<number | null>(null);
  const repeats = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef = useRef<number | null>(null);
  scrubRef.current = scrub;

  const start = live !== 'none' && seekable ? seekable.start : 0;
  const end = live !== 'none' && seekable ? seekable.end : d;
  const span = Math.max(0.001, end - start);
  const disabled = live === 'live' || !end;
  const pos = scrub != null ? scrub : t;
  const frac = (x: number) => Math.max(0, Math.min(1, (x - start) / span));

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const target = scrubRef.current;
    if (target != null) player.seekTo(target);
    repeats.current = 0;
    setScrub(null);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onKey = (e: CustomEvent<KbKeyDetail>) => {
    const key = e.detail.key;
    if (disabled) return;
    if (key === 'left' || key === 'right') {
      e.preventDefault();
      repeats.current = e.detail.repeat ? repeats.current + 1 : 0;
      const base = props.step || 10;
      const accel = 1 + Math.floor(repeats.current / 4);
      const step = Math.min(base * accel * accel, Math.max(base, span / 20));
      const from = scrubRef.current != null ? scrubRef.current : player.video.currentTime;
      const next = Math.max(start, Math.min(end - 1, from + (key === 'left' ? -step : step)));
      setScrub(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(commit, props.commitDelay || 700);
      if (props.onActivity) props.onActivity();
    } else if (key === 'enter' && scrubRef.current != null) {
      e.preventDefault();
      commit();
    }
  };

  const frame = scrub != null ? player.getStoryboardFrame(scrub) : null;
  return (
    <div
      className={['kb-progress', { 'kb-progress--scrubbing': scrub != null, 'kb-progress--disabled': disabled }]}
      focusable={!disabled}
      focusId="kb-player-progress"
      role="slider"
      aria-valuemin={String(Math.floor(start))}
      aria-valuemax={String(Math.floor(end))}
      aria-valuenow={String(Math.floor(pos))}
      onKbkey={onKey}
    >
      <div className="kb-progress__track">
        <div className="kb-progress__buffered" style={{ width: frac(buffered) * 100 + '%' }} />
        <div className="kb-progress__played" style={{ width: frac(pos) * 100 + '%' }} />
        <div className="kb-progress__thumb" style={{ left: frac(pos) * 100 + '%' }} />
      </div>
      {scrub != null ? (
        <div className="kb-progress__preview" style={{ left: frac(scrub) * 100 + '%' }}>
          {frame ? (
            <div
              className="kb-progress__frame"
              style={{
                width: frame.width + 'px',
                height: frame.height + 'px',
                backgroundImage: `url("${frame.url}")`,
                backgroundPosition: `-${frame.x}px -${frame.y}px`,
              }}
            />
          ) : null}
          <span className="kb-progress__time">{live !== 'none' ? '-' + formatTime(end - scrub) : formatTime(scrub)}</span>
        </div>
      ) : null}
    </div>
  );
}
ProgressBar.displayName = 'ProgressBar';

/** Which built-in transport buttons are shown. Every flag defaults to true; set one to false to remove that button. */
export interface TransportButtons {
  /** Previous item of a playlist (shown only when the playlist has several items). */
  previous?: boolean;
  /** Next item of a playlist (shown only when the playlist has several items). */
  next?: boolean;
  /** The -10 s / +10 s buttons. */
  seek?: boolean;
  /** Subtitles button (shown only when the video has subtitle tracks). */
  captions?: boolean;
  /** Audio-track button (shown only when there are several tracks). */
  audio?: boolean;
  /** Stats-for-nerds button. */
  stats?: boolean;
  /** Settings button. */
  settings?: boolean;
}

export interface TransportControlsProps {
  /** Built-in buttons to show or remove. */
  buttons?: TransportButtons;
  onOpenSettings?: (section?: 'root' | 'captions' | 'audio') => void;
  onToggleStats?: () => void;
  /** Extra buttons appended to the right group. */
  extra?: Child;
  /** Extra buttons before the rewind button (left group), e.g. "previous". */
  start?: Child;
  /** Extra buttons after the forward button (left group), e.g. "next". */
  end?: Child;
  onActivity?: () => void;
}

/** Previous / -10 / play-pause / +10 / next, plus captions, audio and settings; apps add their own buttons through `start`, `end` and `extra`. */
export function TransportControls(props: TransportControlsProps): VNode {
  const player = usePlayer();
  const strings = useStrings();
  const state = useSignalValue(player.state);
  const live = useSignalValue(player.liveMode);
  const list = useSignalValue(player.playlist);
  useSignalValue(player.playlistIndex);
  const captions = useSignalValue(player.captionTracks);
  const caption = useSignalValue(player.captionTrack);
  const audio = useSignalValue(player.audioTracks);
  const playing = state === PlayerState.PLAYING || state === PlayerState.BUFFERING;
  const b = props.buttons || {};
  const canSeek = live !== 'live' && b.seek !== false;
  const act = (fn: () => void) => () => {
    fn();
    if (props.onActivity) props.onActivity();
  };
  return (
    <div className="kb-transport" focusGroup={{ orientation: 'horizontal' }}>
      <div className="kb-transport__group">
        {props.start}
        {list.length > 1 && b.previous !== false ? (
          <Button icon="previous" ariaLabel={strings.previous} disabled={!player.hasPrevious() && live !== 'none'} onClick={act(() => player.previousVideo())} />
        ) : null}
        {canSeek ? <Button icon="replay10" ariaLabel={strings.rewind} onClick={act(() => player.seekBy(-10))} /> : null}
        <Button
          icon={playing ? 'pause' : 'play'}
          ariaLabel={playing ? strings.pause : strings.play}
          focusId="kb-player-play"
          className="kb-transport__play"
          onClick={act(() => player.togglePlay())}
        />
        {canSeek ? <Button icon="forward10" ariaLabel={strings.forward} onClick={act(() => player.seekBy(10))} /> : null}
        {list.length > 1 && b.next !== false ? <Button icon="next" ariaLabel={strings.next} disabled={!player.hasNext()} onClick={act(() => player.nextVideo())} /> : null}
        {props.end}
      </div>
      <div className="kb-transport__group kb-transport__group--end">
        {props.extra}
        {captions.length && b.captions !== false ? (
          <Button icon="captions" ariaLabel={strings.captions} selected={!!caption} onClick={act(() => props.onOpenSettings && props.onOpenSettings('captions'))} />
        ) : null}
        {audio.length > 1 && b.audio !== false ? <Button icon="audio" ariaLabel={strings.audio} onClick={act(() => props.onOpenSettings && props.onOpenSettings('audio'))} /> : null}
        {props.onToggleStats && b.stats !== false ? <Button icon="stats" ariaLabel={strings.stats} onClick={act(() => props.onToggleStats!())} /> : null}
        {b.settings !== false ? (
          <Button icon="settings" ariaLabel={strings.settings} focusId="kb-player-settings" onClick={act(() => props.onOpenSettings && props.onOpenSettings('root'))} />
        ) : null}
      </div>
    </div>
  );
}
TransportControls.displayName = 'TransportControls';

/** Title / subtitle / extra metadata of the current source. */
export function MetadataSection(props: { children?: Child }): VNode {
  const player = usePlayer();
  const src = useSignalValue(player.source);
  return (
    <div className="kb-meta">
      {src && src.title ? <div className="kb-meta__title">{src.title}</div> : null}
      {src && src.subtitle ? <div className="kb-meta__subtitle">{src.subtitle}</div> : null}
      {props.children}
    </div>
  );
}
MetadataSection.displayName = 'MetadataSection';

/** Large play/pause/seek icon flashed in the centre after a remote command. */
export function ToggleIndicator(props: { icon: string | null; nonce: number }): VNode {
  return props.icon ? (
    <div key={props.nonce} className="kb-toggle-indicator">
      <Icon name={props.icon} />
    </div>
  ) : (
    <div className="kb-toggle-indicator kb-toggle-indicator--idle" />
  );
}
ToggleIndicator.displayName = 'ToggleIndicator';

/** Spinner shown while buffering. */
export function BufferingIndicator(): VNode {
  const player = usePlayer();
  const state = useSignalValue(player.state);
  const show = state === PlayerState.BUFFERING || (state === PlayerState.UNSTARTED && !!player.source.value && !player.error.value);
  return <div className={['kb-player__buffering', { 'kb-player__buffering--on': show }]}>{show ? <div className="kb-spinner" /> : null}</div>;
}
BufferingIndicator.displayName = 'BufferingIndicator';
