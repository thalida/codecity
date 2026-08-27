// The landing's wallpaper city is a second city, so it holds a second camera.
// Same fields the scene's camera declares, opening on the backdrop's values:
// the package has one camera vocabulary, and the app keeps a set per city.
import { settingSignal } from '@/state/settings/schema';
import { BACKDROP_CAMERA_FIELDS } from '@/city/settings/fields/camera';

export const HOME_BACKDROP = settingSignal('HOME_BACKDROP', BACKDROP_CAMERA_FIELDS);
