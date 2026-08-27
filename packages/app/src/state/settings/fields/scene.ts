// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { settingSignal } from '@/state/settings/schema';
import { SCENE_FIELDS } from '@codecity/city';

export const SCENE = settingSignal('SCENE', SCENE_FIELDS);
