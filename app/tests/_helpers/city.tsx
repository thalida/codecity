// A city session for tests, and the provider a component needs to read one.
// Every test that touches city state makes its own, which is the point of the
// shape: no reset-the-globals dance between cases.

import { render } from 'preact';
import { CityProvider } from '@/state/city/context';
import { CitySession } from '@/state/city/session';
import type { ComponentChildren, VNode } from 'preact';

/** A fresh session, isolated from every other test's. */
export function makeSession(): CitySession {
  return new CitySession();
}

/** Render `ui` inside `session`, the way the app mounts its views. */
export function renderInCity(
  ui: ComponentChildren,
  session: CitySession,
  container: HTMLElement
): void {
  render(<CityProvider session={session}>{ui}</CityProvider>, container);
}

/** The provider as a wrapper, for a test that renders through another helper. */
export function inCity(ui: ComponentChildren, session: CitySession): VNode {
  return <CityProvider session={session}>{ui}</CityProvider>;
}
