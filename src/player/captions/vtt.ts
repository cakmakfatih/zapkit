/*
 * WebVTT parser for sidecar subtitles and thumbnail tracks.
 *
 * Supports cue identifiers, timings (mm:ss.ttt and hh:mm:ss.ttt), cue settings
 * (line, position, size, align, vertical), NOTE/STYLE/REGION blocks (skipped)
 * and the inline tags b, i, u, c, v, lang, ruby, rt and timestamps.
 */

export interface VttCue {
  id: string;
  start: number;
  end: number;
  text: string;
  settings: {
    line?: number | string;
    position?: string;
    size?: string;
    align?: 'start' | 'center' | 'end' | 'left' | 'right';
    vertical?: 'rl' | 'lr';
  };
}

export interface VttNode {
  tag: 'text' | 'b' | 'i' | 'u' | 'c' | 'v' | 'lang' | 'ruby' | 'rt' | 'br';
  text?: string;
  classes?: string[];
  annotation?: string;
  children?: VttNode[];
}

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function parseTimestamp(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, '0'), 10) / 1000;
}

export function parseVtt(input: string): VttCue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: VttCue[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const lines = blocks[b].split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
    if (!lines.length) continue;
    if (b === 0 && lines[0].startsWith('WEBVTT')) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    let idx = 0;
    let id = '';
    if (lines[0].indexOf('-->') < 0) {
      id = lines[0];
      idx = 1;
    }
    const timing = lines[idx];
    if (!timing || timing.indexOf('-->') < 0) continue;
    const [left, right] = timing.split('-->');
    const start = parseTimestamp(left);
    const rightParts = right.trim().split(/\s+/);
    const end = parseTimestamp(rightParts[0]);
    if (start == null || end == null) continue;
    const settings: VttCue['settings'] = {};
    for (const part of rightParts.slice(1)) {
      const [k, v] = part.split(':');
      if (!v) continue;
      if (k === 'line') settings.line = /%$/.test(v) ? v : parseFloat(v.split(',')[0]);
      else if (k === 'position') settings.position = v.split(',')[0];
      else if (k === 'size') settings.size = v;
      else if (k === 'align') settings.align = v as VttCue['settings']['align'];
      else if (k === 'vertical') settings.vertical = v as 'rl' | 'lr';
    }
    cues.push({ id, start, end, text: lines.slice(idx + 1).join('\n'), settings });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return cues;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (_m, e: string) => ENTITIES[e]);
}

/** Parses cue text markup into a small tree (unknown tags are dropped, text kept). */
export function parseCueText(text: string): VttNode[] {
  const root: VttNode = { tag: 'b', children: [] };
  const stack: VttNode[] = [root];
  const re = /<(\/)?([a-z]+)((?:\.[\w-]+)*)(?:\s+([^>]*))?>|<[\d:.]+>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined || m[6] !== undefined) {
      const raw = decodeEntities(m[5] ?? m[6]);
      const parts = raw.split('\n');
      parts.forEach((p, i) => {
        if (i > 0) top.children!.push({ tag: 'br' });
        if (p) top.children!.push({ tag: 'text', text: p });
      });
      continue;
    }
    if (!m[2]) continue; // inline timestamp
    const tag = m[2].toLowerCase() as VttNode['tag'];
    if (!['b', 'i', 'u', 'c', 'v', 'lang', 'ruby', 'rt'].includes(tag)) continue;
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: VttNode = {
      tag,
      classes: m[3] ? m[3].slice(1).split('.') : undefined,
      annotation: m[4] ? m[4].trim() : undefined,
      children: [],
    };
    top.children!.push(node);
    stack.push(node);
  }
  return root.children!;
}

/** Cues active at `time` (binary search start, then linear scan). */
export function activeCues(cues: VttCue[], time: number): VttCue[] {
  const out: VttCue[] = [];
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  // Cues are sorted by start; long cues may begin far earlier, so scan back.
  for (let i = lo - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.end > time) out.unshift(c);
    if (time - c.start > 600) break;
  }
  return out;
}
