import { useState } from '../core/hooks';
import { h, type VNode } from '../core/vnode';
import { FocusGroup } from '../focus/components';
import { Icon } from './icons';

/*
 * D-pad on-screen keyboard. It only draws keys and reports text: the host owns the
 * value, the layout, the language and what happens on "done". The shift key works like a
 * phone's: abc (lower case), Aa (the next letter is a capital, then back to lower case)
 * and AA (caps lock); pressing it cycles abc → Aa → AA → abc and is never overridden.
 */

/** Accessible names of the keys (the keys show icons, not text). */
export interface KeyboardStrings {
  shift: string;
  clear: string;
  space: string;
  delete: string;
  show: string;
  hide: string;
  done: string;
}

export const DEFAULT_KEYBOARD_STRINGS: KeyboardStrings = {
  shift: 'Shift',
  clear: 'Clear',
  space: 'Space',
  delete: 'Delete',
  show: 'Show',
  hide: 'Hide',
  done: 'Done',
};

/** Default layout: digits, then QWERTY rows. Letters are written in upper case; the keyboard cases them. */
export const QWERTY_LAYOUT: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '.'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', ':', '/'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '_', '@', "'"],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '?', '!', '&', '#'],
];

/** Which action keys are drawn. All default to true; a key set to false is not rendered at all. */
export interface KeyboardButtons {
  shift?: boolean;
  clear?: boolean;
  space?: boolean;
  delete?: boolean;
  done?: boolean;
}

export interface OnScreenKeyboardProps {
  /** Current text; the host keeps it (controlled component). */
  value: string;
  onChange: (value: string) => void;
  /** The "done" (enter) key. */
  onSubmit: () => void;
  /** Key rows. Default: QWERTY_LAYOUT. */
  layout?: string[][];
  /** Locale used to change the case of letters, e.g. 'tr-TR' so that I/ı and İ/i pair up. */
  locale?: string;
  /** Start in "Aa" (next letter capital). Default: true when `value` is empty. */
  initialShift?: boolean;
  /** Draws a show/hide key (for passwords); the host decides what it does. */
  reveal?: { shown: boolean; onToggle: () => void };
  /** Accessible names of the keys. */
  strings?: Partial<KeyboardStrings>;
  /** Action keys to draw or leave out. */
  buttons?: KeyboardButtons;
  /** Prefix of the focus ids: `${prefix}-${row}-${column}` for letters, `${prefix}-shift` etc. for actions. Default 'kb-key'. */
  focusPrefix?: string;
  /** Focus continues on the opposite side past an edge. Default true. */
  wrap?: boolean;
  className?: unknown;
}

type CaseMode = 'lower' | 'shift' | 'caps';

export function OnScreenKeyboard(props: OnScreenKeyboardProps): VNode {
  const strings = { ...DEFAULT_KEYBOARD_STRINGS, ...props.strings };
  const layout = props.layout || QWERTY_LAYOUT;
  const locale = props.locale;
  const prefix = props.focusPrefix || 'kb-key';
  const b = props.buttons || {};
  const [mode, setMode] = useState<CaseMode>(() => ((props.initialShift ?? !props.value) ? 'shift' : 'lower'));
  const upper = mode !== 'lower';

  const isLetter = (k: string) => k.toLocaleLowerCase(locale) !== k.toLocaleUpperCase(locale);
  const label = (k: string) => (isLetter(k) ? (upper ? k.toLocaleUpperCase(locale) : k.toLocaleLowerCase(locale)) : k);
  const press = (k: string) => {
    props.onChange(props.value + label(k));
    if (isLetter(k) && mode === 'shift') setMode('lower');
  };
  const cycle = () => setMode(mode === 'lower' ? 'shift' : mode === 'shift' ? 'caps' : 'lower');

  return (
    <FocusGroup className={['kb-keyboard', props.className]} orientation="grid" wrap={props.wrap !== false}>
      {layout.map((row, r) => (
        <div className="kb-keyboard__row" key={r}>
          {row.map((k, c) => (
            <button key={k} type="button" className="kb-key" focusable focusId={`${prefix}-${r}-${c}`} onClick={() => press(k)}>
              {label(k)}
            </button>
          ))}
        </div>
      ))}
      <div className="kb-keyboard__row kb-keyboard__row--actions">
        {b.shift !== false ? (
          <button
            type="button"
            className={['kb-key', 'kb-key--wide', { 'kb-key--on': upper }]}
            focusable
            focusId={prefix + '-shift'}
            aria-label={strings.shift}
            onClick={cycle}
          >
            <Icon name={mode === 'caps' ? 'caps' : 'shift'} />
            <span>{mode === 'lower' ? 'abc' : mode === 'shift' ? 'Aa' : 'AA'}</span>
          </button>
        ) : null}
        {b.clear !== false ? (
          <button type="button" className="kb-key kb-key--wide" focusable focusId={prefix + '-clear'} aria-label={strings.clear} onClick={() => props.onChange('')}>
            <Icon name="trash" />
          </button>
        ) : null}
        {b.space !== false ? (
          <button type="button" className="kb-key kb-key--space" focusable focusId={prefix + '-space'} aria-label={strings.space} onClick={() => props.onChange(props.value + ' ')}>
            <Icon name="space" />
          </button>
        ) : null}
        {b.delete !== false ? (
          <button type="button" className="kb-key kb-key--wide" focusable focusId={prefix + '-delete'} aria-label={strings.delete} onClick={() => props.onChange(props.value.slice(0, -1))}>
            <Icon name="backspace" />
          </button>
        ) : null}
        {props.reveal ? (
          <button
            type="button"
            className="kb-key kb-key--wide"
            focusable
            focusId={prefix + '-reveal'}
            aria-label={props.reveal.shown ? strings.hide : strings.show}
            onClick={props.reveal.onToggle}
          >
            <Icon name={props.reveal.shown ? 'eyeOff' : 'eye'} />
          </button>
        ) : null}
        {b.done !== false ? (
          <button type="button" className="kb-key kb-key--wide kb-key--done" focusable focusId={prefix + '-done'} aria-label={strings.done} onClick={props.onSubmit}>
            <Icon name="enter" />
          </button>
        ) : null}
      </div>
    </FocusGroup>
  );
}
OnScreenKeyboard.displayName = 'OnScreenKeyboard';
