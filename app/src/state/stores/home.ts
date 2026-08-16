// state/stores/home.ts — the landing route's state: whether you are on it, and
// what to tell it when something sent you there.

import { signal, computed } from '@preact/signals';
import { ROUTES } from '@/router/paths';
import { ROUTE_PATH, navigate } from '@/router/location';
import type { HomeOpts } from '@/types/ui';

/** The landing IS home: it shows because of where you are, not because a flag
 *  says so, which is what makes back/forward land on it correctly. */
export const ON_HOME = computed(() => ROUTE_PATH.value === ROUTES.HOME);

export const HOME_OPTS = signal<HomeOpts>({});

/** Go to the landing. A destination the user asked for, so it pushes: Back is
 *  how you return to the city, which is why the view has no close button. */
export function goHome(opts: HomeOpts = {}): void {
  HOME_OPTS.value = opts;
  navigate(ROUTES.HOME);
}

/** Drop a stale error banner without disturbing the prefill. No-ops with no
 *  error, so it is cheap on every keystroke. */
export function clearHomeError(): void {
  const prev = HOME_OPTS.peek();
  if (!prev.error) return;
  HOME_OPTS.value = { ...prev, error: undefined, errorCode: undefined };
}
