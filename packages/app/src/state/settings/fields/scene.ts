// The city declares these fields; the app owns their values, their
// persistence and the signals the panel binds to.
import { SCENE_FIELDS } from '@codecity/city';
import { settingSignal } from '@/state/settings/schema';

export const SCENE = settingSignal('SCENE', SCENE_FIELDS);
