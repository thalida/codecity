// components/CityTooltip/CityTooltip.ts — the small card that follows the
// cursor while you hover a building, street or commit. Imperative, because the
// canvas has no component tree to render into: the city reports what the
// pointer is over, and this is the app deciding to draw a card about it.
import './CityTooltip.css';
import type { TooltipContent } from './tooltipContent';

// Tooltip placement — fixed, not user-tunable.
const TOOLTIP_OFFSET_PX = 14;
const TOOLTIP_VIEWPORT_MARGIN_PX = 4;

function _line(cls: string, text: string): HTMLElement {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  return line;
}

export interface CityTooltip {
  /** Draw the card for what the pointer is over, or hide it for null. */
  show(content: TooltipContent | null): void;
  dispose(): void;
}

/** One card for one canvas. It follows the cursor itself: where the pointer is
 *  is a DOM fact the view already has, and the city should not have to report
 *  a position sixty times a second for it. */
export function createCityTooltip(canvas: HTMLElement): CityTooltip {
  const el = document.createElement('div');
  el.id = 'hover-tooltip';
  el.className = 'card-tooltip surface-glass';
  el.style.display = 'none';
  document.body.appendChild(el);

  let x = 0;
  let y = 0;

  function _show(content: TooltipContent): void {
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
    _place();
  }

  // Reposition without changing content. Cheap; safe on every pointermove.
  function _place(): void {
    const OFFSET = TOOLTIP_OFFSET_PX;
    const MARGIN = TOOLTIP_VIEWPORT_MARGIN_PX;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
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

    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
  }

  function _track(e: PointerEvent): void {
    x = e.clientX;
    y = e.clientY;
    if (el.style.display !== 'none') _place();
  }
  canvas.addEventListener('pointermove', _track);

  return {
    show(content) {
      if (content) _show(content);
      else el.style.display = 'none';
    },
    dispose() {
      canvas.removeEventListener('pointermove', _track);
      el.remove();
    },
  };
}
