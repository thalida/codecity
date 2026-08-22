// A project session for tests, and the provider a component needs to read one.
// Every test that touches project state makes its own, which is the point of
// the shape: no reset-the-globals dance between cases.

import { render } from 'preact';
import { ProjectProvider } from '@/state/project/context';
import { createProjectSession, type ProjectSession } from '@/state/project/session';
import type { ComponentChildren, VNode } from 'preact';

/** A fresh session, isolated from every other test's. */
export function makeSession(): ProjectSession {
  return createProjectSession();
}

/** Render `ui` inside `session`, the way the app mounts its views. */
export function renderInProject(
  ui: ComponentChildren,
  session: ProjectSession,
  container: HTMLElement
): void {
  render(<ProjectProvider session={session}>{ui}</ProjectProvider>, container);
}

/** The provider as a wrapper, for a test that renders through another helper. */
export function inProject(ui: ComponentChildren, session: ProjectSession): VNode {
  return <ProjectProvider session={session}>{ui}</ProjectProvider>;
}
