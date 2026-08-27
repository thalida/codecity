// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { FIREFLIES_FIELDS } from '@/city/settings/fields/fireflies';

export const FIREFLIES = settingSignal('FIREFLIES', FIREFLIES_FIELDS);
