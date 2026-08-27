// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { FOOTPRINT_FIELDS } from '@/city/settings/fields/footprint';

export const FOOTPRINT = settingSignal('FOOTPRINT', FOOTPRINT_FIELDS);
