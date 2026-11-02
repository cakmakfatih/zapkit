import { useEffect, useRef, useState } from '../core/hooks';
import { h, type Child, type VNode } from '../core/vnode';
import { Icon, type IconName } from './icons';

export interface ButtonProps {
  label?: Child;
  icon?: IconName;
  onClick?: (e: Event) => void;
  focusId?: string;
  disabled?: boolean;
  selected?: boolean;
  autoFocus?: boolean;
  className?: unknown;
  /** Accessible name when the button only shows an icon. */
  ariaLabel?: string;
  children?: Child;
  [attr: string]: unknown;
}

/** Focusable button. Enter on the remote triggers `onClick`. */
export function Button(props: ButtonProps): VNode {
  const { label, icon, className, disabled, selected, ariaLabel, children, ...rest } = props;
  return h(
    'button',
    {
      ...rest,
      type: 'button',
      focusable: !disabled,
      disabled: !!disabled,
      className: ['kb-button', { 'kb-button--icon': icon && !label && !children, 'kb-selected': selected }, className],
      'aria-label': ariaLabel || null,
      'aria-pressed': selected === undefined ? null : String(!!selected),
    },
    icon ? h(Icon, { name: icon }) : null,
    label != null ? h('span', { className: 'kb-button__label' }, label) : null,
    children,
  );
}
Button.displayName = 'Button';

export function IconButton(props: ButtonProps & { icon: IconName; ariaLabel: string }): VNode {
  return h(Button, props);
}
IconButton.displayName = 'IconButton';

export function Spinner(props: { size?: string; className?: string; label?: string }): VNode {
  return h('div', {
    className: ['kb-spinner', props.className],
    role: 'progressbar',
    'aria-label': props.label || 'Loading',
    style: props.size ? { width: props.size, height: props.size } : undefined,
  });
}
Spinner.displayName = 'Spinner';

/**
 * Single-line text that scrolls horizontally while `active` (usually: while
 * its tile is focused) if it does not fit.
 */
export function Marquee(props: { text: string; active?: boolean; speed?: number; className?: string }): VNode {
  const outer = useRef<HTMLElement>(null);
  const inner = useRef<HTMLElement>(null);
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    if (!props.active || !outer.current || !inner.current) {
      setDistance(0);
      return;
    }
    const overflow = inner.current.scrollWidth - outer.current.clientWidth;
    setDistance(overflow > 0 ? overflow : 0);
  }, [props.active, props.text]);
  const speed = props.speed || 60; // px per second
  const duration = distance ? Math.max(2, (distance * 2) / speed + 2) : 0;
  return h(
    'div',
    { ref: outer, className: ['kb-marquee', { 'kb-marquee--running': distance > 0 }, props.className] },
    h(
      'span',
      {
        ref: inner,
        className: 'kb-marquee__text',
        style: distance ? { '--kb-marquee-distance': -distance + 'px', animationDuration: duration + 's' } : undefined,
      },
      props.text,
    ),
  );
}
Marquee.displayName = 'Marquee';

/** Image that fades in once loaded and shows `fallback` on error. */
export function Image(props: { src?: string | null; alt?: string; fallback?: Child; className?: string; width?: string; height?: string }): VNode {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  useEffect(() => setStatus(props.src ? 'loading' : 'error'), [props.src]);
  return h(
    'div',
    { className: ['kb-image', 'kb-image--' + status, props.className], style: { width: props.width, height: props.height } },
    props.src && status !== 'error'
      ? h('img', {
          key: props.src,
          src: props.src,
          alt: props.alt || '',
          decoding: 'async',
          onLoad: () => setStatus('loaded'),
          onError: () => setStatus('error'),
        })
      : null,
    status === 'error' ? props.fallback ?? null : null,
  );
}
Image.displayName = 'Image';
