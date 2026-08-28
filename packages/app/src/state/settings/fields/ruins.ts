// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { RUINS_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const RUINS = settingSignal('RUINS', RUINS_FIELDS);
