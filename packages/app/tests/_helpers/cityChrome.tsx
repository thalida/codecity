// Rendering a chrome component that reads a city. Panels take the city their subtree is about
// now, so a test has to give them one. Building a real city for a panel that shows a filename
// would be a WebGL context nobody asked for; `fakeCity` is the same surface without the GPU.

import { render, type ComponentChildren } from 'preact';
import { CityProvider } from '@codecity/city/preact';
import {
  CityChromeProvider,
  createCityChrome,
  type CityChromeState,
} from '@/features/city/state/sidebar';
import { fakeCity } from '@codecity/city/testing';

export type FakeCity = ReturnType<typeof fakeCity>;

/** Render `ui` with a city under it, and hand back the city so a test can
 *  drive it. */
export function renderWithCity(
  ui: ComponentChildren,
  host: HTMLElement,
  city: FakeCity = fakeCity(),
  chrome: CityChromeState = createCityChrome()
): FakeCity {
  render(
    <CityProvider city={city as never}>
      <CityChromeProvider value={chrome}>{ui}</CityChromeProvider>
    </CityProvider>,
    host
  );
  return city;
}
