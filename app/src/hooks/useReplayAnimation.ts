// hooks/useReplayAnimation.ts — attach the ref and the element's CSS animation
// runs again whenever `token` changes. A keyed remount won't do it: Preact
// reuses the node, and an animation only starts when one is assigned.

import { useLayoutEffect, useRef } from 'preact/hooks';

export function useReplayAnimation<T extends HTMLElement = HTMLElement>(token: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth; // reflow, so the next assignment counts as a new one
    el.style.animation = '';
  }, [token]);
  return ref;
}
