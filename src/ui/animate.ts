/**
 * Runs a keyframe animation and resolves when it ends. Uses the Web
 * Animations API when present and falls back to a CSS transition (older TV
 * browsers and Cobalt builds without WAAPI).
 */
export function animate(
  el: HTMLElement,
  keyframes: Array<Record<string, string | number>>,
  options: { duration?: number; easing?: string; fill?: 'none' | 'forwards' } = {},
): Promise<void> {
  const duration = options.duration ?? 200;
  const easing = options.easing ?? 'cubic-bezier(0.2, 0, 0, 1)';
  if (typeof el.animate === 'function') {
    const anim = el.animate(keyframes as Keyframe[], { duration, easing, fill: options.fill ?? 'forwards' });
    return new Promise((resolve) => {
      anim.onfinish = () => resolve();
      anim.oncancel = () => resolve();
    });
  }
  const from = keyframes[0] || {};
  const to = keyframes[keyframes.length - 1] || {};
  const style = el.style as unknown as Record<string, string>;
  return new Promise((resolve) => {
    el.style.transition = 'none';
    for (const k in from) style[k] = String(from[k]);
    void el.offsetWidth; // force a style flush so the transition starts from `from`
    el.style.transition = `all ${duration}ms ${easing}`;
    for (const k in to) style[k] = String(to[k]);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.style.transition = '';
      if (options.fill === 'none') for (const k in to) style[k] = '';
      resolve();
    };
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, duration + 50);
  });
}

export const fadeIn = (el: HTMLElement, duration = 200) => animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration });
export const fadeOut = (el: HTMLElement, duration = 200) => animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration });
