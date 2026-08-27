// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { BLOOM_FIELDS, RAINBOW_FIELDS } from '@/city/settings/fields/effects';

export const RAINBOW = settingSignal('RAINBOW', RAINBOW_FIELDS);
export const BLOOM = settingSignal('BLOOM', BLOOM_FIELDS);
