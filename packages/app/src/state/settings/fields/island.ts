// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { ISLAND_FIELDS, WORLD_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const ISLAND = settingSignal('ISLAND', ISLAND_FIELDS);
export const WORLD = settingSignal('WORLD', WORLD_FIELDS);
