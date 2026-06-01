// Guard test: every Material file/folder icon name referenced in the maps
// must actually exist, so a typo or an upstream rename can't silently ship a
// blank/broken glyph (the file icons load by name from the pinned
// material-icon-theme CDN, so a bad name 404s at runtime — invisible to
// typecheck/lint). This is the class of bug that produced the broken scene/
// + state/ folder icons (folder-3d / folder-redux didn't exist at @5.30.0).
//
// Lucide UI glyphs need no equivalent test: they're imported as components
// from lucide-preact (see constants/lucideIcons usage removed in favor of
// direct imports), so a wrong name fails at BUILD, not at runtime.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXT_ICON,
  NAME_ICON,
  FOLDER_ICON,
  GENERIC_FILE,
  GENERIC_FOLDER,
  HARD_FALLBACK_FILE,
  HARD_FALLBACK_FOLDER,
} from '@/constants/fileIcons';

// vitest runs with cwd = app/. The runtime fetches the same pinned version
// from the CDN, so validating against the installed package is faithful.
const MATERIAL_ICONS = join(process.cwd(), 'node_modules/material-icon-theme/icons');

describe('material-icon-theme: every referenced icon name exists', () => {
  const names = [
    ...new Set<string>([
      ...Object.values(EXT_ICON),
      ...Object.values(NAME_ICON),
      ...Object.values(FOLDER_ICON),
      GENERIC_FILE,
      GENERIC_FOLDER,
      HARD_FALLBACK_FILE,
      HARD_FALLBACK_FOLDER,
    ]),
  ].sort();

  it('the material-icon-theme package is installed', () => {
    expect(existsSync(MATERIAL_ICONS)).toBe(true);
  });

  it.each(names)('%s.svg exists', (name) => {
    expect(existsSync(join(MATERIAL_ICONS, `${name}.svg`))).toBe(true);
  });
});
