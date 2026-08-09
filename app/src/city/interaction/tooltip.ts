// city/interaction/tooltip.ts — Tiny floating card that follows the cursor on
// hover. Shown when the user is hovering a building/street/commit; hidden
// otherwise. Inspired by Cities: Skylines / SimCity — every interactive object
// has a brief label so the city feels alive without forcing a sidebar open.
//
// The imperative showTooltip/moveTooltip/hideTooltip API is kept for the
// still-vanilla scene code (picker, inputHandlers) that calls it directly.
// A Preact Tooltip component is not meaningful here because the tooltip is
// driven by Three.js pointer events rather than React-tree state — the
// imperative API IS the right interface for this component.

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

/**
 * Show the tooltip near the cursor, clamped so it can't leave the viewport.
 * Three stacked lines: identity, location, stats.
 */
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

  // Prefer below-right of the cursor, flipping to the other side when that
  // would overflow. The final clamp matters independently: a card wider than
  // the space on either side overflows whichever way it is flipped, and
  // flipping alone would push it off the opposite edge.
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
