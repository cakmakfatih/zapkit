import { Component } from './component';
import { renderInto } from './renderer';
import type { Child } from './vnode';

interface PortalProps {
  /** Element the children are rendered into (e.g. an overlay layer). */
  container: Element;
  children?: Child;
}

/**
 * Renders children into another container while keeping the logical parent,
 * so context (store, router, theme) still reaches them. Used by overlays,
 * toasts and the player's settings panel.
 */
export class Portal extends Component<PortalProps> {
  private host: Element | null = null;

  render(): Child {
    return null;
  }
  override componentDidMount(): void {
    this.sync();
  }
  override componentDidUpdate(): void {
    this.sync();
  }
  override componentWillUnmount(): void {
    if (this.host) renderInto(this.host, null, null);
    this.host = null;
  }

  private sync() {
    const container = this.props.container;
    if (this.host && this.host !== container) renderInto(this.host, null, null);
    this.host = container;
    renderInto(container, this.props.children ?? null, this.__kb);
  }
}

export function createPortal(children: Child, container: Element) {
  return { type: Portal, props: { container, children }, key: null, $kb: 1 as const };
}
