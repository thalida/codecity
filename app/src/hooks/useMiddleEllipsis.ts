// hooks/useMiddleEllipsis.ts — the middle-ellipsis measurement as a hook: attach
// the ref and it re-truncates on mount, on deps, and on resize. The measuring
// needs a laid-out element, so it stays imperative inside an effect.

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
