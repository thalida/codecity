// Guard test: every icon name referenced in code must actually exist, so a
// typo or an upstream rename can't silently ship a blank/broken glyph
// (invisible to typecheck/lint). This catches the class of bug that produced
// the broken scene/ + state/ folder icons (folder-3d / folder-redux didn't
// exist at the pinned material-icon-theme version).
//
//   - Material file/folder icons: validated against the pinned
//     material-icon-theme devDependency (the runtime fetches the same pinned
//     version from the CDN).
//   - Lucide UI glyphs: validated against the vendored set under
//     public/icons/lucide/ (what the app actually serves — no runtime CDN).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
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

// vitest runs with cwd = app/
const APP_ROOT = process.cwd();
const MATERIAL_ICONS = join(APP_ROOT, 'node_modules/material-icon-theme/icons');
const LUCIDE_VENDORED = join(APP_ROOT, 'public/icons/lucide');
const SRC = join(APP_ROOT, 'src');

function _walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) _walkTs(p, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

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

describe('lucide: every referenced glyph is vendored', () => {
  // Collect every lucide name used in source:
  //   <LucideIcon name="…">, ACTIVITY_BAR_TABS `icon: '….svg'`, and direct
  //   `${LUCIDE_ICON_BASE_URL}….svg` literals (the activity bar + trash button).
  const referenced = new Set<string>();
  for (const file of _walkTs(SRC)) {
    const txt = readFileSync(file, 'utf8');
    for (const m of txt.matchAll(/<LucideIcon\b[^>]*?\bname="([a-z0-9-]+)"/g)) referenced.add(m[1]);
    for (const m of txt.matchAll(/\bicon:\s*'([a-z0-9-]+)\.svg'/g)) referenced.add(m[1]);
    for (const m of txt.matchAll(/LUCIDE_ICON_BASE_URL\}([a-z0-9-]+)\.svg/g)) referenced.add(m[1]);
  }
  const names = [...referenced].sort();

  it('found the referenced lucide glyphs', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it.each(names)('%s.svg is vendored under public/icons/lucide', (name) => {
    expect(existsSync(join(LUCIDE_VENDORED, `${name}.svg`))).toBe(true);
  });
});
