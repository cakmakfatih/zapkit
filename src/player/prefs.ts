import type { CaptionSettings } from './types';

/*
 * Persistent player preferences. The volume, quality, bandwidth, caption
 * style and playback rate are kept in localStorage under a `kb-player-` prefix.
 */

export interface PlayerPrefs {
  volume: number;
  muted: boolean;
  /** Preferred max height, or 0 for auto. */
  quality: number;
  /** Last bandwidth estimate in bits per second (seeds ABR on the next start). */
  bandwidth: number;
  playbackRate: number;
  captionsOn: boolean;
  captionLang: string;
  audioLang: string;
  captionSettings: CaptionSettings;
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  fontScale: 1,
  color: '#ffffff',
  background: '#000000',
  backgroundOpacity: 0.75,
  edge: 'none',
  fontFamily: 'sans-serif',
  windowColor: '#000000',
  windowOpacity: 0,
};

const DEFAULTS: PlayerPrefs = {
  volume: 100,
  muted: false,
  quality: 0,
  bandwidth: 0,
  playbackRate: 1,
  captionsOn: false,
  captionLang: '',
  audioLang: '',
  captionSettings: DEFAULT_CAPTION_SETTINGS,
};

const PREFIX = 'kb-player-';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadPrefs(): PlayerPrefs {
  const s = storage();
  const out = { ...DEFAULTS, captionSettings: { ...DEFAULT_CAPTION_SETTINGS } } as PlayerPrefs;
  if (!s) return out;
  for (const key of Object.keys(DEFAULTS) as Array<keyof PlayerPrefs>) {
    const raw = s.getItem(PREFIX + key);
    if (raw == null) continue;
    try {
      const v = JSON.parse(raw);
      (out as unknown as Record<string, unknown>)[key] = key === 'captionSettings' ? { ...DEFAULT_CAPTION_SETTINGS, ...v } : v;
    } catch {
      // Ignore corrupt values.
    }
  }
  return out;
}

export function savePref<K extends keyof PlayerPrefs>(key: K, value: PlayerPrefs[K]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled.
  }
}
