// state/city/context.tsx — which project the chrome around a city is bound
// to. Provided, not global: wrap the app in one session, or wrap each column of
// a side-by-side view in its own, and the same components work either way. The
// city itself takes its config directly and needs none of this.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CitySession } from './session';

const ProjectContext = createContext<CitySession | null>(null);

export function CityProvider({
  session,
  children,
}: {
  session: CitySession;
  children: ComponentChildren;
}) {
  return <ProjectContext.Provider value={session}>{children}</ProjectContext.Provider>;
}

/** The project this part of the tree belongs to. Throws rather than falling back
 *  to a global: reading the wrong project is the bug this shape rules out. */
export function useCity(): CitySession {
  const session = useContext(ProjectContext);
  if (!session) throw new Error('useCity: no <CityProvider> above this component');
  return session;
}
