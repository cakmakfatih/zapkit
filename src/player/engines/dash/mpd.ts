/*
 * MPEG-DASH MPD parser.
 *
 * Covers what TV DASH players actually meet: static and dynamic manifests,
 * multiple periods, SegmentTemplate ($Number$ / $Time$ / $Bandwidth$ /
 * $RepresentationID$, with or without SegmentTimeline), SegmentList,
 * SegmentBase + sidx (resolved later by the engine), BaseURL inheritance,
 * ContentProtection with cenc:pssh, Role/Label/lang and text AdaptationSets
 * pointing at a single WebVTT file.
 */

export interface ByteRange {
  start: number;
  end: number;
}

export interface MediaSegment {
  url: string;
  /** Presentation time (seconds, period start included). */
  start: number;
  end: number;
  range?: ByteRange;
  /** Template $Number$ (used to keep position across live refreshes). */
  number?: number;
}

export interface InitSegment {
  url: string;
  range?: ByteRange;
}

export type ContentType = 'video' | 'audio' | 'text';

export interface ProtectionInfo {
  schemeIdUri: string;
  /** Base64 PSSH box from cenc:pssh, when present. */
  pssh?: string;
  defaultKid?: string;
}

export interface Representation {
  id: string;
  contentType: ContentType;
  mimeType: string;
  codecs: string;
  bandwidth: number;
  width: number;
  height: number;
  frameRate?: number;
  audioChannels?: number;
  lang: string;
  label: string;
  roles: string[];
  adaptationIndex: number;
  protection: ProtectionInfo[];
  init: InitSegment | null;
  segments: MediaSegment[];
  /** SegmentBase: the index (sidx) still has to be fetched. */
  sidx?: { url: string; range: ByteRange; timescale: number; periodStart: number; pto: number };
  /** Seconds to add to media timestamps (period start − presentationTimeOffset). */
  timestampOffset: number;
  /** Text tracks: URL of a single subtitle file. */
  textUrl?: string;
}

export interface Manifest {
  type: 'static' | 'dynamic';
  duration: number;
  minBufferTime: number;
  availabilityStartTime: number;
  publishTime: number;
  timeShiftBufferDepth: number;
  suggestedPresentationDelay: number;
  minimumUpdatePeriod: number;
  /** Representations of all periods, already concatenated per track. */
  video: Representation[];
  audio: Representation[];
  text: Representation[];
  /** Location element (for live refresh redirects). */
  location?: string;
}

/** ISO 8601 duration (PT1H2M3.5S, P1D...) to seconds. */
export function parseDuration(s: string | null | undefined): number {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  const n = (i: number) => (m[i] ? parseFloat(m[i]) : 0);
  return n(1) * 31536000 + n(2) * 2592000 + n(3) * 86400 + n(4) * 3600 + n(5) * 60 + n(6);
}

function parseRange(s: string | null): ByteRange | undefined {
  if (!s) return undefined;
  const [a, b] = s.split('-').map(Number);
  return { start: a, end: b };
}

function children(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c);
  return out;
}

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}

function resolve(base: string, el: Element | null): string {
  const b = el && child(el, 'BaseURL');
  if (!b || !b.textContent) return base;
  return new URL(b.textContent.trim(), base).toString();
}

/** Fills a SegmentTemplate URL pattern ($$, %0Nd formats). */
export function fillTemplate(tpl: string, vars: { RepresentationID: string; Number?: number; Time?: number; Bandwidth: number }): string {
  return tpl.replace(/\$(RepresentationID|Number|Time|Bandwidth|SubNumber)(?:%0(\d+)d)?\$|\$\$/g, (whole, name: string, width: string) => {
    if (whole === '$$') return '$';
    const v = (vars as Record<string, unknown>)[name];
    if (v === undefined) return whole;
    const s = String(v);
    return width ? s.padStart(Number(width), '0') : s;
  });
}

interface Inherited {
  template: Element | null;
  list: Element | null;
  base: Element | null;
}

/** Attribute lookup across Representation → AdaptationSet → Period levels. */
function attr(name: string, ...els: Array<Element | null>): string | null {
  for (const e of els) if (e && e.hasAttribute(name)) return e.getAttribute(name);
  return null;
}

function contentTypeOf(mime: string, as: Element, codecs: string): ContentType | null {
  const ct = as.getAttribute('contentType') || mime.split('/')[0];
  if (ct === 'video' || ct === 'audio' || ct === 'text') return ct;
  if (mime === 'application/mp4' && /stpp|wvtt/.test(codecs)) return 'text';
  if (mime === 'text/vtt') return 'text';
  return null;
}

interface Clock {
  type: 'static' | 'dynamic';
  availabilityStartTime: number;
  timeShiftBufferDepth: number;
  now: number;
}

function buildSegments(
  rep: Element,
  as: Element,
  period: Element,
  inh: Inherited,
  baseUrl: string,
  periodStart: number,
  periodDuration: number,
  repId: string,
  bandwidth: number,
  clock: Clock,
): Pick<Representation, 'init' | 'segments' | 'sidx' | 'timestampOffset'> {
  const tpl = child(rep, 'SegmentTemplate') || child(as, 'SegmentTemplate') || inh.template;
  const list = child(rep, 'SegmentList') || child(as, 'SegmentList') || inh.list;
  const base = child(rep, 'SegmentBase') || child(as, 'SegmentBase') || inh.base;
  const tplLevels = [child(rep, 'SegmentTemplate'), child(as, 'SegmentTemplate'), child(period, 'SegmentTemplate')];
  const vars = { RepresentationID: repId, Bandwidth: bandwidth };
  const segments: MediaSegment[] = [];

  if (tpl) {
    const timescale = Number(attr('timescale', ...tplLevels) || 1);
    const pto = Number(attr('presentationTimeOffset', ...tplLevels) || 0);
    const startNumber = Number(attr('startNumber', ...tplLevels) ?? 1);
    const media = attr('media', ...tplLevels) || '';
    const initTpl = attr('initialization', ...tplLevels);
    const timestampOffset = periodStart - pto / timescale;
    const init = initTpl ? { url: new URL(fillTemplate(initTpl, vars), baseUrl).toString() } : null;
    const timelineEl = tplLevels.map((t) => child(t, 'SegmentTimeline')).find(Boolean);
    if (timelineEl) {
      let t = 0;
      let num = startNumber;
      const entries = children(timelineEl, 'S');
      entries.forEach((s, i) => {
        if (s.hasAttribute('t')) t = Number(s.getAttribute('t'));
        const d = Number(s.getAttribute('d'));
        let r = Number(s.getAttribute('r') || 0);
        if (r < 0) {
          // Repeat until the next S@t or the period end.
          const next = entries[i + 1];
          const endT = next && next.hasAttribute('t') ? Number(next.getAttribute('t')) : periodDuration ? pto + periodDuration * timescale : clock.type === 'dynamic' ? pto + (clock.now - clock.availabilityStartTime - periodStart) * timescale : t + d;
          r = Math.max(0, Math.ceil((endT - t) / d) - 1);
        }
        for (let k = 0; k <= r; k++) {
          segments.push({
            url: new URL(fillTemplate(media, { ...vars, Number: num, Time: t }), baseUrl).toString(),
            start: periodStart + (t - pto) / timescale,
            end: periodStart + (t + d - pto) / timescale,
            number: num,
          });
          t += d;
          num++;
        }
      });
    } else {
      const dur = Number(attr('duration', ...tplLevels) || 0) / timescale;
      if (dur > 0) {
        let first = startNumber;
        let last: number;
        if (clock.type === 'dynamic') {
          const elapsed = clock.now - clock.availabilityStartTime - periodStart;
          const newest = startNumber + Math.floor(elapsed / dur) - 1;
          const depth = clock.timeShiftBufferDepth || 60;
          first = Math.max(startNumber, newest - Math.ceil(depth / dur) + 1);
          last = newest;
        } else {
          last = startNumber + Math.ceil(periodDuration / dur) - 1;
        }
        for (let n = first; n <= last; n++) {
          const idx = n - startNumber;
          segments.push({
            url: new URL(fillTemplate(media, { ...vars, Number: n, Time: Math.round(idx * dur * timescale + pto) }), baseUrl).toString(),
            start: periodStart + idx * dur,
            end: periodStart + Math.min((idx + 1) * dur, periodDuration || Infinity),
            number: n,
          });
        }
      }
    }
    return { init, segments, timestampOffset };
  }

  if (list) {
    const timescale = Number(list.getAttribute('timescale') || 1);
    const dur = Number(list.getAttribute('duration') || 0) / timescale;
    const pto = Number(list.getAttribute('presentationTimeOffset') || 0);
    const initEl = child(list, 'Initialization');
    const init = initEl
      ? { url: new URL(initEl.getAttribute('sourceURL') || '', baseUrl).toString(), range: parseRange(initEl.getAttribute('range')) }
      : null;
    children(list, 'SegmentURL').forEach((s, i) => {
      segments.push({
        url: new URL(s.getAttribute('media') || '', baseUrl).toString(),
        range: parseRange(s.getAttribute('mediaRange')),
        start: periodStart + i * dur,
        end: periodStart + (i + 1) * dur,
      });
    });
    return { init, segments, timestampOffset: periodStart - pto / timescale };
  }

  if (base) {
    const timescale = Number(base.getAttribute('timescale') || 1);
    const pto = Number(base.getAttribute('presentationTimeOffset') || 0);
    const initEl = child(base, 'Initialization');
    const indexRange = parseRange(base.getAttribute('indexRange'));
    const init = initEl
      ? { url: initEl.getAttribute('sourceURL') ? new URL(initEl.getAttribute('sourceURL')!, baseUrl).toString() : baseUrl, range: parseRange(initEl.getAttribute('range')) }
      : null;
    return {
      init,
      segments,
      sidx: indexRange ? { url: baseUrl, range: indexRange, timescale, periodStart, pto } : undefined,
      timestampOffset: periodStart - pto / timescale,
    };
  }

  // Single-segment representation (BaseURL only).
  return { init: null, segments: [{ url: baseUrl, start: periodStart, end: periodStart + (periodDuration || Infinity) }], timestampOffset: periodStart };
}

export function parseMpd(xml: string, manifestUrl: string, now = Date.now() / 1000): Manifest {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const mpd = doc.documentElement;
  if (!mpd || mpd.localName !== 'MPD') throw new Error('Not an MPD document');
  const type = mpd.getAttribute('type') === 'dynamic' ? 'dynamic' : 'static';
  const ast = mpd.getAttribute('availabilityStartTime');
  const clock: Clock = {
    type,
    availabilityStartTime: ast ? Date.parse(ast) / 1000 : 0,
    timeShiftBufferDepth: parseDuration(mpd.getAttribute('timeShiftBufferDepth')),
    now,
  };
  const duration = parseDuration(mpd.getAttribute('mediaPresentationDuration'));
  const loc = child(mpd, 'Location');
  const mpdBase = resolve(manifestUrl, mpd);

  const periods = children(mpd, 'Period');
  // Period start: explicit @start, else previous start + duration.
  const starts: number[] = [];
  periods.forEach((p, i) => {
    const s = p.getAttribute('start');
    starts[i] = s != null ? parseDuration(s) : i === 0 ? 0 : starts[i - 1] + parseDuration(periods[i - 1].getAttribute('duration'));
  });

  const tracks: Record<ContentType, Representation[]> = { video: [], audio: [], text: [] };

  periods.forEach((period, pi) => {
    const periodStart = starts[pi];
    const nextStart = pi + 1 < periods.length ? starts[pi + 1] : duration || 0;
    const periodDuration = parseDuration(period.getAttribute('duration')) || (nextStart ? nextStart - periodStart : 0);
    const periodBase = resolve(mpdBase, period);
    const inh: Inherited = { template: child(period, 'SegmentTemplate'), list: child(period, 'SegmentList'), base: child(period, 'SegmentBase') };

    children(period, 'AdaptationSet').forEach((as, ai) => {
      const asBase = resolve(periodBase, as);
      const roles = children(as, 'Role').map((r) => r.getAttribute('value') || '');
      const asProtection = children(as, 'ContentProtection').map(protectionOf);
      const label = (child(as, 'Label') && child(as, 'Label')!.textContent) || as.getAttribute('label') || '';
      children(as, 'Representation').forEach((rep) => {
        const mimeType = attr('mimeType', rep, as) || '';
        const codecs = attr('codecs', rep, as) || '';
        const ct = contentTypeOf(mimeType, as, codecs);
        if (!ct) return;
        const id = rep.getAttribute('id') || String(ai);
        const bandwidth = Number(rep.getAttribute('bandwidth') || 0);
        const repBase = resolve(asBase, rep);
        const fr = attr('frameRate', rep, as);
        const ch = child(rep, 'AudioChannelConfiguration') || child(as, 'AudioChannelConfiguration');
        const protection = children(rep, 'ContentProtection').map(protectionOf).concat(asProtection);
        const r: Representation = {
          id,
          contentType: ct,
          mimeType,
          codecs,
          bandwidth,
          width: Number(attr('width', rep, as) || 0),
          height: Number(attr('height', rep, as) || 0),
          frameRate: fr ? parseFrameRate(fr) : undefined,
          audioChannels: ch ? Number(ch.getAttribute('value')) || undefined : undefined,
          lang: attr('lang', rep, as) || '',
          label,
          roles,
          adaptationIndex: ai,
          protection,
          ...(ct === 'text' && (mimeType === 'text/vtt' || /vtt/.test(codecs)) && !child(rep, 'SegmentTemplate') && !child(as, 'SegmentTemplate')
            ? { init: null, segments: [], timestampOffset: periodStart, textUrl: repBase }
            : buildSegments(rep, as, period, inh, repBase, periodStart, periodDuration, id, bandwidth, clock)),
        };
        if (typeof r.frameRate === 'number' && !isFinite(r.frameRate)) r.frameRate = undefined;
        mergeTrack(tracks[ct], r, pi);
      });
    });
  });

  const out: Manifest = {
    type,
    duration: duration || (type === 'static' ? lastEnd(tracks.video.concat(tracks.audio)) : 0),
    minBufferTime: parseDuration(mpd.getAttribute('minBufferTime')) || 2,
    availabilityStartTime: clock.availabilityStartTime,
    publishTime: mpd.getAttribute('publishTime') ? Date.parse(mpd.getAttribute('publishTime')!) / 1000 : now,
    timeShiftBufferDepth: clock.timeShiftBufferDepth,
    suggestedPresentationDelay: parseDuration(mpd.getAttribute('suggestedPresentationDelay')),
    minimumUpdatePeriod: parseDuration(mpd.getAttribute('minimumUpdatePeriod')),
    video: tracks.video,
    audio: tracks.audio,
    text: tracks.text,
    location: loc && loc.textContent ? new URL(loc.textContent.trim(), manifestUrl).toString() : undefined,
  };
  return out;
}

function parseFrameRate(s: string): number {
  const [n, d] = s.split('/').map(Number);
  return d ? n / d : n;
}

function lastEnd(reps: Representation[]): number {
  let end = 0;
  for (const r of reps) for (const s of r.segments) if (isFinite(s.end)) end = Math.max(end, s.end);
  return end;
}

function protectionOf(el: Element): ProtectionInfo {
  const pssh = child(el, 'pssh');
  return {
    schemeIdUri: (el.getAttribute('schemeIdUri') || '').toLowerCase(),
    pssh: pssh && pssh.textContent ? pssh.textContent.trim() : undefined,
    defaultKid: el.getAttribute('cenc:default_KID') || el.getAttribute('default_KID') || undefined,
  };
}

/**
 * Multi-period: later periods are appended to the matching track of the
 * first period (same content type, language and closest bandwidth), so the
 * engine sees one continuous segment list per track.
 */
function mergeTrack(list: Representation[], rep: Representation, periodIndex: number) {
  if (periodIndex === 0) {
    list.push(rep);
    return;
  }
  let best: Representation | null = null;
  for (const r of list) {
    if (r.lang !== rep.lang) continue;
    if (!best || Math.abs(r.bandwidth - rep.bandwidth) < Math.abs(best.bandwidth - rep.bandwidth)) best = r;
  }
  if (!best) {
    list.push(rep);
    return;
  }
  // Segments carry their own timestamp offset when it changes between periods.
  for (const s of rep.segments) (s as MediaSegment & { timestampOffset?: number; init?: InitSegment | null }).timestampOffset = rep.timestampOffset;
  for (const s of rep.segments) (s as MediaSegment & { init?: InitSegment | null }).init = rep.init;
  best.segments.push(...rep.segments);
}

/** Segment containing `time`, or the first one after it. */
export function segmentIndexAt(segments: MediaSegment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].end <= time) lo = mid + 1;
    else if (segments[mid].start > time) hi = mid - 1;
    else return mid;
  }
  return lo < segments.length ? lo : -1;
}

/** MIME string for MediaSource.isTypeSupported / addSourceBuffer. */
export function mimeOf(rep: Representation): string {
  return rep.codecs ? `${rep.mimeType}; codecs="${rep.codecs}"` : rep.mimeType;
}
