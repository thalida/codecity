// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { SCRUBBER_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const SCRUBBER = settingSignal('SCRUBBER', SCRUBBER_FIELDS);
