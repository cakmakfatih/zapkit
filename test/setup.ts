// Installs a jsdom window as globals before the library is imported.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
for (const name of [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'CustomEvent', 'Event',
  'KeyboardEvent', 'MouseEvent', 'customElements', 'getComputedStyle', 'requestAnimationFrame', 'DOMParser',
]) {
  // Always replace: Node's own Event/CustomEvent are rejected by jsdom's dispatchEvent.
  {
    try {
      g[name] = win[name];
    } catch {
      Object.defineProperty(g, name, { value: win[name], configurable: true });
    }
  }
}
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));
export { dom };
