// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { GEM_FIELDS, GEM_SIZING_FIELDS, REPO_LABEL_FIELDS } from '@codecity/city';

export const GEM = settingSignal('GEM', GEM_FIELDS);
export const GEM_SIZING = settingSignal('GEM_SIZING', GEM_SIZING_FIELDS);
export const REPO_LABEL = settingSignal('REPO_LABEL', REPO_LABEL_FIELDS);
