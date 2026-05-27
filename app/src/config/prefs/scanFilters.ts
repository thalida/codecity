// config/scan.ts — User-tunable scan filters. NO_CACHE bypasses the
// file-stat + git-history caches under ~/.cache/codecity/. Hydrated from
// localStorage by attachPersistence(Config) and feeds the URL builders
// in app/url.ts.

import { map } from 'nanostores';

export interface ScanFiltersConfig {
  NO_CACHE: boolean;
}

export const SCAN_FILTERS = map<ScanFiltersConfig>({
  NO_CACHE: false,
});
