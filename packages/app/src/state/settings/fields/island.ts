// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { ISLAND_FIELDS, WORLD_FIELDS } from '@/city/settings/fields/island';

export const ISLAND = settingSignal('ISLAND', ISLAND_FIELDS);
export const WORLD = settingSignal('WORLD', WORLD_FIELDS);
