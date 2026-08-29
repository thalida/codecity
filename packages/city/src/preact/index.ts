// @codecity/city/preact — the component, and nothing else.
//
// Its own entry point so the package's core stays framework-free: a host that
// never imports this subpath never needs preact, which is why preact is an
// OPTIONAL peer dependency rather than a dependency.

export { City } from './City';
export type { CityProps } from './City';

// Which city a subtree is about. The reason two can exist on one page with
// chrome on both: a city is a value passed down, not a slot read up.
export { CityProvider, useCity } from './context';
export type { CityProviderProps } from './context';
