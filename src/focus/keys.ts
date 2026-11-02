/**
 * Remote-control key normalisation.
 *
 * TV platforms report remote buttons with different `key` names and legacy
 * `keyCode`s. They are folded into a small set of logical keys
 * (up/down/left/right/enter/back...) and platform codes are remapped through a
 * table (Tizen back is 10009, webOS back is 461, media keys differ). This module does that with
 * readable logical names and covers VIDAA, Tizen, webOS, Cobalt and desktop.
 */

export type LogicalKey =
  | 'up' | 'down' | 'left' | 'right' | 'enter' | 'back' | 'exit' | 'home' | 'menu' | 'info' | 'search'
  | 'play' | 'pause' | 'playPause' | 'stop' | 'fastForward' | 'rewind' | 'next' | 'previous'
  | 'channelUp' | 'channelDown' | 'volumeUp' | 'volumeDown' | 'mute' | 'subtitle' | 'audioTrack'
  | 'red' | 'green' | 'yellow' | 'blue'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

const BY_NAME: Record<string, LogicalKey> = {
  ArrowUp: 'up', Up: 'up',
  ArrowDown: 'down', Down: 'down',
  ArrowLeft: 'left', Left: 'left',
  ArrowRight: 'right', Right: 'right',
  Enter: 'enter', Select: 'enter', Accept: 'enter',
  Escape: 'back', Esc: 'back', GoBack: 'back', BrowserBack: 'back', Back: 'back', XF86Back: 'back',
  Exit: 'exit', XF86Exit: 'exit',
  Home: 'home', BrowserHome: 'home',
  ContextMenu: 'menu', Menu: 'menu',
  Info: 'info', XF86Info: 'info',
  BrowserSearch: 'search', Search: 'search',
  MediaPlay: 'play', Play: 'play',
  MediaPause: 'pause', Pause: 'pause',
  MediaPlayPause: 'playPause', PlayPause: 'playPause',
  MediaStop: 'stop', Stop: 'stop',
  MediaFastForward: 'fastForward', FastFwd: 'fastForward', FastForward: 'fastForward',
  MediaRewind: 'rewind', Rewind: 'rewind',
  MediaTrackNext: 'next', MediaNextTrack: 'next',
  MediaTrackPrevious: 'previous', MediaPreviousTrack: 'previous',
  ChannelUp: 'channelUp', ChannelDown: 'channelDown',
  AudioVolumeUp: 'volumeUp', VolumeUp: 'volumeUp',
  AudioVolumeDown: 'volumeDown', VolumeDown: 'volumeDown',
  AudioVolumeMute: 'mute', VolumeMute: 'mute',
  Subtitle: 'subtitle', ClosedCaptionToggle: 'subtitle',
  AudioTrack: 'audioTrack', MediaAudioTrack: 'audioTrack',
  ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
};

const BY_CODE: Record<number, LogicalKey> = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 29443: 'enter', 65376: 'enter',
  27: 'back', 8: 'back', 461: 'back', 10009: 'back', 166: 'back', 196: 'back',
  10182: 'exit', 1001: 'exit', 36: 'home',
  457: 'info', 93: 'menu',
  415: 'play', 250: 'play',
  19: 'pause', 102: 'pause',
  10252: 'playPause', 179: 'playPause', 463: 'playPause',
  413: 'stop', 178: 'stop',
  417: 'fastForward', 228: 'fastForward',
  412: 'rewind', 227: 'rewind',
  176: 'next', 10233: 'next', 425: 'next',
  177: 'previous', 10232: 'previous', 424: 'previous',
  427: 'channelUp', 428: 'channelDown', 33: 'channelUp', 34: 'channelDown',
  447: 'volumeUp', 448: 'volumeDown', 449: 'mute', 175: 'volumeUp', 174: 'volumeDown', 173: 'mute',
  460: 'subtitle', 10221: 'subtitle',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
  48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
  // 102 (numpad 6 on desktops) is left as "pause" above: some remotes send it
  // and numpads are rare on TVs.
  96: '0', 97: '1', 98: '2', 99: '3', 100: '4', 101: '5', 103: '7', 104: '8', 105: '9',
};

/** Adds or overrides key names (e.g. a vendor's custom `key` values). */
export function registerKeyNames(map: Record<string, LogicalKey>): void {
  Object.assign(BY_NAME, map);
}

/** Adds or overrides legacy key codes (e.g. a set-top box with custom codes). */
export function registerKeyCodes(map: Record<number, LogicalKey>): void {
  Object.assign(BY_CODE, map);
}

function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'submit';
}

/**
 * Maps a keyboard event to a logical key, or null when the key has no remote
 * meaning. Backspace and digits inside text inputs stay text-editing keys.
 */
export function normalizeKey(e: Pick<KeyboardEvent, 'key' | 'keyCode' | 'target'>): LogicalKey | null {
  const typing = isTextInput(e.target);
  const key = e.key;
  if (typing && (key === 'Backspace' || key === 'Delete' || key === ' ' || (key && key.length === 1))) return null;
  if (typing && (key === 'ArrowLeft' || key === 'ArrowRight')) return null;
  if (key === 'Backspace') return 'back';
  if (key && BY_NAME[key]) return BY_NAME[key];
  if (key && key.length === 1 && key >= '0' && key <= '9') return key as LogicalKey;
  const code = e.keyCode;
  if (code && BY_CODE[code]) {
    if (typing && code >= 48 && code <= 57) return null;
    return BY_CODE[code];
  }
  return null;
}

export function isDirection(key: LogicalKey | null): key is 'up' | 'down' | 'left' | 'right' {
  return key === 'up' || key === 'down' || key === 'left' || key === 'right';
}

/** Media keys handled by the player even when another element has focus. */
export const MEDIA_KEYS: ReadonlySet<LogicalKey> = new Set<LogicalKey>([
  'play', 'pause', 'playPause', 'stop', 'fastForward', 'rewind', 'next', 'previous', 'subtitle', 'audioTrack',
]);

/**
 * Registers the platform keys a TV app needs. Tizen only delivers media and
 * color keys after `tizen.tvinputdevice.registerKey`; other platforms ignore it.
 */
export function registerPlatformKeys(keys: string[] = [
  'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'MediaTrackNext', 'MediaTrackPrevious', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  'ChannelUp', 'ChannelDown', 'Info',
]): void {
  const tizen = (globalThis as { tizen?: { tvinputdevice?: { registerKey(k: string): void } } }).tizen;
  if (!tizen || !tizen.tvinputdevice) return;
  for (const k of keys) {
    try {
      tizen.tvinputdevice.registerKey(k);
    } catch {
      // Key not supported on this model.
    }
  }
}
