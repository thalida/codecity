// config/scene.js — Scene-wide background colors (the void behind everything).
// Hot-reloadable — applyTheme() listens for changes and updates scene.background.

import { map } from 'nanostores';

export const SCENE_COLORS = map({
  GROUND: '#0a0b10'   // sky / void color behind everything
});
