import { registerCustomElementTag, render } from './renderer';
import { h, type ComponentType } from './vnode';

/**
 * Exposes a component as a custom element (web component), so it can be used from
 * plain HTML as a custom tag.
 *
 * Inside a zapkit-tv tree the element receives the whole props object through the
 * `kbProps` property and the renderer leaves its children alone; the element
 * renders the component into itself. Outside zapkit-tv, attributes listed in
 * `observedAttributes` are passed as string props.
 */
export function defineElement<P>(
  tag: string,
  component: ComponentType<P>,
  options: { observedAttributes?: string[]; shadow?: boolean } = {},
): void {
  registerCustomElementTag(tag);
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  const observed = options.observedAttributes || [];

  class ZapkitElement extends HTMLElement {
    static get observedAttributes() {
      return observed;
    }
    private _props: Record<string, unknown> = {};
    private _connected = false;

    get kbProps(): Record<string, unknown> {
      return this._props;
    }
    set kbProps(value: Record<string, unknown>) {
      this._props = value;
      if (this._connected) this._render();
    }

    connectedCallback() {
      this._connected = true;
      if (options.shadow && !this.shadowRoot) this.attachShadow({ mode: 'open' });
      this._render();
    }
    disconnectedCallback() {
      this._connected = false;
      render(null, this.shadowRoot || this);
    }
    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      this._props = { ...this._props, [name]: value };
      if (this._connected) this._render();
    }
    private _render() {
      const { children, ...rest } = this._props as { children?: unknown };
      render(h(component as ComponentType<any>, rest, children as never), this.shadowRoot || this);
    }
  }
  customElements.define(tag, ZapkitElement);
}
