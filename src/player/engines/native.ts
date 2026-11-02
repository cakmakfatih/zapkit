import type { AudioTrack, CaptionTrack, QualityLevel, TimeRange, VideoSource } from '../types';
import type { Engine, EngineCallbacks, EngineStats } from './engine';

interface NativeAudioTrack {
  id: string;
  language: string;
  label: string;
  enabled: boolean;
  kind: string;
}
interface NativeAudioTrackList {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/**
 * Plays whatever the browser supports directly: MP4/WebM files, native HLS
 * (Safari, Tizen, webOS, VIDAA) and MPEG-TS on TVs that decode it. Audio
 * tracks use `video.audioTracks` and in-band text tracks `video.textTracks`
 * where the platform exposes them.
 */
export class NativeEngine implements Engine {
  readonly name = 'native';
  private video: HTMLVideoElement | null = null;
  private cleanups: Array<() => void> = [];

  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    this.video = video;
    video.src = source.url;
    if (startTime && startTime > 0) {
      const seek = () => {
        if (isFinite(video.duration) || video.seekable.length) video.currentTime = startTime;
      };
      video.addEventListener('loadedmetadata', seek, { once: true });
    }
    const onMeta = () => {
      if (video.videoHeight) {
        const level: QualityLevel = {
          id: 'native',
          width: video.videoWidth,
          height: video.videoHeight,
          bitrate: 0,
          label: video.videoHeight + 'p',
        };
        cb.qualities([level]);
        cb.quality(level);
      }
      this.syncAudio(cb);
      this.syncText(cb);
    };
    video.addEventListener('loadedmetadata', onMeta);
    this.cleanups.push(() => video.removeEventListener('loadedmetadata', onMeta));
    const audio = (video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
    if (audio && audio.addEventListener) {
      const onChange = () => this.syncAudio(cb);
      audio.addEventListener('addtrack', onChange);
      audio.addEventListener('change', onChange);
      this.cleanups.push(() => {
        audio.removeEventListener('addtrack', onChange);
        audio.removeEventListener('change', onChange);
      });
    }
    const text = video.textTracks;
    if (text && text.addEventListener) {
      const onText = () => this.syncText(cb);
      text.addEventListener('addtrack', onText);
      this.cleanups.push(() => text.removeEventListener('addtrack', onText));
    }
    video.load();
  }

  private syncAudio(cb: EngineCallbacks) {
    const list = this.video && (this.video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
    if (!list || !list.length) return;
    const tracks: AudioTrack[] = [];
    let active: AudioTrack | null = null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const track: AudioTrack = { id: t.id || String(i), lang: t.language || '', label: t.label || t.language || 'Audio ' + (i + 1), isDefault: t.kind === 'main' };
      tracks.push(track);
      if (t.enabled) active = track;
    }
    cb.audioTracks(tracks);
    cb.audioTrack(active);
  }

  private syncText(cb: EngineCallbacks) {
    const list = this.video && this.video.textTracks;
    if (!list) return;
    const tracks: CaptionTrack[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      // Sidecar tracks are rendered by the player itself and never added as <track>.
      tracks.push({ id: 'native:' + i, lang: t.language, label: t.label || t.language || 'Track ' + (i + 1), kind: t.kind, origin: 'native' });
    }
    if (tracks.length) cb.captionTracks(tracks);
  }

  setQuality(): void {}
  setQualityRange(): void {}

  setAudioTrack(id: string): void {
    const list = this.video && (this.video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].enabled = (list[i].id || String(i)) === id;
  }

  /** Native text tracks: cues are converted to WebVTT so the player renders them uniformly. */
  async loadCaptionTrack(id: string): Promise<string> {
    const index = Number(id.replace('native:', ''));
    const track = this.video && this.video.textTracks[index];
    if (!track) return 'WEBVTT\n';
    track.mode = 'hidden';
    await new Promise((r) => setTimeout(r, 300));
    const fmt = (t: number) => new Date(t * 1000).toISOString().slice(11, 23);
    let out = 'WEBVTT\n\n';
    const cues = track.cues;
    if (cues) {
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i] as VTTCue;
        out += `${fmt(c.startTime)} --> ${fmt(c.endTime)}\n${c.text}\n\n`;
      }
    }
    return out;
  }

  isLive(): boolean {
    return !!this.video && this.video.duration === Infinity;
  }

  seekableRange(): TimeRange | null {
    const v = this.video;
    if (!v || !v.seekable.length) return null;
    return { start: v.seekable.start(0), end: v.seekable.end(v.seekable.length - 1) };
  }

  liveEdge(): number | null {
    if (!this.isLive()) return null;
    const r = this.seekableRange();
    return r ? r.end : null;
  }

  stats(): EngineStats {
    return { bandwidth: 0, bitrate: 0, codecs: '', liveLatency: null };
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    const v = this.video;
    if (v) {
      v.removeAttribute('src');
      try {
        v.load();
      } catch {
        // ignore
      }
    }
    this.video = null;
  }
}

/** True when the browser can play HLS without MSE (Safari, most TV browsers). */
export function canPlayNativeHls(video: HTMLVideoElement): boolean {
  return !!(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'));
}
