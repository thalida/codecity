// config/scan.ts — User-tunable scan filters. SHOW_ALL_FILES bypasses the
// tracked-files-only filter; NO_CACHE bypasses the file-stat + git-history
// caches under ~/.cache/codecity/. Both are hydrated from localStorage by
// attachPersistence(Config) and feed the URL builders in web/url.ts.

import { map } from 'nanostores';

export interface ScanFiltersConfig {
  SHOW_ALL_FILES: boolean;
  NO_CACHE: boolean;
}

export const SCAN_FILTERS = map<ScanFiltersConfig>({
  SHOW_ALL_FILES: false,
  NO_CACHE: false,
});
