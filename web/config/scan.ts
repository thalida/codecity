// config/scan.ts — User-tunable scan filters. Currently a single
// switch: whether to bypass the tracked-files-only filter the scanner
// applies in a git repo. Default OFF preserves current behavior — first
// boot of any session looks the same as it does today.
//
// The store is hydrated from localStorage by attachPersistence(Config)
// and feeds the URL builders in main.ts (manifestUrl / signatureUrl)
// plus a subscriber that re-fetches the manifest on toggle.

import { map } from 'nanostores';

export interface ScanFiltersConfig {
  SHOW_ALL_FILES: boolean;
}

export const SCAN_FILTERS = map<ScanFiltersConfig>({
  SHOW_ALL_FILES: false,
});
