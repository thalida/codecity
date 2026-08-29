// @codecity/city/preact — which city a subtree is about.
//
// The alternative is what this replaces: one module-level slot per city, and
// chrome that reads it. That works until there are two, and then it does not
// work at all — a second city has nowhere to be reflected, so it gets no chrome
// and the host is stuck with one.
//
// A city is a value. Put it in context, and every panel below reads THAT city.
// Two providers, two subtrees, two sets of chrome, no coordination. This is the
// same shape tldraw uses for its Editor and Monaco's wrapper for its editor.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

import type { City } from '../city';

const CityContext = createContext<City | null>(null);

export interface CityProviderProps {
  /** The city this subtree is about. Null before it exists — every hook
   *  answers for that, so a host renders its chrome immediately rather than
   *  gating the whole tree on a canvas that has not finished building. */
  city: City | null;
  children?: ComponentChildren;
}

export function CityProvider({ city, children }: CityProviderProps) {
  return <CityContext.Provider value={city}>{children}</CityContext.Provider>;
}

/** The city this subtree is about, or null before it exists.
 *
 *  Null rather than throwing: a city is built asynchronously, and chrome that
 *  cannot render until it exists would blank the page on every source switch. */
export function useCity(): City | null {
  return useContext(CityContext);
}
