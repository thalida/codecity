// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import {
  STREETS_FIELDS,
  STREET_LAYOUT_FIELDS,
  STREET_TIERS_FIELDS,
} from '@/city/settings/fields/streets';

export const STREETS = settingSignal('STREETS', STREETS_FIELDS);
export const STREET_TIERS = settingSignal('STREET_TIERS', STREET_TIERS_FIELDS);
export const STREET_LAYOUT = settingSignal('STREET_LAYOUT', STREET_LAYOUT_FIELDS);
