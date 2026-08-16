// router/paths.ts — the app's paths, and what they mean. Home is the landing,
// so a cold boot lands on the project list rather than on an empty city.

import { computed } from '@preact/signals';
import { ROUTE_PATH } from './location';

export const ROUTES = {
  HOME: '/',
  CITY: '/city',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/** On the landing: it shows because of where you are, not because a flag says
 *  so, which is what makes back and forward land on it correctly. */
export const ON_HOME = computed(() => ROUTE_PATH.value === ROUTES.HOME);
