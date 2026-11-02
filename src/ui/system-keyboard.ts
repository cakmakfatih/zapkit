/*
 * Devices that pop up their own on-screen keyboard when a text field gets focus: smart TVs and touch-only
 * devices (phones, tablets). An app that draws its own keyboard (OnScreenKeyboard) wants a single one, so its
 * text field is kept from asking for the system keyboard on those devices.
 */

const TV_USER_AGENT = /VIDAA|Hisense|Web0S|webOS|Tizen|SMART-TV|SmartTV|Android TV|AFT|BRAVIA|NetCast|Philips|Roku|CrKey/i;

/** Running in a smart TV browser. */
export function isTvDevice(): boolean {
  return typeof navigator !== 'undefined' && TV_USER_AGENT.test(navigator.userAgent || '');
}

function touchOnly(): boolean {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** True on a TV or a touch-only device, where focusing a text field opens the system's own keyboard. */
export function hasSystemKeyboard(): boolean {
  return isTvDevice() || touchOnly();
}

/**
 * Props that keep a text field from opening the system keyboard (read-only, no input mode); empty on devices
 * with a physical keyboard. Spread them onto the field: `<input {...suppressSystemKeyboard()} />`. The host
 * then writes typed or pasted text into its value itself, since a read-only field takes no input.
 */
export function suppressSystemKeyboard(): { readOnly?: boolean; inputmode?: string } {
  return hasSystemKeyboard() ? { readOnly: true, inputmode: 'none' } : {};
}
