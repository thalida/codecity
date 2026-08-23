// city/CityProvider.tsx — which city the chrome around it is looking at. Wrap
// the app in one session, or wrap each column of a side-by-side view in its
// own, and the same components work either way. <City> itself is handed a
// session directly and needs none of this.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CitySession } from './session/session';

const CityContext = createContext<CitySession | null>(null);

export function CityProvider({
  session,
  children,
}: {
  session: CitySession;
  children: ComponentChildren;
}) {
  return <CityContext.Provider value={session}>{children}</CityContext.Provider>;
}

/** The city this part of the tree belongs to. Throws rather than falling back
 *  to a global: reading the wrong city is the bug this shape rules out. */
export function useCity(): CitySession {
  const session = useContext(CityContext);
  if (!session) throw new Error('useCity: no <CityProvider> above this component');
  return session;
}
