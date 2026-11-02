import type { AudioTrack, DrmConfig, QualityLevel, TimeRange, VideoSource } from '../../types';
import type { Engine, EngineCallbacks, EngineStats } from '../engine';
import { BandwidthEstimator, chooseLevel } from './abr';
import { parseEmsg, parseSidx } from './boxes';
import { BufferQueue } from './buffer';
import { DrmController } from './drm';
import { HttpError, loadBytes, loadText } from './loader';
import { mimeOf, parseMpd, segmentIndexAt, type InitSegment, type Manifest, type MediaSegment, type Representation } from './mpd';

/*
 * MPEG-DASH over Media Source Extensions.
 *
 * One stream controller per content type (video, audio) keeps
 * `bufferGoal` seconds ahead of the playhead: pick representation (ABR for
 * video, chosen track for audio), append its init segment when it changes,
 * then append media segments in order. Seeks reset the position; live
 * manifests are refreshed on minimumUpdatePeriod and the DVR window is the
 * union of available segments.
 */

export interface DashOptions {
  bufferGoal?: number;
  /** Back buffer kept behind the playhead (seconds). */
  backBuffer?: number;
  /** Live: target distance from the live edge (default: suggestedPresentationDelay or 3 segments). */
  liveDelay?: number;
  defaultBandwidth?: number;
  preferredAudioLanguage?: string;
}

interface SegmentWithExtras extends MediaSegment {
  timestampOffset?: number;
  init?: InitSegment | null;
}

class StreamController {
  rep: Representation | null = null;
  queue: BufferQueue | null = null;
  next = -1;
  appendedInit: string | null = null;
  loading: AbortController | null = null;
  ended = false;
  failures = 0;

  constructor(public type: 'video' | 'audio') {}
}

export class DashEngine implements Engine {
  readonly name = 'dash';
  private video: HTMLVideoElement | null = null;
  private ms: MediaSource | null = null;
  private manifest: Manifest | null = null;
  private manifestUrl = '';
  private source: VideoSource | null = null;
  private cb: EngineCallbacks | null = null;
  private streams: StreamController[] = [];
  private abr: BandwidthEstimator;
  private videoReps: Representation[] = [];
  private audioReps: Representation[] = [];
  private textReps: Representation[] = [];
  private manualQuality: string | null = null;
  private range: { min: number; max: number } = { min: 0, max: 0 };
  private audioLang: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private drm: DrmController | null = null;
  private destroyed = false;
  private opts: Required<Omit<DashOptions, 'preferredAudioLanguage' | 'liveDelay'>> & DashOptions;
  private seenEmsg = new Set<string>();

  constructor(opts: DashOptions = {}) {
    this.opts = { bufferGoal: 30, backBuffer: 30, defaultBandwidth: 1_500_000, ...opts };
    this.abr = new BandwidthEstimator(this.opts.defaultBandwidth);
    this.audioLang = opts.preferredAudioLanguage || null;
  }

  async load(video: HTMLVideoElement, source: VideoSource, startTime: number | undefined, cb: EngineCallbacks): Promise<void> {
    if (typeof MediaSource === 'undefined') throw Object.assign(new Error('MediaSource is not supported'), { code: 'unsupported' });
    this.video = video;
    this.source = source;
    this.cb = cb;
    const { text, url } = await loadText(source.url, { headers: source.headers });
    this.manifestUrl = url;
    this.manifest = parseMpd(text, url);
    await this.resolveSidx(this.manifest);
    this.indexTracks();

    const ms = new MediaSource();
    this.ms = ms;
    video.src = URL.createObjectURL(ms);
    await new Promise<void>((r) => ms.addEventListener('sourceopen', () => r(), { once: true }));
    URL.revokeObjectURL(video.src);
    if (this.destroyed) return;

    const v = this.pickVideo(-1);
    const a = this.pickAudio();
    const drm = source.drm ? (Array.isArray(source.drm) ? source.drm : [source.drm]) : [];
    const protection = (v ? v.protection : []).concat(a ? a.protection : []);
    if (protection.length || drm.length) await this.setupDrm(video, drm, protection, v, a);

    for (const rep of [v, a]) {
      if (!rep) continue;
      if (!MediaSource.isTypeSupported(mimeOf(rep))) continue;
      const sc = new StreamController(rep.contentType as 'video' | 'audio');
      sc.rep = rep;
      sc.queue = new BufferQueue(ms, mimeOf(rep), video);
      this.streams.push(sc);
    }
    if (!this.streams.length) throw Object.assign(new Error('No playable DASH representation'), { code: 'unsupported' });

    if (this.manifest.type === 'static' && this.manifest.duration) ms.duration = this.manifest.duration;
    else if (this.manifest.type === 'dynamic') this.scheduleRefresh();

    let start = startTime && startTime > 0 ? startTime : 0;
    if (this.manifest.type === 'dynamic' && !(startTime && startTime > 0)) start = this.liveStart();
    else if (this.manifest.type === 'dynamic') start = Math.max(this.seekableRange()!.start, start);
    this.seekStreams(start);
    if (start) video.currentTime = start;
    this.timer = setInterval(() => this.tick(), 200);
    this.tick();
  }

  // ---- track selection -------------------------------------------------

  private indexTracks() {
    const m = this.manifest!;
    const playable = (r: Representation) => typeof MediaSource === 'undefined' || MediaSource.isTypeSupported(mimeOf(r));
    this.videoReps = m.video.filter(playable).sort((x, y) => x.bandwidth - y.bandwidth);
    this.audioReps = m.audio.filter(playable).sort((x, y) => x.bandwidth - y.bandwidth);
    this.textReps = m.text;
    const cb = this.cb!;
    cb.qualities(this.videoReps.map(levelOf));
    const tracks = this.audioTracks();
    cb.audioTracks(tracks);
    cb.captionTracks(
      this.textReps.map((r, i) => ({ id: 'dash:' + i, lang: r.lang, label: r.label || r.lang || 'Subtitles', kind: r.roles.includes('caption') ? 'captions' : 'subtitles', origin: 'manifest', url: r.textUrl })),
    );
  }

  private audioTracks(): AudioTrack[] {
    const seen = new Map<string, AudioTrack>();
    for (const r of this.audioReps) {
      const key = r.lang + '|' + r.label + '|' + r.adaptationIndex;
      if (seen.has(key)) continue;
      seen.set(key, { id: key, lang: r.lang, label: r.label || r.lang || 'Audio', codecs: r.codecs, channels: r.audioChannels, isDefault: r.roles.includes('main') });
    }
    return Array.from(seen.values());
  }

  private pickAudio(): Representation | null {
    if (!this.audioReps.length) return null;
    const tracks = this.audioTracks();
    const want =
      (this.audioLang && tracks.find((t) => t.id === this.audioLang || t.lang === this.audioLang)) || tracks.find((t) => t.isDefault) || tracks[0];
    const reps = this.audioReps.filter((r) => r.lang + '|' + r.label + '|' + r.adaptationIndex === want.id);
    // Audio: highest bitrate within a quarter of the bandwidth estimate.
    const est = this.abr.estimate() / 4;
    let pick = reps[0];
    for (const r of reps) if (r.bandwidth <= est) pick = r;
    this.cb!.audioTrack(want);
    return pick;
  }

  private pickVideo(current: number): Representation | null {
    const reps = this.videoReps;
    if (!reps.length) return null;
    if (this.manualQuality) return reps.find((r) => r.id === this.manualQuality) || reps[0];
    const buffer = this.video ? this.bufferAhead('video') : 0;
    const idx = chooseLevel(reps, this.abr.estimate(), buffer, current, { minHeight: this.range.min, maxHeight: this.range.max });
    return reps[idx];
  }

  private bufferAhead(type: 'video' | 'audio'): number {
    const sc = this.streams.find((s) => s.type === type);
    return sc && sc.queue && this.video ? sc.queue.bufferedAhead(this.video.currentTime) : 0;
  }

  // ---- loading loop ----------------------------------------------------

  private tick() {
    if (this.destroyed || !this.video || !this.ms || this.ms.readyState !== 'open') return;
    const t = this.video.currentTime;
    for (const sc of this.streams) this.fill(sc, t);
    this.maybeEnd();
  }

  private async fill(sc: StreamController, time: number) {
    if (sc.loading || !sc.queue || sc.queue.updating || sc.ended) return;
    if (sc.queue.bufferedAhead(time) >= this.opts.bufferGoal) {
      this.trimBackBuffer(sc, time);
      return;
    }
    // Re-evaluate quality at segment boundaries.
    if (sc.type === 'video') {
      const cur = this.videoReps.indexOf(sc.rep!);
      const want = this.pickVideo(cur);
      if (want && want !== sc.rep) this.switchRep(sc, want);
    }
    const rep = sc.rep!;
    if (sc.next < 0) sc.next = Math.max(0, segmentIndexAt(rep.segments, time));
    const seg = rep.segments[sc.next] as SegmentWithExtras | undefined;
    if (!seg) {
      if (this.manifest!.type === 'static') sc.ended = true;
      return;
    }
    const ac = new AbortController();
    sc.loading = ac;
    try {
      const init = seg.init !== undefined ? seg.init : rep.init;
      const offset = seg.timestampOffset ?? rep.timestampOffset;
      const initKey = init ? init.url + (init.range ? '@' + init.range.start : '') + '#' + rep.id : null;
      if (init && sc.appendedInit !== initKey) {
        const data = await loadBytes(init.url, { range: init.range, headers: this.source!.headers, signal: ac.signal });
        await sc.queue.setTimestampOffset(offset);
        await sc.queue.append(data);
        sc.appendedInit = initKey;
      }
      const data = await loadBytes(seg.url, {
        range: seg.range,
        headers: this.source!.headers,
        signal: ac.signal,
        onSample: (ms, bytes) => this.abr.sample(ms, bytes),
      });
      if (ac.signal.aborted) return;
      this.handleEmsg(data, seg.start);
      await sc.queue.setTimestampOffset(offset);
      await sc.queue.append(data);
      sc.next++;
      sc.failures = 0;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      sc.failures++;
      // Live segments can 404 briefly at the edge: wait for the next refresh.
      if (e instanceof HttpError && e.status === 404 && this.manifest!.type === 'dynamic' && sc.failures < 10) return;
      if (sc.failures >= 3) {
        this.cb!.error({ code: 'network', message: (e as Error).message, fatal: true, status: e instanceof HttpError ? e.status : undefined, cause: e });
        sc.ended = true;
      } else if (sc.type === 'video' && this.videoReps.indexOf(sc.rep!) > 0) {
        // Retry the same segment on a lower level.
        this.switchRep(sc, this.videoReps[this.videoReps.indexOf(sc.rep!) - 1]);
      }
    } finally {
      if (sc.loading === ac) sc.loading = null;
    }
  }

  private switchRep(sc: StreamController, rep: Representation) {
    const prev = sc.rep;
    if (prev && mimeOf(prev) !== mimeOf(rep)) {
      if (!sc.queue!.changeType(mimeOf(rep))) return;
    }
    const time = prev && sc.next >= 0 && prev.segments[sc.next] ? prev.segments[sc.next].start : this.video!.currentTime;
    sc.rep = rep;
    sc.next = Math.max(0, segmentIndexAt(rep.segments, time + 0.01));
    if (sc.type === 'video') this.cb!.quality(levelOf(rep));
  }

  private trimBackBuffer(sc: StreamController, time: number) {
    const b = sc.queue!.safeBuffered();
    if (!b || !b.length) return;
    const start = b.start(0);
    if (time - start > this.opts.backBuffer + 10) sc.queue!.remove(start, time - this.opts.backBuffer);
  }

  private maybeEnd() {
    const ms = this.ms!;
    if (this.manifest!.type !== 'static' || ms.readyState !== 'open') return;
    if (this.streams.every((s) => s.ended && s.queue && !s.queue.updating)) {
      try {
        ms.endOfStream();
      } catch {
        // already ended
      }
    }
  }

  private seekStreams(time: number) {
    for (const sc of this.streams) {
      if (sc.loading) sc.loading.abort();
      sc.loading = null;
      sc.ended = false;
      sc.next = sc.rep ? Math.max(0, segmentIndexAt(sc.rep.segments, time)) : -1;
    }
  }

  onSeek(time: number): void {
    if (!this.ms) return;
    // Keep buffered data if the target is already buffered.
    const buffered = this.streams.every((s) => s.queue && s.queue.bufferedAhead(time) > 0.5);
    if (buffered) return;
    this.seekStreams(time);
    for (const sc of this.streams) if (sc.queue) sc.queue.abort();
    if (this.ms.readyState === 'ended') {
      // Re-opens the MediaSource for further appends.
      for (const sc of this.streams) sc.ended = false;
    }
    setTimeout(() => this.tick(), 0);
  }

  // ---- live ------------------------------------------------------------

  private liveDelay(): number {
    const m = this.manifest!;
    if (this.opts.liveDelay != null) return this.opts.liveDelay;
    if (m.suggestedPresentationDelay) return m.suggestedPresentationDelay;
    const seg = this.videoReps[0] || this.audioReps[0];
    const d = seg && seg.segments.length ? seg.segments[seg.segments.length - 1].end - seg.segments[seg.segments.length - 1].start : 4;
    return Math.max(m.minBufferTime, d * 3);
  }

  private liveStart(): number {
    const r = this.seekableRange();
    if (!r) return 0;
    return Math.max(r.start, r.end - this.liveDelay());
  }

  private scheduleRefresh() {
    const m = this.manifest!;
    const period = Math.max(1, m.minimumUpdatePeriod || 2);
    this.refreshTimer = setTimeout(() => this.refresh(), period * 1000);
  }

  private async refresh() {
    if (this.destroyed || !this.source) return;
    try {
      const { text, url } = await loadText(this.manifest!.location || this.manifestUrl, { headers: this.source.headers });
      const m = parseMpd(text, url);
      await this.resolveSidx(m);
      if (this.destroyed) return;
      // Keep segment positions by $Number$ / start time across refreshes.
      for (const sc of this.streams) {
        if (!sc.rep) continue;
        const list = sc.type === 'video' ? m.video : m.audio;
        const fresh = list.find((r) => r.id === sc.rep!.id);
        if (!fresh) continue;
        const nextSeg = sc.rep.segments[sc.next];
        const lastStart = nextSeg ? nextSeg.start : sc.rep.segments.length ? sc.rep.segments[sc.rep.segments.length - 1].end : 0;
        sc.rep.segments = fresh.segments;
        sc.next = fresh.segments.findIndex((s) => s.start >= lastStart - 0.05);
        if (sc.next < 0) sc.next = fresh.segments.length;
      }
      for (const kind of ['video', 'audio'] as const) {
        const reps = kind === 'video' ? this.videoReps : this.audioReps;
        for (const r of reps) {
          const fresh = m[kind].find((x) => x.id === r.id);
          if (fresh && !this.streams.some((s) => s.rep === r)) r.segments = fresh.segments;
        }
      }
      const prevType = this.manifest!.type;
      this.manifest = { ...m, video: this.manifest!.video, audio: this.manifest!.audio, text: this.manifest!.text };
      if (prevType === 'dynamic' && m.type === 'static') {
        // Live event ended; the manifest is now VOD.
        this.cb!.liveEnded();
        if (m.duration && this.ms) this.ms.duration = m.duration;
        return;
      }
    } catch {
      // keep playing what we have; try again later
    }
    this.scheduleRefresh();
  }

  // ---- misc ------------------------------------------------------------

  private async setupDrm(video: HTMLVideoElement, configs: DrmConfig[], protection: Representation['protection'], v: Representation | null, a: Representation | null) {
    if (!configs.length) {
      if (protection.length) throw Object.assign(new Error('Stream is encrypted but no DRM config was given'), { code: 'drm' });
      return;
    }
    this.drm = new DrmController((err) => this.cb!.error({ code: 'drm', message: err.message, fatal: true, cause: err }));
    const ok = await this.drm.init(video, configs, protection, v ? mimeOf(v) : '', a ? mimeOf(a) : '');
    if (!ok) throw Object.assign(new Error('No supported key system'), { code: 'drm' });
  }

  private async resolveSidx(m: Manifest) {
    const reps = m.video.concat(m.audio).filter((r) => r.sidx && !r.segments.length);
    await Promise.all(
      reps.map(async (r) => {
        const s = r.sidx!;
        const data = await loadBytes(s.url, { range: s.range, headers: this.source ? this.source.headers : undefined });
        r.segments = parseSidx(data, s.url, s.range.start, s.periodStart, s.pto);
      }),
    );
  }

  private handleEmsg(data: Uint8Array, segmentStart: number) {
    // Only scan the head of the segment: emsg boxes precede moof.
    const head = data.subarray(0, Math.min(data.length, 4096));
    if (head.indexOf(0x65) < 0) return;
    for (const e of parseEmsg(head, segmentStart)) {
      const key = e.schemeIdUri + '|' + e.id;
      if (this.seenEmsg.has(key)) continue;
      this.seenEmsg.add(key);
      this.cb!.emsg(e);
    }
  }

  setQuality(id: string): void {
    this.manualQuality = id === 'auto' ? null : id;
    const sc = this.streams.find((s) => s.type === 'video');
    if (!sc || !this.video) return;
    const rep = this.pickVideo(this.videoReps.indexOf(sc.rep!));
    if (rep && rep !== sc.rep) {
      this.switchRep(sc, rep);
      // Replace what is buffered ahead so the change is visible quickly.
      const t = this.video.currentTime;
      if (sc.loading) sc.loading.abort();
      sc.queue!.remove(t + 2, Infinity).then(() => {
        sc.next = Math.max(0, segmentIndexAt(rep.segments, t + 2));
      });
    }
  }

  setQualityRange(min: number, max: number): void {
    this.range = { min, max };
  }

  setAudioTrack(id: string): void {
    this.audioLang = id;
    const sc = this.streams.find((s) => s.type === 'audio');
    const rep = this.pickAudio();
    if (!sc || !rep || rep === sc.rep || !this.video) return;
    this.switchRep(sc, rep);
    const t = this.video.currentTime;
    if (sc.loading) sc.loading.abort();
    sc.queue!.remove(t + 1, Infinity).then(() => {
      sc.next = Math.max(0, segmentIndexAt(rep.segments, t + 1));
      sc.appendedInit = null;
    });
  }

  async loadCaptionTrack(id: string): Promise<string> {
    const r = this.textReps[Number(id.replace('dash:', ''))];
    if (!r || !r.textUrl) throw new Error('Caption track has no WebVTT URL');
    return (await loadText(r.textUrl, { headers: this.source ? this.source.headers : undefined })).text;
  }

  isLive(): boolean {
    return !!this.manifest && this.manifest.type === 'dynamic';
  }

  seekableRange(): TimeRange | null {
    const m = this.manifest;
    if (!m) return null;
    const reps = this.streams.length ? this.streams.map((s) => s.rep!) : this.videoReps.concat(this.audioReps).slice(0, 1);
    let start = 0;
    let end = Infinity;
    for (const r of reps) {
      if (!r || !r.segments.length) continue;
      start = Math.max(start, r.segments[0].start);
      end = Math.min(end, r.segments[r.segments.length - 1].end);
    }
    if (!isFinite(end)) end = m.duration || 0;
    return { start, end };
  }

  liveEdge(): number | null {
    if (!this.isLive()) return null;
    const r = this.seekableRange();
    return r ? r.end - this.liveDelay() : null;
  }

  stats(): EngineStats {
    const v = this.streams.find((s) => s.type === 'video');
    const a = this.streams.find((s) => s.type === 'audio');
    const edge = this.liveEdge();
    return {
      bandwidth: this.abr.estimate(),
      bitrate: (v && v.rep ? v.rep.bandwidth : 0) + (a && a.rep ? a.rep.bandwidth : 0),
      codecs: [v && v.rep && v.rep.codecs, a && a.rep && a.rep.codecs].filter(Boolean).join(' / '),
      liveLatency: edge != null && this.video ? Math.max(0, this.seekableRange()!.end - this.video.currentTime) : null,
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const sc of this.streams) {
      if (sc.loading) sc.loading.abort();
      if (sc.queue) sc.queue.destroy();
    }
    this.streams = [];
    if (this.drm) this.drm.destroy();
    if (this.video) {
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch {
        // ignore
      }
    }
    this.video = null;
    this.ms = null;
  }
}

function levelOf(r: Representation): QualityLevel {
  const fps = r.frameRate && r.frameRate > 30 ? String(Math.round(r.frameRate)) : '';
  return { id: r.id, width: r.width, height: r.height, bitrate: r.bandwidth, label: (r.height ? r.height + 'p' : Math.round(r.bandwidth / 1000) + 'k') + fps, codecs: r.codecs, frameRate: r.frameRate };
}

