// constants/routes.ts — the app's paths. Home is the project switcher, so a
// cold boot lands on the list rather than on an empty city.

export const ROUTES = {
  HOME: '/',
  CITY: '/city',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
