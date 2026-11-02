/*
 * Player types. State numbers and event names follow the IFrame-style player API
 * (onStateChange with -1/0/1/2/3/5, onPlaybackQualityChange,
 * onCueRangeEnter, ...), so code written against that API reads the same.
 */

export enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

export type StreamType = 'auto' | 'dash' | 'hls' | 'progressive';
export type DrmSystem = 'widevine' | 'playready' | 'clearkey' | 'fairplay';

export interface DrmConfig {
  system?: DrmSystem;
  licenseUrl: string;
  headers?: Record<string, string>;
  /** FairPlay / some Widevine setups need a server certificate. */
  certificateUrl?: string;
  /** ClearKey keys (kid hex -> key hex) instead of a license server. */
  clearKeys?: Record<string, string>;
  /** Wraps the license request body (e.g. JSON envelopes). */
  transformRequest?: (body: ArrayBuffer) => BodyInit;
  /** Unwraps the license response. */
  transformResponse?: (body: ArrayBuffer) => ArrayBuffer;
  /** EME robustness strings, e.g. 'SW_SECURE_CRYPTO'. */
  videoRobustness?: string;
  audioRobustness?: string;
}

export interface CaptionSource {
  id?: string;
  url: string;
  lang: string;
  label?: string;
  kind?: 'subtitles' | 'captions';
  format?: 'vtt';
}

export interface StoryboardSpec {
  /** Sprite sheet URL template; `$M` is replaced by the sheet index. */
  url: string;
  /** Frame size in px. */
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Seconds between frames. */
  interval: number;
  /** Total number of frames. */
  count?: number;
}

export interface VideoSource {
  url: string;
  type?: StreamType;
  /** Stable id (used for prefs, stats and the playlist). */
  id?: string;
  title?: string;
  subtitle?: string;
  poster?: string;
  /** Start position in seconds (ignored for live unless `live: 'dvr'`). */
  startTime?: number;
  drm?: DrmConfig | DrmConfig[];
  captions?: CaptionSource[];
  /** Sprite storyboard or a WebVTT thumbnails URL (`#xywh=` cues). */
  storyboard?: StoryboardSpec | string;
  /** Extra data passed through to UI (channel name, logo, ...). */
  metadata?: Record<string, unknown>;
  /** Extra request headers for manifest/segment requests (DASH engine). */
  headers?: Record<string, string>;
  /** Live: treat as live even before the engine can tell (IPTV channels). */
  live?: boolean;
  /**
   * Alternative URLs tried in order when this one fails before playback
   * starts (e.g. an IPTV channel offered as .m3u8 and .ts).
   */
  fallbacks?: Array<{ url: string; type?: StreamType }>;
  /** Seconds before the end where "Up next" appears (e.g. credits start). */
  upNextAt?: number;
}

export interface QualityLevel {
  id: string;
  height: number;
  width: number;
  bitrate: number;
  /** e.g. "1080p", "720p60". */
  label: string;
  codecs?: string;
  frameRate?: number;
}

export interface AudioTrack {
  id: string;
  lang: string;
  label: string;
  codecs?: string;
  channels?: number;
  isDefault?: boolean;
}

export interface CaptionTrack {
  id: string;
  lang: string;
  label: string;
  kind: 'subtitles' | 'captions';
  /** 'sidecar' tracks come from VideoSource.captions, 'manifest' from DASH/HLS. */
  origin: 'sidecar' | 'manifest' | 'native';
  url?: string;
}

export interface CaptionSettings {
  /** 0.5 .. 3, relative to the default size. */
  fontScale: number;
  color: string;
  background: string;
  backgroundOpacity: number;
  edge: 'none' | 'outline' | 'drop-shadow' | 'raised' | 'depressed';
  fontFamily: string;
  windowColor: string;
  windowOpacity: number;
}

export interface CueRange {
  id: string;
  start: number;
  end: number;
  namespace?: string;
  data?: unknown;
}

export interface TimeRange {
  start: number;
  end: number;
}

export type LiveMode = 'none' | 'live' | 'dvr' | 'window';

export interface PlayerErrorInfo {
  /** Stable code: 'network', 'decode', 'unsupported', 'drm', 'manifest', 'aborted', 'unknown'. */
  code: 'network' | 'decode' | 'unsupported' | 'drm' | 'manifest' | 'aborted' | 'unknown';
  message: string;
  fatal: boolean;
  /** HTTP status for network errors. */
  status?: number;
  cause?: unknown;
}

export interface PlayerStats {
  engine: string;
  videoId: string;
  url: string;
  resolution: string;
  viewport: string;
  quality: string;
  bitrateKbps: number;
  bandwidthKbps: number;
  bufferHealth: number;
  droppedFrames: number;
  totalFrames: number;
  codecs: string;
  liveLatency: number | null;
  volume: string;
  playbackRate: number;
  state: string;
}

/** Events emitted by Player (names match the IFrame-style player API). */
export interface PlayerEvents {
  onReady: void;
  onStateChange: PlayerState;
  onError: PlayerErrorInfo;
  onPlaybackQualityChange: QualityLevel | null;
  onAvailableQualityLevelsChange: QualityLevel[];
  onPlaybackRateChange: number;
  onVolumeChange: { volume: number; muted: boolean };
  onCaptionsTrackListChanged: CaptionTrack[];
  onCaptionsChange: CaptionTrack | null;
  onAudioTracksChange: AudioTrack[];
  onAudioTrackChange: AudioTrack | null;
  onCueRangeEnter: CueRange;
  onCueRangeExit: CueRange;
  onLoadProgress: number;
  onVideoProgress: number;
  onVideoDataChange: VideoSource | null;
  onSeek: { from: number; to: number };
  onShowControls: void;
  onHideControls: void;
  onLiveMediaEnded: void;
  onPlaylistChange: { index: number; length: number };
  onSqueezebackChange: SqueezebackRect | null;
  onEmsg: { schemeIdUri: string; value: string; time: number; duration: number; id: number; data: Uint8Array };
}

/** Region (fractions of the player, 0..1) the video shrinks into. */
export interface SqueezebackRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
