import { createContext } from '../../core/context';
import { useContext } from '../../core/hooks';
import type { Player } from '../player';

/** Provides the Player to the player UI components below VideoPlayer. */
export const PlayerContext = createContext<Player | null>(null);

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error('usePlayer() outside <PlayerContext.Provider> / <VideoPlayer>');
  return p;
}

/** UI strings; pass a partial object to VideoPlayer to translate. */
export interface PlayerStrings {
  play: string;
  pause: string;
  rewind: string;
  forward: string;
  captions: string;
  audio: string;
  settings: string;
  stats: string;
  quality: string;
  auto: string;
  speed: string;
  normal: string;
  off: string;
  captionStyle: string;
  fontSize: string;
  textColor: string;
  background: string;
  live: string;
  retry: string;
  errorTitle: string;
  back: string;
}

export const DEFAULT_STRINGS: PlayerStrings = {
  play: 'Play',
  pause: 'Pause',
  rewind: 'Back 10 seconds',
  forward: 'Forward 10 seconds',
  captions: 'Subtitles',
  audio: 'Audio',
  settings: 'Settings',
  stats: 'Stats for nerds',
  quality: 'Quality',
  auto: 'Auto',
  speed: 'Playback speed',
  normal: 'Normal',
  off: 'Off',
  captionStyle: 'Subtitle style',
  fontSize: 'Font size',
  textColor: 'Text colour',
  background: 'Background',
  live: 'LIVE',
  retry: 'Retry',
  errorTitle: 'This video cannot be played',
  back: 'Back',
};

export const StringsContext = createContext<PlayerStrings>(DEFAULT_STRINGS);

export function useStrings(): PlayerStrings {
  return useContext(StringsContext);
}

/** 3725 → "1:02:05", 65 → "1:05". */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}
