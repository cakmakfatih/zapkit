import { h, type VNode } from '../core/vnode';

/*
 * Inline SVG icons for TV controls. Paths are simple original shapes on a
 * 24x24 grid; colour follows `currentColor`.
 */
const PATHS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  rewind: 'M11 6v12L2.5 12zM21 6v12l-8.5-6z',
  forward: 'M13 6v12l8.5-6zM3 6v12l8.5-6z',
  next: 'M6 6v12l8.5-6zM16 6h2v12h-2z',
  previous: 'M18 6v12l-8.5-6zM6 6h2v12H6z',
  replay10: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  forward10: 'M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z',
  captions: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 5v4h4v-1.5H7.5v-1H10V10zm7 0v4h4v-1.5h-2.5v-1H21V10z',
  settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1L11 21h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  audio: 'M4 9v6h4l5 5V4L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M4 9v6h4l5 5V4L8 9zm12 .5 1.5-1.5 2 2 2-2L23 9.5l-2 2 2 2-1.5 1.5-2-2-2 2L16 13.5l2-2z',
  speed: 'M12 4a9 9 0 0 0-7.8 13.5h15.6A9 9 0 0 0 12 4zm1 9.7a1.5 1.5 0 1 1-2-2.2l5-3.5z',
  quality: 'M3 5h18v14H3zm3 3v8h2v-3h2v3h2V8h-2v3H8V8zm8 0v8h3a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  chevronRight: 'M9 6l6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z',
  chevronLeft: 'M15 6l-6 6 6 6 1.4-1.4L11.8 12l4.6-4.6z',
  live: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4zm11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6z',
  stats: 'M4 19h16v2H4zM6 10h3v7H6zm5-6h3v13h-3zm5 9h3v4h-3z',
  playlist: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-2v6l5-3z',
};

export type IconName = keyof typeof PATHS | string;

export function registerIcons(paths: Record<string, string>): void {
  Object.assign(PATHS, paths);
}

export function Icon(props: { name: IconName; size?: string; className?: string; label?: string }): VNode {
  const d = PATHS[props.name] || '';
  return h(
    'svg',
    {
      className: ['kb-icon', props.className],
      viewBox: '0 0 24 24',
      width: props.size || '1em',
      height: props.size || '1em',
      fill: 'currentColor',
      role: props.label ? 'img' : null,
      'aria-label': props.label || null,
      'aria-hidden': props.label ? null : 'true',
    },
    h('path', { d }),
  );
}
Icon.displayName = 'Icon';
