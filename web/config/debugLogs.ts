// config/debugLogs.ts — Toggles for the verbose diagnostic logs added during
// the cell-rendering refactor. When enabled, the [boot] and [cell] logs print
// to the browser console; when disabled (default), they're silenced.
//
// Persisted to localStorage like other config stores via attachPersistence().

import { map } from 'nanostores';

export interface DebugLogsConfig {
  enabled: boolean;
}

export const DEBUG_LOGS = map<DebugLogsConfig>({
  enabled: false,
});

export function debugBoot(...args: unknown[]): void {
  if (DEBUG_LOGS.get().enabled) {
    console.log(...args);
  }
}

export function debugCell(...args: unknown[]): void {
  if (DEBUG_LOGS.get().enabled) {
    console.log(...args);
  }
}
