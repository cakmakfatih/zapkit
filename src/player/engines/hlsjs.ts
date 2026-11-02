import type { AudioTrack, CaptionTrack, QualityLevel, TimeRange, VideoSource } from '../types';
import type { Engine, EngineCallbacks, EngineStats } from './engine';

/*
 * Adapter for hls.js. The SDK does not bundle hls.js; apps that need HLS over
 * MSE pass the constructor once: `setHlsConstructor(Hls)`. The player then
 * uses this engine for .m3u8 sources when the browser has no native HLS.
 */

// Structural subset of the hls.js API used here.
interface HlsLevel {
  height: number;
  width: number;
  bitrate: number;
  codecSet?: string;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: number;
}
interface HlsMediaTrack {
  id: number;
  name: string;
  lang?: string;
  default?: boolean;
  url?: string;
}
export interface HlsInstance {
  levels: HlsLevel[];
  currentLevel: number;
  nextLevel: number;
  autoLevelEnabled: boolean;
  autoLevelCapping: number;
  audioTracks: HlsMediaTrack[];
  audioTrack: number;
  subtitleTracks: HlsMediaTrack[];
  subtitleTrack: number;
  subtitleDisplay: boolean;
  bandwidthEstimate: number;
  liveSyncPosition: number | null;
  latency?: number;
  loadSource(url: string): void;
  attachMedia(video: HTMLMediaElement): void;
  startLoad(position?: number): void;
  recoverMediaError(): void;
  destroy(): void;
  on(event: string, fn: (event: string, data: any) => void): void;
}
export interface HlsConstructor {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
  ErrorTypes: Record<string, string>;
}

let HlsCtor: HlsConstructor | null = null;
let hlsConfig: Record<string, unknown> = {};

/** Registers hls.js (and optional config) for HLS playback over MSE. */
export function setHlsConstructor(ctor: HlsConstructor, config: Record<string, unknown> = {}): void {
  HlsCtor = ctor;
  hlsConfig = config;
}

export function hasHlsJs(): boolean {
  return !!HlsCtor && HlsCtor.isSupported();
}

export class HlsJsEngine implements Engine {
  readonly name = 'hls.js';
  private hls: HlsInstance | null = null;
  private video: HTMLVideoElement | null = null;
  private live = false;
  private levels: QualityLevel[] = [];
  private mediaRecoveries = 0;
  private networkRetries = 0;

  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    if (!HlsCtor) throw new Error('hls.js is not registered (call setHlsConstructor)');
    const Hls = HlsCtor;
    const E = Hls.Events;
    const headers = source.headers;
    const hls = new Hls({
      startPosition: startTime && startTime > 0 ? startTime : -1,
      capLevelToPlayerSize: true,
      ...(headers
        ? {
            xhrSetup: (xhr: XMLHttpRequest) => {
              for (const k in headers) xhr.setRequestHeader(k, headers[k]);
            },
          }
        : {}),
      ...hlsConfig,
    });
    this.hls = hls;
    this.video = video;

    hls.on(E.MANIFEST_PARSED, () => {
      this.levels = hls.levels.map((l, i) => ({
        id: String(i),
        width: l.width,
        height: l.height,
        bitrate: l.bitrate,
        label: (l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + 'k') + (l.frameRate && l.frameRate > 30 ? Math.round(l.frameRate) : ''),
        codecs: l.codecSet || [l.videoCodec, l.audioCodec].filter(Boolean).join(','),
        frameRate: l.frameRate,
      }));
      cb.qualities(this.levels);
    });
    hls.on(E.LEVEL_SWITCHED, (_e, data: { level: number }) => cb.quality(this.levels[data.level] || null));
    hls.on(E.LEVEL_LOADED, (_e, data: { details: { live: boolean } }) => {
      this.live = !!data.details.live;
    });
    const audio = () => {
      const tracks: AudioTrack[] = hls.audioTracks.map((t) => ({ id: String(t.id), lang: t.lang || '', label: t.name || t.lang || 'Audio', isDefault: t.default }));
      cb.audioTracks(tracks);
      cb.audioTrack(tracks.find((t) => t.id === String(hls.audioTrack)) || null);
    };
    hls.on(E.AUDIO_TRACKS_UPDATED, audio);
    hls.on(E.AUDIO_TRACK_SWITCHED, audio);
    hls.on(E.SUBTITLE_TRACKS_UPDATED, () => {
      hls.subtitleDisplay = false; // the player renders captions itself
      const tracks: CaptionTrack[] = hls.subtitleTracks.map((t) => ({
        id: 'hls:' + t.id,
        lang: t.lang || '',
        label: t.name || t.lang || 'Subtitles',
        kind: 'subtitles',
        origin: 'manifest',
      }));
      cb.captionTracks(tracks);
    });
    hls.on(E.ERROR, (_e, data: { fatal: boolean; type: string; details: string; response?: { code: number } }) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaRecoveries < 2) {
        this.mediaRecoveries++;
        hls.recoverMediaError();
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && this.networkRetries < 3) {
        this.networkRetries++;
        setTimeout(() => this.hls === hls && hls.startLoad(), 1000 * this.networkRetries);
        return;
      }
      cb.error({
        code: data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'decode' : 'unknown',
        message: 'hls.js: ' + data.details,
        fatal: true,
        status: data.response && data.response.code,
      });
    });
    hls.on(E.FRAG_LOADED, () => {
      this.networkRetries = 0;
    });
    hls.attachMedia(video);
    hls.loadSource(source.url);
  }

  setQuality(id: string): void {
    if (!this.hls) return;
    if (id === 'auto') {
      this.hls.currentLevel = -1;
      return;
    }
    this.hls.currentLevel = Number(id);
  }

  setQualityRange(_min: number, max: number): void {
    if (!this.hls) return;
    if (!max) {
      this.hls.autoLevelCapping = -1;
      return;
    }
    let cap = -1;
    this.levels.forEach((l, i) => {
      if (l.height <= max && (cap < 0 || l.height >= this.levels[cap].height)) cap = i;
    });
    this.hls.autoLevelCapping = cap;
  }

  setAudioTrack(id: string): void {
    if (this.hls) this.hls.audioTrack = Number(id);
  }

  async loadCaptionTrack(id: string): Promise<string> {
    const hls = this.hls;
    if (!hls) return 'WEBVTT\n';
    const index = Number(id.replace('hls:', ''));
    hls.subtitleTrack = index;
    hls.subtitleDisplay = false;
    // hls.js feeds subtitle cues into a hidden TextTrack; read them back as VTT.
    await new Promise((r) => setTimeout(r, 1500));
    const v = this.video;
    if (!v) return 'WEBVTT\n';
    const fmt = (t: number) => new Date(t * 1000).toISOString().slice(11, 23);
    let out = 'WEBVTT\n\n';
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      if (t.mode === 'disabled') continue;
      const cues = t.cues;
      if (!cues) continue;
      for (let j = 0; j < cues.length; j++) {
        const c = cues[j] as VTTCue;
        out += `${fmt(c.startTime)} --> ${fmt(c.endTime)}\n${c.text}\n\n`;
      }
    }
    return out;
  }

  isLive(): boolean {
    return this.live;
  }

  seekableRange(): TimeRange | null {
    const v = this.video;
    if (!v || !v.seekable.length) return null;
    return { start: v.seekable.start(0), end: v.seekable.end(v.seekable.length - 1) };
  }

  liveEdge(): number | null {
    if (!this.live || !this.hls) return null;
    return this.hls.liveSyncPosition ?? (this.seekableRange()?.end ?? null);
  }

  stats(): EngineStats {
    const hls = this.hls;
    const level = hls && hls.levels[hls.currentLevel];
    return {
      bandwidth: hls ? hls.bandwidthEstimate : 0,
      bitrate: level ? level.bitrate : 0,
      codecs: level ? level.codecSet || [level.videoCodec, level.audioCodec].filter(Boolean).join(',') : '',
      liveLatency: hls && this.live && hls.latency != null ? hls.latency : null,
    };
  }

  destroy(): void {
    if (this.hls) this.hls.destroy();
    this.hls = null;
    this.video = null;
  }
}
