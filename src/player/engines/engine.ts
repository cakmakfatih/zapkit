import type { AudioTrack, CaptionTrack, PlayerErrorInfo, QualityLevel, TimeRange, VideoSource } from '../types';

/*
 * Playback engines. The Player owns the <video> element, state machine and UI
 * contract; an engine only gets media into the element:
 *
 *  - NativeEngine: progressive files and natively supported HLS / MPEG-TS.
 *  - DashEngine: MPEG-DASH over Media Source Extensions with ABR, live/DVR
 *    and EME (the kind of player large streaming apps use).
 *  - HlsJsEngine: adapter for an hls.js build supplied by the app.
 */

export interface EngineCallbacks {
  qualities(levels: QualityLevel[]): void;
  quality(level: QualityLevel | null): void;
  audioTracks(tracks: AudioTrack[]): void;
  audioTrack(track: AudioTrack | null): void;
  captionTracks(tracks: CaptionTrack[]): void;
  error(info: PlayerErrorInfo): void;
  liveEnded(): void;
  emsg(event: { schemeIdUri: string; value: string; time: number; duration: number; id: number; data: Uint8Array }): void;
}

export interface EngineStats {
  bandwidth: number;
  bitrate: number;
  codecs: string;
  liveLatency: number | null;
}

export interface Engine {
  readonly name: string;
  load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void>;
  destroy(): void;
  /** 'auto' re-enables adaptive switching. */
  setQuality(id: string | 'auto'): void;
  /** Limits adaptive switching to heights in [min, max] (0 = unbounded). */
  setQualityRange(minHeight: number, maxHeight: number): void;
  setAudioTrack(id: string): void;
  /** Returns WebVTT text for a manifest caption track, if the engine can fetch it. */
  loadCaptionTrack?(id: string): Promise<string>;
  isLive(): boolean;
  /** Seekable window (DVR) in media time. */
  seekableRange(): TimeRange | null;
  /** Live edge in media time, or null for VOD. */
  liveEdge(): number | null;
  /** Called by the player before it seeks so the engine can refill around `time`. */
  onSeek?(time: number): void;
  stats(): EngineStats;
}

export type EngineFactory = (source: VideoSource, video: HTMLVideoElement) => Engine | null;
