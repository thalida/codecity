// state/project/context.tsx — which project the chrome around a city is bound
// to. Provided, not global: wrap the app in one session and the chrome reads
// that one, wrap each column of a side-by-side view in its own and the same
// components read theirs. The city itself takes its config directly and needs
// none of this.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ProjectSession } from './session';

const ProjectContext = createContext<ProjectSession | null>(null);

export function ProjectProvider({
  session,
  children,
}: {
  session: ProjectSession;
  children: ComponentChildren;
}) {
  return <ProjectContext.Provider value={session}>{children}</ProjectContext.Provider>;
}

/** The project this part of the tree belongs to. Throws rather than falling
 *  back to a global: a component reading the wrong project is the bug this
 *  whole shape exists to make impossible. */
export function useProject(): ProjectSession {
  const session = useContext(ProjectContext);
  if (!session) throw new Error('useProject: no <ProjectProvider> above this component');
  return session;
}
