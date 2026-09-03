// @codecity/city/preact — the component, and nothing else.
//
// Its own entry point so the package's core stays framework-free: a host that
// never imports this subpath never needs preact, which is why preact is an
// OPTIONAL peer dependency rather than a dependency.

export { City } from './City';
export type { CityProps, CityComponents } from './City';
// The default hover card, exported so a host can wrap it rather than rebuild
// it — and its props, so a replacement is the same shape.
export { DefaultCityTooltip } from './CityTooltip';
export type { CityTooltipProps } from './CityTooltip';

// Which city a subtree is about. The reason two can exist on one page with
// chrome on both: a city is a value passed down, not a slot read up.
export { CityProvider, useCity } from './context';
export type { CityProviderProps } from './context';

// Reading a city from a component. Without these a host writes the bridge
// itself, once per value — which is how this repo's app grew fifteen signals
// across four files before anyone noticed they were the same idea.
//
// Each takes an optional city and otherwise reads the one its subtree is about,
// so ordinary chrome names no city at all and a host holding several can still
// render a panel for a specific one.
export {
  useCityStatus,
  useCityManifest,
  useCitySelection,
  useCitySelectionKey,
  useCityHover,
  useCityTimeline,
} from './hooks';
export type { CityTimelineView } from './hooks';

// A canvas cannot announce what is picked in it; drop this in and it does.
export { SelectionAnnouncer } from './SelectionAnnouncer';
// What a pane needs off the scrub: present paths, the filtered tree, the
// numbers replayed at the position.
export { useScrub, type Scrub } from './useScrub';
