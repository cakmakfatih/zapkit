/*
 * zapkit-tv/player — video playback for TV web apps.
 *
 *   import { Player, VideoPlayer, setHlsConstructor } from 'zapkit-tv/player';
 *   const player = new Player();
 *   render(<VideoPlayer player={player} onBack={...} />, root);
 *   player.loadPlaylist(episodes, 0);
 */

export { Player } from './player';
export type { PlayerOptions, UpNextInfo } from './player';
export * from './types';
export { Emitter } from './emitter';
export { loadPrefs, savePref, DEFAULT_CAPTION_SETTINGS } from './prefs';
export type { PlayerPrefs } from './prefs';
export { parseVtt, parseCueText, parseTimestamp, activeCues } from './captions/vtt';
export type { VttCue, VttNode } from './captions/vtt';
export { spriteStoryboard, vttStoryboard } from './storyboard';
export type { Storyboard, StoryboardFrame } from './storyboard';

export type { Engine, EngineCallbacks, EngineFactory, EngineStats } from './engines/engine';
export { NativeEngine, canPlayNativeHls } from './engines/native';
export { HlsJsEngine, setHlsConstructor, hasHlsJs } from './engines/hlsjs';
export type { HlsConstructor, HlsInstance } from './engines/hlsjs';
export { DashEngine } from './engines/dash/dash-engine';
export type { DashOptions } from './engines/dash/dash-engine';
export { parseMpd, parseDuration, fillTemplate, segmentIndexAt } from './engines/dash/mpd';
export type { Manifest, Representation, MediaSegment } from './engines/dash/mpd';
export { BandwidthEstimator, chooseLevel } from './engines/dash/abr';
export { parseSidx, parseEmsg } from './engines/dash/boxes';
export { DrmController, KEY_SYSTEMS } from './engines/dash/drm';

export { PlayerContext, usePlayer, StringsContext, useStrings, DEFAULT_STRINGS, formatTime } from './ui/context';
export type { PlayerStrings } from './ui/context';
export {
  PlayerSurface,
  CaptionsLayer,
  TimeCounter,
  LiveBadge,
  ProgressBar,
  TransportControls,
  MetadataSection,
  ToggleIndicator,
  BufferingIndicator,
} from './ui/controls';
export type { ProgressBarProps, TransportControlsProps } from './ui/controls';
export { SettingsPanel, StatsOverlay, UpNextCard, ErrorPanel } from './ui/panels';
export type { SettingsSection } from './ui/panels';
export { VideoPlayer, usePlayerKeys } from './ui/video-player';
export type { VideoPlayerProps } from './ui/video-player';
