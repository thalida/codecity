// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { SCRUBBER_FIELDS } from '@/city/settings/fields/scrubber';

export const SCRUBBER = settingSignal('SCRUBBER', SCRUBBER_FIELDS);
