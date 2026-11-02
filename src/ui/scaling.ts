/*
 * Resolution independence.
 *
 * Everything is sized in rem and the root font size scales with the
 * screen. Layouts are designed on a 1920x1080 canvas in "design pixels":
 * `dp(24)` returns a rem string, and `installScaling()` sets the root font size
 * so one design pixel matches the real screen (720p, 1080p, 4K or a browser).
 */

const BASE_FONT = 16;
let designWidth = 1920;
let designHeight = 1080;
let currentScale = 1;

/** Converts design pixels to a rem string. */
export function dp(px: number): string {
  return px / BASE_FONT + 'rem';
}

/** Converts design pixels to real CSS pixels at the current scale. */
export function toScreenPx(px: number): number {
  return px * currentScale;
}

/** Converts real CSS pixels (e.g. getBoundingClientRect) to design pixels. */
export function toDesignPx(px: number): number {
  return px / currentScale;
}

export function getScale(): number {
  return currentScale;
}

export interface ScalingOptions {
  width?: number;
  height?: number;
  /** 'contain' keeps the whole canvas visible; 'width' scales by width only. Default 'contain'. */
  mode?: 'contain' | 'width';
}

/** Sets the root font size from the viewport and keeps it updated. Returns an uninstall function. */
export function installScaling(options: ScalingOptions = {}): () => void {
  designWidth = options.width || 1920;
  designHeight = options.height || 1080;
  const mode = options.mode || 'contain';
  const apply = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    currentScale = mode === 'width' ? w / designWidth : Math.min(w / designWidth, h / designHeight);
    document.documentElement.style.fontSize = BASE_FONT * currentScale + 'px';
    document.documentElement.style.setProperty('--kb-scale', String(currentScale));
  };
  apply();
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}
