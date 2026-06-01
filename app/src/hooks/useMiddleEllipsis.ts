// hooks/useMiddleEllipsis.ts — Preact hook around the middle-ellipsis
// DOM-measurement utility (utils/middleEllipsis). Returns a ref to attach to
// the inline container; re-applies truncation on mount, whenever `deps` change,
// and whenever the width-defining box resizes (via a ResizeObserver).
//
// DOM measurement genuinely needs the laid-out element, so the work stays
// imperative inside an effect — but it's packaged as a hook so components
// just attach the returned ref instead of hand-rolling the observer wiring.

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { applyMiddleEllipsis } from '@/utils/middleEllipsis';

export interface UseMiddleEllipsisOpts {
  /** CSS class of the segment elements inside the container. */
  segmentClass: string;
  /** CSS class of the separator elements. */
  separatorClass: string;
  /** CSS class applied to the inserted `…` placeholder. */
  ellipsisClass: string;
  /** The element whose resize re-triggers truncation — its width is the budget
   *  the content is fit into. Defaults to the container's parent element, which
   *  is correct whenever the container fills its parent. Pass an explicit ref
   *  to observe a specific ancestor (so this works outside the header too). */
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
    const run = () => {
      const segs = Array.from(el.querySelectorAll<HTMLElement>(`.${segmentClass}`));
      const seps = Array.from(el.querySelectorAll<HTMLElement>(`.${separatorClass}`));
      applyMiddleEllipsis(el, segs, seps, { ellipsisClass });
    };
    run();

    // Re-truncate when the width-defining box resizes. Caller can name it via
    // observeRef; otherwise fall back to the container's parent.
    const target = observeRef?.current ?? el.parentElement;
    if (!target) return;
    const ro = new ResizeObserver(run);
    ro.observe(target);
    return () => ro.disconnect();
  }, deps);

  return ref;
}
