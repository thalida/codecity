import { describe, it, expect } from 'vitest';
import { makeFileIcon, makeFolderIcon } from '@/views/widgets/fileIcon.js';

// jsdom doesn't actually fetch the icon src — we just validate the
// URL the helper picks. The `data-icon-name` data attribute on the
// returned <img> exposes the resolved icon basename to tests without
// having to parse the URL.

describe('makeFileIcon', () => {
  it('maps by extension (.ts → typescript)', () => {
    const img = makeFileIcon({ name: 'coordinator.ts', extension: '.ts' });
    expect(img.tagName).toBe('IMG');
    expect(img.classList.contains('file-icon')).toBe(true);
    expect(img.dataset.iconName).toBe('typescript');
    expect(img.src).toContain('typescript.svg');
  });

  it('prefers the filename map over the extension map (package.json → nodejs, not json)', () => {
    const img = makeFileIcon({ name: 'package.json', extension: '.json' });
    expect(img.dataset.iconName).toBe('nodejs');
  });

  it('handles extensionless filename hints (Dockerfile → docker)', () => {
    const img = makeFileIcon({ name: 'Dockerfile', extension: '' });
    expect(img.dataset.iconName).toBe('docker');
  });

  it('matches filename map case-insensitively (.GITIGNORE → git)', () => {
    const img = makeFileIcon({ name: '.GITIGNORE', extension: '' });
    expect(img.dataset.iconName).toBe('git');
  });

  it('falls back to the generic document icon for unknown extensions', () => {
    const img = makeFileIcon({ name: 'weird.qux', extension: '.qux' });
    expect(img.dataset.iconName).toBe('document');
  });

  it('exposes empty alt + lazy loading for the decorative image', () => {
    const img = makeFileIcon({ name: 'a.ts', extension: '.ts' });
    expect(img.alt).toBe('');
    expect(img.loading).toBe('lazy');
  });
});

describe('makeFolderIcon', () => {
  it('maps recognized folder names (src → folder-src)', () => {
    const img = makeFolderIcon({ name: 'src' });
    expect(img.dataset.iconName).toBe('folder-src');
    expect(img.src).toContain('folder-src.svg');
  });

  it('matches case-insensitively (Tests → folder-test)', () => {
    const img = makeFolderIcon({ name: 'Tests' });
    expect(img.dataset.iconName).toBe('folder-test');
  });

  it('falls back to the generic folder for unknown names', () => {
    const img = makeFolderIcon({ name: 'idk-whatever' });
    expect(img.dataset.iconName).toBe('folder');
  });
});
