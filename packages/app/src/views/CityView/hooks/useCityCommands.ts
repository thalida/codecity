// hooks/useCityCommands.ts — this app's chrome commands, pointed at one city.
//
// The city comes from the provider, so a second one on the page gets its own
// set of commands rather than sharing a module constant with the first.

import { useMemo } from 'preact/hooks';
import { useCity } from '@codecity/city/preact';

import { cityCommands, type CityCommands } from '@/views/CityView/state/commands';
import { useCityChrome } from '@/views/CityView/state/sidebar';

export function useCityCommands(): CityCommands {
  const city = useCity();
  const chrome = useCityChrome();
  return useMemo(() => cityCommands(() => city, chrome), [city, chrome]);
}
