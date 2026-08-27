// Every icon name the resolvers can produce must be bundled, or an edit to a
// lookup map ships an undefined URL and a blank glyph.

import { describe, it, expect } from 'vitest';
import { EXT_ICON, NAME_ICON, FOLDER_ICON, GENERIC_FILE, GENERIC_FOLDER } from '@codecity/city';
import { MATERIAL_ICON_URLS } from '@codecity/city';

describe('material icons: every resolvable name is bundled', () => {
  const folders = [...Object.values(FOLDER_ICON), GENERIC_FOLDER];
  const names = [
    ...new Set<string>([
      ...Object.values(EXT_ICON),
      ...Object.values(NAME_ICON),
      ...folders,
      // Expanded directories resolve the `-open` twin (getFolderIconName open).
      ...folders.map((n) => `${n}-open`),
      GENERIC_FILE,
    ]),
  ].sort();

  it.each(names)('%s → bundled URL', (name) => {
    expect(MATERIAL_ICON_URLS[name]).toBeTruthy();
  });
});
