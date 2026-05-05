// views/shell/tooltip.js — Tiny floating label that follows the cursor
// on hover. Shown when the user is hovering a building/street; hidden
// otherwise. Inspired by Cities: Skylines / SimCity — every interactive
// object has a brief name label so the city feels alive without forcing
// a sidebar open.

import { TOOLTIP } from '@/config/index.js';
import { DOM_IDS } from '@/constants';

let _el: HTMLElement | null = null;

function _ensure(): HTMLElement {
  // Re-create if the element was removed (test teardown, hot-reload, etc.)
  if (_el && _el.isConnected) return _el;
  _el = document.createElement('div');
  _el.id = DOM_IDS.HOVER_TOOLTIP;
  _el.style.display = 'none';
  document.body.appendChild(_el);
  return _el;
}

// showTooltip(text, x, y) — show with the given text, positioned near cursor
// (with auto-clamp to viewport so it doesn't bleed off-screen).
export function showTooltip(text: string, x: number, y: number): void {
  const el = _ensure();
  el.textContent = text;
  el.style.display = 'block';
  moveTooltip(x, y);
}

// moveTooltip(x, y) — reposition without changing text. Cheap; safe to call
// on every pointermove.
export function moveTooltip(x: number, y: number): void {
  if (!_el) return;
  const cfg = TOOLTIP.get();
  const OFFSET = cfg.OFFSET_PX;
  const MARGIN = cfg.VIEWPORT_MARGIN_PX;
  const w = _el.offsetWidth;
  const h = _el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let px = x + OFFSET;
  let py = y + OFFSET;
  if (px + w + MARGIN > vw) px = x - OFFSET - w;
  if (py + h + MARGIN > vh) py = y - OFFSET - h;
  _el.style.left = `${px}px`;
  _el.style.top = `${py}px`;
}

export function hideTooltip(): void {
  if (_el) _el.style.display = 'none';
}
