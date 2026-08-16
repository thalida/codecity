// hooks/useMiddleEllipsis.ts — the middle-ellipsis measurement as a hook: attach
// the ref and it re-truncates on mount, on deps, and on resize. The measuring
// needs a laid-out element, so it stays imperative inside an effect.

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

export interface UseMiddleEllipsisOpts {
  /** CSS class of the segment elements inside the container. */
  segmentClass: string;
  /** CSS class of the separator elements. */
  separatorClass: string;
  /** CSS class applied to the inserted `…` placeholder. */
  ellipsisClass: string;
  /** Whose width is the budget. Defaults to the container's parent, which is
   *  right whenever the container fills it. */
  observeRef?: RefObject<HTMLElement | null>;
}

export function useMiddleEllipsis<T extends HTMLElement = HTMLDivElement>(
  opts: UseMiddleEllipsisOpts,
  deps: unknown[] = []
) {
  const ref = useRef<T>(null);
  const { segmentClass, separatorClass, ellipsisClass, observeRef } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Watched for resizes only: the fit is measured on the container, the one
    // box truncation can change. The title clips, so overflow never reaches it.
    const target = observeRef?.current ?? el.parentElement;
    const run = () => {
      const segs = Array.from(el.querySelectorAll<HTMLElement>(`.${segmentClass}`));
      const seps = Array.from(el.querySelectorAll<HTMLElement>(`.${separatorClass}`));
      applyMiddleEllipsis(el, segs, seps, { ellipsisClass });
    };
    run();

    if (!target) return;
    const ro = new ResizeObserver(run);
    ro.observe(target);
    return () => ro.disconnect();
  }, deps);

  return ref;
}

interface ApplyMiddleEllipsisOpts {
  /** CSS class applied to the inserted `…` placeholder span. */
  ellipsisClass: string;
}

/** The leaf can shrink, so a row that stopped overflowing may have managed it
 *  by cutting the one segment that has to go last. Both must hold. */
function _fits(container: HTMLElement, leaf: HTMLElement | undefined): boolean {
  if (container.scrollWidth > container.clientWidth) return false;
  // +1: scrollWidth/clientWidth are rounded, so a sub-pixel width reads as cut.
  return !leaf || leaf.scrollWidth <= leaf.clientWidth + 1;
}

function _removeEllipsis(container: HTMLElement, cls: string): void {
  container.querySelectorAll(`.${cls}`).forEach((el) => el.remove());
}

function _ensureEllipsisAt(
  container: HTMLElement,
  segments: HTMLElement[],
  hiddenStart: number,
  hiddenEnd: number,
  cls: string
): void {
  const hiddenLabels: string[] = [];
  for (let i = hiddenStart; i <= hiddenEnd; i++) {
    if (segments[i].style.display === 'none') {
      hiddenLabels.push(segments[i].textContent ?? '');
    }
  }
  const tooltipText = `Hidden: ${hiddenLabels.join(' › ')}`;

  let ellipsis = container.querySelector<HTMLElement>(`.${cls}`);
  if (!ellipsis) {
    ellipsis = document.createElement('span');
    ellipsis.className = cls;
    ellipsis.textContent = '…';
    // Insert before the first hidden segment (still in the DOM with
    // display:none) so the ellipsis sits where the hidden block starts.
    container.insertBefore(ellipsis, segments[hiddenStart]);
  }
  ellipsis.title = tooltipText;
}

/** Hide separator iff both neighboring segments are hidden. */
function _syncSeparators(segments: HTMLElement[], separators: HTMLElement[]): void {
  for (let i = 0; i < separators.length; i++) {
    const leftHidden = segments[i].style.display === 'none';
    const rightHidden = segments[i + 1].style.display === 'none';
    separators[i].style.display = leftHidden && rightHidden ? 'none' : '';
  }
}

export function applyMiddleEllipsis(
  container: HTMLElement,
  segments: HTMLElement[],
  separators: HTMLElement[],
  opts: ApplyMiddleEllipsisOpts
): void {
  segments.forEach((s) => {
    s.style.display = '';
  });
  separators.forEach((s) => {
    s.style.display = '';
  });
  _removeEllipsis(container, opts.ellipsisClass);

  const last = segments.length - 1;
  const leaf = segments[last];
  if (_fits(container, leaf)) return;

  const mid = Math.floor(segments.length / 2);

  let hiddenStart = -1;
  let hiddenEnd = -1;

  for (let radius = 0; radius < segments.length; radius++) {
    for (const idx of [mid - radius, mid + radius]) {
      if (idx <= 0 || idx >= last) continue;
      if (segments[idx].style.display === 'none') continue;

      segments[idx].style.display = 'none';
      if (hiddenStart === -1 || idx < hiddenStart) hiddenStart = idx;
      if (idx > hiddenEnd) hiddenEnd = idx;

      _syncSeparators(segments, separators);
      _ensureEllipsisAt(container, segments, hiddenStart, hiddenEnd, opts.ellipsisClass);

      if (_fits(container, leaf)) return;
    }
  }

  // The leading crumb goes last of all the crumbs. Past here only the leaf is
  // left, and CSS truncates it.
  if (last > 0 && segments[0].style.display !== 'none') {
    segments[0].style.display = 'none';
    hiddenStart = 0;
    if (hiddenEnd < 0) hiddenEnd = 0;
    _syncSeparators(segments, separators);
    _ensureEllipsisAt(container, segments, hiddenStart, hiddenEnd, opts.ellipsisClass);
  }
}
