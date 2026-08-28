// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { TREES_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const TREES = settingSignal('TREES', TREES_FIELDS);
