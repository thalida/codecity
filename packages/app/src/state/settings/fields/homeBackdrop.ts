// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { HOME_BACKDROP_FIELDS } from '@codecity/city';

export const HOME_BACKDROP = settingSignal('HOME_BACKDROP', HOME_BACKDROP_FIELDS);
