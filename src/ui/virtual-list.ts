import { Component } from '../core/component';
import { h, type Child, type Key, type VNode } from '../core/vnode';
import { focus as defaultFocus, type FocusManager } from '../focus/focus-manager';
import { dp } from './scaling';

/*
 * Focus-driven virtual list / grid.
 *
 * TV shelves can hold thousands of tiles; only the window
 * around the focused tile is rendered inside a container as large as the whole list and
 * offsets the rendered slice. Scrolling follows focus (not scroll events).
 * Sizes are design pixels (see dp()).
 */

export interface VirtualListProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number, state: { focused: boolean }) => Child;
  /** Size of one item along the scroll axis (row height for grids), in design px. */
  itemSize: number;
  /** Size of the visible area along the scroll axis, in design px. */
  viewportSize: number;
  orientation?: 'vertical' | 'horizontal';
  /** Columns for a vertical grid (items per row). Default 1. */
  columns?: number;
  /** Cross-axis size of one column, design px (grids). Default itemSize. */
  columnSize?: number;
  /** Gap between items along the scroll axis, design px. */
  gap?: number;
  /** Extra rows rendered before/after the visible window. Default 2. */
  overscan?: number;
  /** How the focused row is kept in view. 'edge' scrolls only when needed; 'center' keeps it centred; 'start' pins it to the start. */
  align?: 'edge' | 'center' | 'start';
  keyOf?: (item: T, index: number) => Key;
  /** Prefix for item focusIds (`${focusPrefix}-${key}`), used for focus restore. */
  focusPrefix?: string;
  initialIndex?: number;
  wrap?: boolean;
  className?: unknown;
  onFocusIndex?: (index: number) => void;
  /** Enter (or a click) on an item. Item wrappers are the focus targets, so put the action here. */
  onSelect?: (item: T, index: number) => void;
  /** Called when the window reaches the end (load more). */
  onEndReached?: () => void;
  focusManager?: FocusManager;
}

interface VirtualListState {
  focused: number;
  offset: number;
}

export class VirtualList<T> extends Component<VirtualListProps<T>, VirtualListState> {
  static override displayName = 'VirtualList';

  constructor(props: VirtualListProps<T>) {
    super(props);
    const focused = Math.min(props.initialIndex || 0, Math.max(0, props.items.length - 1));
    this.state = { focused, offset: this.offsetFor(focused, 0, props) };
  }

  private stride(props = this.props) {
    return props.itemSize + (props.gap || 0);
  }

  private rowOf(index: number, props = this.props) {
    return Math.floor(index / (props.columns || 1));
  }

  private offsetFor(index: number, current: number, props = this.props): number {
    const stride = this.stride(props);
    const row = this.rowOf(index, props);
    const rows = Math.ceil(props.items.length / (props.columns || 1));
    const total = Math.max(0, rows * stride - (props.gap || 0));
    const max = Math.max(0, total - props.viewportSize);
    const start = row * stride;
    let next = current;
    const align = props.align || 'edge';
    if (align === 'start') next = start;
    else if (align === 'center') next = start - (props.viewportSize - props.itemSize) / 2;
    else if (start < current) next = start;
    else if (start + props.itemSize > current + props.viewportSize) next = start + props.itemSize - props.viewportSize;
    return Math.max(0, Math.min(max, next));
  }

  /** Focuses item `index` (scrolling it into view). */
  focusIndex(index: number): void {
    const i = Math.max(0, Math.min(this.props.items.length - 1, index));
    this.setState({ focused: i, offset: this.offsetFor(i, this.state.offset) }, () => {
      const el = this.el && this.el.querySelector(`[data-index="${i}"]`);
      if (el) (this.props.focusManager || defaultFocus).focus(el, { reason: 'list' });
    });
  }

  private onItemFocus = (e: Event) => {
    const target = (e.target as Element).closest('[data-index]');
    if (!target || !this.el || !this.el.contains(target)) return;
    const index = Number(target.getAttribute('data-index'));
    if (index === this.state.focused && this.state.offset === this.offsetFor(index, this.state.offset)) return;
    this.setState({ focused: index, offset: this.offsetFor(index, this.state.offset) });
    if (this.props.onFocusIndex) this.props.onFocusIndex(index);
  };

  override componentDidUpdate(prev: VirtualListProps<T>): void {
    if (prev.items !== this.props.items && this.state.focused >= this.props.items.length && this.props.items.length) {
      this.focusIndex(this.props.items.length - 1);
    }
  }

  render(): VNode {
    const p = this.props;
    const vertical = (p.orientation || 'vertical') === 'vertical';
    const columns = p.columns || 1;
    const stride = this.stride();
    const crossStride = (p.columnSize || p.itemSize) + (p.gap || 0);
    const rows = Math.ceil(p.items.length / columns);
    const overscan = p.overscan ?? 2;
    const { offset, focused } = this.state;
    const firstRow = Math.max(0, Math.floor(offset / stride) - overscan);
    const lastRow = Math.min(rows - 1, Math.ceil((offset + p.viewportSize) / stride) + overscan);
    if (lastRow >= rows - 1 - overscan && p.onEndReached) Promise.resolve().then(p.onEndReached);

    const children: VNode[] = [];
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= p.items.length) break;
        const item = p.items[index];
        const key = p.keyOf ? p.keyOf(item, index) : index;
        const main = row * stride;
        const cross = col * crossStride;
        children.push(
          h(
            'div',
            {
              key,
              className: ['kb-vlist__item', { 'kb-vlist__item--focused': index === focused }],
              'data-index': index,
              focusable: true,
              focusId: p.focusPrefix ? p.focusPrefix + '-' + key : undefined,
              onClick: p.onSelect ? () => p.onSelect!(item, index) : undefined,
              style: {
                position: 'absolute',
                transform: vertical ? `translate(${dp(cross)}, ${dp(main)})` : `translate(${dp(main)}, ${dp(cross)})`,
                [vertical ? 'height' : 'width']: dp(p.itemSize),
                [vertical ? 'width' : 'height']: columns > 1 || !vertical ? dp(p.columnSize || p.itemSize) : '100%',
              },
            },
            p.renderItem(item, index, { focused: index === focused }),
          ),
        );
      }
    }
    const total = Math.max(0, rows * stride - (p.gap || 0));
    return h(
      'div',
      {
        className: ['kb-vlist', vertical ? 'kb-vlist--vertical' : 'kb-vlist--horizontal', p.className],
        focusGroup: { orientation: columns > 1 ? 'grid' : vertical ? 'vertical' : 'horizontal', wrap: p.wrap, memory: true },
        onKbFocus: this.onItemFocus,
        style: { position: 'relative', overflow: 'hidden', [vertical ? 'height' : 'width']: dp(p.viewportSize) },
      },
      h(
        'div',
        {
          className: 'kb-vlist__content',
          style: {
            position: 'relative',
            [vertical ? 'height' : 'width']: dp(total),
            transform: vertical ? `translateY(${dp(-offset)})` : `translateX(${dp(-offset)})`,
          },
        },
        children,
      ),
    );
  }
}
