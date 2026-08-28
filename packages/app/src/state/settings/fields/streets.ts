// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { STREETS_FIELDS, STREET_LAYOUT_FIELDS, STREET_TIERS_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const STREETS = settingSignal('STREETS', STREETS_FIELDS);
export const STREET_TIERS = settingSignal('STREET_TIERS', STREET_TIERS_FIELDS);
export const STREET_LAYOUT = settingSignal('STREET_LAYOUT', STREET_LAYOUT_FIELDS);
