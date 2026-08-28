// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { FOOTPRINT_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const FOOTPRINT = settingSignal('FOOTPRINT', FOOTPRINT_FIELDS);
