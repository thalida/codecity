// city/interaction/tooltip.ts — the small card that follows the cursor while
// you hover a building, street or commit. Imperative show/move/hide, because
// the canvas has no component tree to render into.
import './tooltip.css';
import type { TooltipContent } from './tooltipText';

// Tooltip placement — fixed, not user-tunable.
const TOOLTIP_OFFSET_PX = 14;
const TOOLTIP_VIEWPORT_MARGIN_PX = 4;

let _el: HTMLElement | null = null;

function _ensure(): HTMLElement {
  // Re-create if the element was removed (test teardown, HMR, etc.)
  if (_el && _el.isConnected) return _el;
  _el = document.createElement('div');
  _el.id = 'hover-tooltip';
  _el.className = 'card-tooltip surface-glass';
  _el.style.display = 'none';
  document.body.appendChild(_el);
  return _el;
}

function _line(cls: string, text: string): HTMLElement {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  return line;
}

/** Near the cursor, clamped inside the viewport. Three stacked lines: identity,
 *  location, stats. */
export function showTooltip(content: TooltipContent, x: number, y: number): void {
  const el = _ensure();
  el.textContent = '';

  const title = _line('tooltip-title', content.title);
  if (content.deleted) {
    const badge = document.createElement('span');
    badge.className = 'tooltip-deleted';
    badge.textContent = 'deleted';
    title.prepend(badge, document.createTextNode(' '));
  }
  el.append(title);

  if (content.path) el.append(_line('tooltip-path', content.path));
  if (content.stats.length > 0) {
    el.append(_line('tooltip-stats', content.stats.join('  ·  ')));
  }

  el.style.display = 'block';
  moveTooltip(x, y);
}

// moveTooltip(x, y) — reposition without changing content. Cheap; safe to call
// on every pointermove.
export function moveTooltip(x: number, y: number): void {
  if (!_el) return;
  const OFFSET = TOOLTIP_OFFSET_PX;
  const MARGIN = TOOLTIP_VIEWPORT_MARGIN_PX;
  const w = _el.offsetWidth;
  const h = _el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Below-right, flipping on overflow. The clamp still matters: a card wider
  // than either side overflows whichever way it flips.
  let px = x + OFFSET;
  let py = y + OFFSET;
  if (px + w + MARGIN > vw) px = x - OFFSET - w;
  if (py + h + MARGIN > vh) py = y - OFFSET - h;
  px = Math.min(Math.max(px, MARGIN), Math.max(MARGIN, vw - w - MARGIN));
  py = Math.min(Math.max(py, MARGIN), Math.max(MARGIN, vh - h - MARGIN));

  _el.style.left = `${px}px`;
  _el.style.top = `${py}px`;
}

export function hideTooltip(): void {
  if (_el) _el.style.display = 'none';
}
