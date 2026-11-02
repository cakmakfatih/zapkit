import { parseVtt } from './captions/vtt';
import type { StoryboardSpec } from './types';

/*
 * Seek preview thumbnails. Storyboard frames are shown above the progress
 * bar while scrubbing. Two formats are supported: a sprite-sheet spec and the
 * widespread WebVTT thumbnails track (`image.jpg#xywh=x,y,w,h` cues).
 */

export interface StoryboardFrame {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Full sprite size, needed for background-size when scaling. */
  sheetWidth?: number;
  sheetHeight?: number;
}

export interface Storyboard {
  frameAt(time: number): StoryboardFrame | null;
}

export function spriteStoryboard(spec: StoryboardSpec): Storyboard {
  const perSheet = spec.columns * spec.rows;
  return {
    frameAt(time) {
      let index = Math.max(0, Math.floor(time / spec.interval));
      if (spec.count != null) index = Math.min(index, spec.count - 1);
      const sheet = Math.floor(index / perSheet);
      const local = index % perSheet;
      return {
        url: spec.url.replace('$M', String(sheet)),
        x: (local % spec.columns) * spec.width,
        y: Math.floor(local / spec.columns) * spec.height,
        width: spec.width,
        height: spec.height,
        sheetWidth: spec.columns * spec.width,
        sheetHeight: spec.rows * spec.height,
      };
    },
  };
}

export async function vttStoryboard(url: string, fetchFn: typeof fetch = fetch): Promise<Storyboard> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('storyboard: HTTP ' + res.status);
  const cues = parseVtt(await res.text());
  const frames = cues.map((c) => {
    const [file, frag] = c.text.trim().split('#xywh=');
    const [x, y, w, hgt] = (frag || '0,0,0,0').split(',').map(Number);
    return { start: c.start, end: c.end, url: new URL(file, url).toString(), x, y, width: w, height: hgt };
  });
  return {
    frameAt(time) {
      let lo = 0;
      let hi = frames.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const f = frames[mid];
        if (time < f.start) hi = mid - 1;
        else if (time >= f.end) lo = mid + 1;
        else return f;
      }
      return frames.length ? frames[Math.max(0, Math.min(frames.length - 1, hi))] : null;
    },
  };
}
