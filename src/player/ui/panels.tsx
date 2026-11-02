import { useEffect, useSignalValue, useState } from '../../core/hooks';
import { h, type Child, type VNode } from '../../core/vnode';
import { Button } from '../../ui/basic';
import { Icon } from '../../ui/icons';
import { Image } from '../../ui/basic';
import type { UpNextInfo } from '../player';
import type { CaptionSettings } from '../types';
import { usePlayer, useStrings } from './context';

/*
 * Side panels and cards drawn over the video: settings menu, stats for
 * nerds, "Up next" (next episode) and the error panel.
 */

export type SettingsSection = 'root' | 'quality' | 'speed' | 'audio' | 'captions' | 'captionStyle';

interface Row {
  key: string;
  label: Child;
  value?: Child;
  selected?: boolean;
  onSelect: () => void;
}

function Menu(props: { title: Child; rows: Row[]; onBack?: () => void }): VNode {
  return (
    <div className="kb-settings__menu" focusGroup={{ orientation: 'vertical', trap: true, enterTo: 'first' }}>
      <div className="kb-settings__title">
        {props.onBack ? <Icon name="chevronLeft" /> : null}
        {props.title}
      </div>
      {props.rows.map((r, i) => (
        <button
          key={r.key}
          type="button"
          className={['kb-settings__row', { 'kb-selected': r.selected }]}
          focusable
          focusId={'kb-settings-' + r.key}
          autoFocus={r.selected || (i === 0 && !props.rows.some((x) => x.selected))}
          onClick={r.onSelect}
        >
          <span className="kb-settings__check">{r.selected ? <Icon name="check" /> : null}</span>
          <span className="kb-settings__label">{r.label}</span>
          {r.value != null ? <span className="kb-settings__value">{r.value}</span> : null}
          {r.value != null ? <Icon name="chevronRight" /> : null}
        </button>
      ))}
    </div>
  );
}

const FONT_SCALES = [0.75, 1, 1.25, 1.5, 2];
const COLORS: Array<[string, string]> = [
  ['#ffffff', 'White'],
  ['#ffff00', 'Yellow'],
  ['#00ffff', 'Cyan'],
  ['#00ff00', 'Green'],
];
const BACKGROUNDS: Array<[number, string]> = [
  [0, '0%'],
  [0.5, '50%'],
  [0.75, '75%'],
  [1, '100%'],
];

/**
 * Settings side sheet: quality, speed, audio track, subtitles and subtitle
 * style. `section` opens a submenu directly (e.g. the captions button).
 */
export function SettingsPanel(props: { section: SettingsSection; onSection: (s: SettingsSection) => void; onClose: () => void }): VNode {
  const player = usePlayer();
  const strings = useStrings();
  const qualities = useSignalValue(player.qualities);
  const quality = useSignalValue(player.quality);
  const auto = useSignalValue(player.autoQuality);
  const rate = useSignalValue(player.playbackRate);
  const audios = useSignalValue(player.audioTracks);
  const audio = useSignalValue(player.audioTrack);
  const captions = useSignalValue(player.captionTracks);
  const caption = useSignalValue(player.captionTrack);
  const cs = useSignalValue(player.captionSettings);
  const go = props.onSection;
  const back = () => go('root');
  const pick = (fn: () => void) => () => {
    fn();
    props.onClose();
  };

  let menu: VNode;
  switch (props.section) {
    case 'quality': {
      const levels = qualities.slice().sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
      menu = (
        <Menu
          title={strings.quality}
          onBack={back}
          rows={[
            { key: 'q-auto', label: strings.auto + (auto && quality ? ` (${quality.label})` : ''), selected: auto, onSelect: pick(() => player.setPlaybackQuality('auto')) },
            ...levels.map((l) => ({ key: 'q-' + l.id, label: l.label, selected: !auto && !!quality && quality.id === l.id, onSelect: pick(() => player.setPlaybackQuality(l.id)) })),
          ]}
        />
      );
      break;
    }
    case 'speed':
      menu = (
        <Menu
          title={strings.speed}
          onBack={back}
          rows={player.getAvailablePlaybackRates().map((r) => ({ key: 'r-' + r, label: r === 1 ? strings.normal : r + 'x', selected: r === rate, onSelect: pick(() => player.setPlaybackRate(r)) }))}
        />
      );
      break;
    case 'audio':
      menu = (
        <Menu
          title={strings.audio}
          onBack={back}
          rows={audios.map((a) => ({
            key: 'a-' + a.id,
            label: a.label + (a.channels && a.channels > 2 ? ` ${a.channels}ch` : ''),
            selected: !!audio && audio.id === a.id,
            onSelect: pick(() => player.setAudioTrack(a.id)),
          }))}
        />
      );
      break;
    case 'captions':
      menu = (
        <Menu
          title={strings.captions}
          onBack={back}
          rows={[
            { key: 'c-off', label: strings.off, selected: !caption, onSelect: pick(() => player.setCaptionTrack(null)) },
            ...captions.map((c) => ({ key: 'c-' + c.id, label: c.label, selected: !!caption && caption.id === c.id, onSelect: pick(() => player.setCaptionTrack(c.id)) })),
            { key: 'c-style', label: strings.captionStyle, value: '', onSelect: () => go('captionStyle') },
          ]}
        />
      );
      break;
    case 'captionStyle': {
      const set = (patch: Partial<CaptionSettings>) => () => player.setCaptionSettings(patch);
      const cycle = <T,>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];
      menu = (
        <Menu
          title={strings.captionStyle}
          onBack={() => go('captions')}
          rows={[
            { key: 'cs-size', label: strings.fontSize, value: Math.round(cs.fontScale * 100) + '%', onSelect: set({ fontScale: cycle(FONT_SCALES, cs.fontScale) }) },
            {
              key: 'cs-color',
              label: strings.textColor,
              value: (COLORS.find((c) => c[0] === cs.color) || [cs.color, cs.color])[1],
              onSelect: set({ color: cycle(COLORS.map((c) => c[0]), cs.color) }),
            },
            {
              key: 'cs-bg',
              label: strings.background,
              value: Math.round(cs.backgroundOpacity * 100) + '%',
              onSelect: set({ backgroundOpacity: cycle(BACKGROUNDS.map((b) => b[0]), cs.backgroundOpacity) }),
            },
            {
              key: 'cs-edge',
              label: 'Edge',
              value: cs.edge,
              onSelect: set({ edge: cycle<CaptionSettings['edge']>(['none', 'outline', 'drop-shadow', 'raised', 'depressed'], cs.edge) }),
            },
          ]}
        />
      );
      break;
    }
    default:
      menu = (
        <Menu
          title={strings.settings}
          rows={[
            ...(qualities.length > 1 ? [{ key: 'quality', label: strings.quality, value: auto ? strings.auto + (quality ? ` (${quality.label})` : '') : quality ? quality.label : '', onSelect: () => go('quality') }] : []),
            ...(player.getAvailablePlaybackRates().length > 1 ? [{ key: 'speed', label: strings.speed, value: rate === 1 ? strings.normal : rate + 'x', onSelect: () => go('speed') }] : []),
            ...(audios.length > 1 ? [{ key: 'audio', label: strings.audio, value: audio ? audio.label : '', onSelect: () => go('audio') }] : []),
            { key: 'captions', label: strings.captions, value: caption ? caption.label : strings.off, onSelect: () => go('captions') },
          ]}
        />
      );
  }
  return (
    <div className="kb-settings" role="dialog" aria-label={strings.settings}>
      {h('div', { key: props.section, className: 'kb-settings__page' }, menu)}
    </div>
  );
}
SettingsPanel.displayName = 'SettingsPanel';

/** Live-updating playback diagnostics (getStatsForNerds). */
export function StatsOverlay(props: { interval?: number }): VNode {
  const player = usePlayer();
  const [stats, setStats] = useState(() => player.getStatsForNerds());
  useEffect(() => {
    const t = setInterval(() => setStats(player.getStatsForNerds()), props.interval || 1000);
    return () => clearInterval(t);
  }, [player]);
  const rows: Array<[string, string]> = [
    ['Engine', stats.engine],
    ['Video ID', stats.videoId],
    ['Viewport / Frames', `${stats.viewport} / ${stats.droppedFrames} dropped of ${stats.totalFrames}`],
    ['Current / Optimal Res', `${stats.resolution} / ${stats.quality}`],
    ['Volume', stats.volume],
    ['Codecs', stats.codecs],
    ['Connection Speed', stats.bandwidthKbps + ' Kbps'],
    ['Bitrate', stats.bitrateKbps + ' Kbps'],
    ['Buffer Health', stats.bufferHealth.toFixed(2) + ' s'],
    ['Live Latency', stats.liveLatency == null ? '-' : stats.liveLatency.toFixed(2) + ' s'],
    ['Speed', stats.playbackRate + 'x'],
    ['State', stats.state],
  ];
  return (
    <div className="kb-stats" aria-hidden="true">
      {rows.map(([k, v]) => (
        <div key={k} className="kb-stats__row">
          <span className="kb-stats__key">{k}</span>
          <span className="kb-stats__value">{v}</span>
        </div>
      ))}
    </div>
  );
}
StatsOverlay.displayName = 'StatsOverlay';

/**
 * "Up next" card for playlists and series. While only suggesting (near the
 * end) it is a small card; after the item ends it shows the auto-advance
 * countdown with Play now / Cancel.
 */
export function UpNextCard(props: { info: UpNextInfo; render?: (info: UpNextInfo) => Child }): VNode {
  const player = usePlayer();
  const strings = useStrings();
  const { info } = props;
  const src = info.source;
  const counting = info.countdown != null;
  return (
    <div className={['kb-upnext', { 'kb-upnext--countdown': counting }]} focusGroup={{ orientation: 'horizontal', trap: counting ? true : undefined }}>
      {props.render ? (
        props.render(info)
      ) : (
        <div className="kb-upnext__body">
          {src.poster ? <Image className="kb-upnext__poster" src={src.poster} alt="" /> : null}
          <div className="kb-upnext__text">
            <div className="kb-upnext__eyebrow">{counting ? strings.startsIn.replace('{s}', String(info.countdown)) : strings.upNext}</div>
            <div className="kb-upnext__title">{src.title || ''}</div>
            {src.subtitle ? <div className="kb-upnext__subtitle">{src.subtitle}</div> : null}
          </div>
        </div>
      )}
      <div className="kb-upnext__actions">
        <Button icon="next" label={strings.playNow} focusId="kb-upnext-play" autoFocus={counting} className="kb-upnext__play" onClick={() => player.playUpNext()} />
        <Button label={strings.cancel} focusId="kb-upnext-cancel" onClick={() => player.dismissUpNext()} />
      </div>
      {counting ? <div className="kb-upnext__bar" style={{ animationDuration: info.countdown + 's' }} /> : null}
    </div>
  );
}
UpNextCard.displayName = 'UpNextCard';

/** Fatal error message with Retry. */
export function ErrorPanel(props: { onRetry?: () => void; onBack?: () => void }): VNode | null {
  const player = usePlayer();
  const strings = useStrings();
  const err = useSignalValue(player.error);
  if (!err || !err.fatal) return null;
  return (
    <div className="kb-player-error" role="alert" focusGroup={{ orientation: 'horizontal', trap: true }}>
      <Icon name="info" size="3rem" />
      <div className="kb-player-error__title">{strings.errorTitle}</div>
      <div className="kb-player-error__message">{err.message}</div>
      <div className="kb-player-error__actions">
        {props.onRetry ? <Button label={strings.retry} autoFocus focusId="kb-error-retry" onClick={props.onRetry} /> : null}
        {props.onBack ? <Button label={strings.back} focusId="kb-error-back" onClick={props.onBack} /> : null}
      </div>
    </div>
  );
}
ErrorPanel.displayName = 'ErrorPanel';
