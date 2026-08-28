// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { BUILDINGS_FIELDS, BUILDING_DIMENSIONS_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const BUILDING_DIMENSIONS = settingSignal('BUILDING_DIMENSIONS', BUILDING_DIMENSIONS_FIELDS);
export const BUILDINGS = settingSignal('BUILDINGS', BUILDINGS_FIELDS);
