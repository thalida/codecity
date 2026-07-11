// Guard test: every Material icon basename the resolvers (utils/fileIcons.ts)
// can produce must be bundled in MATERIAL_ICON_URLS — otherwise an edit to a
// lookup map that adds a new icon without regenerating constants/materialIcons
// would ship a broken <img>/atlas glyph (undefined URL). This is the class of
// bug that produced the blank scene/ + state/ folder icons.
//
// The generated `?url` imports in materialIcons.ts are themselves build-checked
// against the pinned material-icon-theme package — a name with no file fails
// the build. Lucide glyphs need no test at all: they're imported as components.

import { describe, it, expect } from 'vitest';
import {
  EXT_ICON,
  NAME_ICON,
  FOLDER_ICON,
  GENERIC_FILE,
  GENERIC_FOLDER,
  HARD_FALLBACK_FILE,
  HARD_FALLBACK_FOLDER,
} from '@/constants/fileIcons';
import { MATERIAL_ICON_URLS } from '@/constants/materialIcons';

describe('material icons: every resolvable name is bundled', () => {
  const folders = [...Object.values(FOLDER_ICON), GENERIC_FOLDER, HARD_FALLBACK_FOLDER];
  const names = [
    ...new Set<string>([
      ...Object.values(EXT_ICON),
      ...Object.values(NAME_ICON),
      ...folders,
      // Expanded directories resolve the `-open` twin (getFolderIconName open).
      ...folders.map((n) => `${n}-open`),
      GENERIC_FILE,
      HARD_FALLBACK_FILE,
    ]),
  ].sort();

  it.each(names)('%s → bundled URL', (name) => {
    expect(MATERIAL_ICON_URLS[name]).toBeTruthy();
  });
});
