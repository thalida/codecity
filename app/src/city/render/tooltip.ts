// city/render/tooltip.ts — Tiny floating label that follows the cursor
// on hover. Shown when the user is hovering a building/street; hidden
// otherwise. Inspired by Cities: Skylines / SimCity — every interactive
// object has a brief name label so the city feels alive without forcing
// a sidebar open.
//
// The imperative showTooltip/moveTooltip/hideTooltip API is kept for the
// still-vanilla scene code (picker, inputHandlers) that calls it directly.
// A Preact Tooltip component is not meaningful here because the tooltip is
// driven by Three.js pointer events rather than React-tree state — the
// imperative API IS the right interface for this component.

// Tooltip placement — fixed, not user-tunable.
const TOOLTIP_OFFSET_PX = 14;
const TOOLTIP_VIEWPORT_MARGIN_PX = 4;

let _el: HTMLElement | null = null;

function _ensure(): HTMLElement {
  // Re-create if the element was removed (test teardown, HMR, etc.)
  if (_el && _el.isConnected) return _el;
  _el = document.createElement('div');
  _el.id = 'hover-tooltip';
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
  const OFFSET = TOOLTIP_OFFSET_PX;
  const MARGIN = TOOLTIP_VIEWPORT_MARGIN_PX;
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
