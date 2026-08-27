// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { BUILDINGS_FIELDS, BUILDING_DIMENSIONS_FIELDS } from '@/city/settings/fields/buildings';

export const BUILDING_DIMENSIONS = settingSignal('BUILDING_DIMENSIONS', BUILDING_DIMENSIONS_FIELDS);
export const BUILDINGS = settingSignal('BUILDINGS', BUILDINGS_FIELDS);
