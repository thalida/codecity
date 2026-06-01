// hooks/useMiddleEllipsis.ts — Preact hook around the middle-ellipsis
// DOM-measurement utility (utils/middleEllipsis). Returns a ref to attach to
// the inline breadcrumb container; re-applies truncation on mount, whenever
// `deps` change, and on header/parent resize (via a ResizeObserver).
//
// DOM measurement genuinely needs the laid-out element, so the work stays
// imperative inside an effect — but it's packaged as a hook so components
// just attach the returned ref instead of hand-rolling the observer wiring.

import { useEffect, useRef } from 'preact/hooks';
import { applyMiddleEllipsis } from '@/utils/middleEllipsis';

export interface UseMiddleEllipsisOpts {
  /** CSS class of the segment elements inside the container. */
  segmentClass: string;
  /** CSS class of the separator elements. */
  separatorClass: string;
  /** CSS class applied to the inserted `…` placeholder. */
  ellipsisClass: string;
}

export function useMiddleEllipsis<T extends HTMLElement = HTMLDivElement>(
  opts: UseMiddleEllipsisOpts,
  deps: unknown[] = []
) {
  const ref = useRef<T>(null);
  const { segmentClass, separatorClass, ellipsisClass } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = () => {
      const segs = Array.from(el.querySelectorAll<HTMLElement>(`.${segmentClass}`));
      const seps = Array.from(el.querySelectorAll<HTMLElement>(`.${separatorClass}`));
      applyMiddleEllipsis(el, segs, seps, { ellipsisClass });
    };
    run();

    // Re-truncate when the header row resizes.
    const parentRow = el.closest('header, [id]') as HTMLElement | null;
    if (!parentRow) return;
    const ro = new ResizeObserver(run);
    ro.observe(parentRow);
    return () => ro.disconnect();
  }, deps);

  return ref;
}
