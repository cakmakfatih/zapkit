import type { MediaSegment, ByteRange } from './mpd';

/*
 * Minimal ISO-BMFF box reading: sidx (SegmentBase index) and emsg (in-band
 * events) are the only boxes the DASH engine has to understand itself.
 */

function u32(v: DataView, o: number) {
  return v.getUint32(o);
}
function u64(v: DataView, o: number) {
  return v.getUint32(o) * 4294967296 + v.getUint32(o + 4);
}

/** Calls fn(type, payloadStart, boxEnd) for each top-level box. */
export function walkBoxes(data: Uint8Array, fn: (type: string, start: number, end: number, headerStart: number) => void) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  while (o + 8 <= data.byteLength) {
    let size = u32(v, o);
    const type = String.fromCharCode(data[o + 4], data[o + 5], data[o + 6], data[o + 7]);
    let header = 8;
    if (size === 1) {
      size = u64(v, o + 8);
      header = 16;
    } else if (size === 0) size = data.byteLength - o;
    if (size < header || o + size > data.byteLength) break;
    fn(type, o + header, o + size, o);
    o += size;
  }
}

/**
 * Parses a sidx box into media segments. `sidxEnd` is the absolute file
 * offset just after the sidx box (references are relative to it).
 */
export function parseSidx(data: Uint8Array, url: string, sidxOffset: number, periodStart: number, pto: number): MediaSegment[] {
  const segments: MediaSegment[] = [];
  walkBoxes(data, (type, start, end, headerStart) => {
    if (type !== 'sidx') return;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = data[start];
    let o = start + 4 + 4; // version/flags, reference_ID
    const timescale = u32(v, o);
    o += 4;
    let earliest: number;
    let firstOffset: number;
    if (version === 0) {
      earliest = u32(v, o);
      firstOffset = u32(v, o + 4);
      o += 8;
    } else {
      earliest = u64(v, o);
      firstOffset = u64(v, o + 8);
      o += 16;
    }
    o += 2; // reserved
    const count = v.getUint16(o);
    o += 2;
    let offset = sidxOffset + (end - headerStart) + firstOffset;
    let time = earliest;
    for (let i = 0; i < count; i++) {
      const ref = u32(v, o);
      const dur = u32(v, o + 4);
      o += 12;
      const size = ref & 0x7fffffff;
      segments.push({
        url,
        range: { start: offset, end: offset + size - 1 } as ByteRange,
        start: periodStart + (time - pto) / timescale,
        end: periodStart + (time + dur - pto) / timescale,
      });
      offset += size;
      time += dur;
    }
  });
  return segments;
}

export interface EmsgBox {
  schemeIdUri: string;
  value: string;
  /** Presentation time in seconds (v1), or offset from segment start (v0). */
  time: number;
  duration: number;
  id: number;
  data: Uint8Array;
}

function cstring(data: Uint8Array, o: number): [string, number] {
  let end = o;
  while (end < data.length && data[end] !== 0) end++;
  let s = '';
  for (let i = o; i < end; i++) s += String.fromCharCode(data[i]);
  return [s, end + 1];
}

/** Extracts emsg boxes from a media segment. `segmentStart` resolves v0 deltas. */
export function parseEmsg(data: Uint8Array, segmentStart: number): EmsgBox[] {
  const out: EmsgBox[] = [];
  walkBoxes(data, (type, start, end) => {
    if (type !== 'emsg') return;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = data[start];
    let o = start + 4;
    if (version === 0) {
      let scheme: string, value: string;
      [scheme, o] = cstring(data, o);
      [value, o] = cstring(data, o);
      const timescale = u32(v, o);
      const delta = u32(v, o + 4);
      const dur = u32(v, o + 8);
      const id = u32(v, o + 12);
      o += 16;
      out.push({ schemeIdUri: scheme, value, time: segmentStart + delta / timescale, duration: dur / timescale, id, data: data.subarray(o, end) });
    } else {
      const timescale = u32(v, o);
      const pt = u64(v, o + 4);
      const dur = u32(v, o + 12);
      const id = u32(v, o + 16);
      o += 20;
      let scheme: string, value: string;
      [scheme, o] = cstring(data, o);
      [value, o] = cstring(data, o);
      out.push({ schemeIdUri: scheme, value, time: pt / timescale, duration: dur / timescale, id, data: data.subarray(o, end) });
    }
  });
  return out;
}
