// state/stores/attachCity.ts — put one city onto this app's state, in one call.
//
// The city reports; these are the app's answers. There were five of them, in
// four modules, and a host mounting a canvas had to know all five existed, get
// them in an order, and unsubscribe each — which is a checklist, and a checklist
// is a thing you can be one item short of.
//
// It is one function because it is one decision: THIS is the city this app's
// chrome is about. The landing's wallpaper is a city with no chrome, and it
// simply never gets called.

import type { City } from '@codecity/city';

import { attachSettingsReactions } from '@/state/settings/reactions';
import { attachScanToStores } from '@/hooks/useManifestSource';
import { attachCityChrome } from '@/state/stores/city';
import { attachBuildProgress, attachCityStatus } from '@/state/stores/progress';

/** Mirror one city onto this app's state, and return the one unsubscribe.
 *
 *  Order is not significant — each of these subscribes to the city and writes
 *  its own signals, and none reads another's. It is listed the way a reader
 *  meets them: what it is doing, then what that means for the readout, then
 *  what the reader did in the canvas, then what came back off the wire. */
export function attachCity(city: City): () => void {
  const offs = [
    // What this city is doing, as one value the chrome renders off.
    attachCityStatus(city),
    // The two facts no city reports: what the finished city was built from,
    // and when it finished.
    attachBuildProgress(city),
    // The flash for a Save this city answers by refreshing in place, which is
    // a change with no build behind it to report.
    attachSettingsReactions(city),
    // What the reader does in the canvas, and what this app's chrome does
    // about it.
    attachCityChrome(city.on),
    // The manifest every pane reads, the source kind, and the repo's name.
    attachScanToStores(city.on),
  ];
  return () => {
    for (const off of offs) off();
  };
}
