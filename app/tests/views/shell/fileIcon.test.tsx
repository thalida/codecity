import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { FileIcon } from '@/views/components/FileIcon';
import { FolderIcon } from '@/views/components/FolderIcon';

// jsdom doesn't actually fetch the icon src — we just validate the
// URL the component picks. The `data-icon-name` data attribute on the
// rendered <img> exposes the resolved icon basename to tests without
// having to parse the URL.

// Preact schedules signal-driven re-renders on the microtask queue.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('FileIcon', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('maps by extension (.ts → typescript)', async () => {
    render(<FileIcon file={{ name: 'coordinator.ts', extension: '.ts' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.classList.contains('file-icon')).toBe(true);
    expect(img.dataset.iconName).toBe('typescript');
    expect(img.src).toContain('typescript.svg');
  });

  it('prefers the filename map over the extension map (package.json → nodejs, not json)', async () => {
    render(<FileIcon file={{ name: 'package.json', extension: '.json' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('nodejs');
  });

  it('handles extensionless filename hints (Dockerfile → docker)', async () => {
    render(<FileIcon file={{ name: 'Dockerfile', extension: '' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('docker');
  });

  it('matches filename map case-insensitively (.GITIGNORE → git)', async () => {
    render(<FileIcon file={{ name: '.GITIGNORE', extension: '' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('git');
  });

  it('falls back to the generic document icon for unknown extensions', async () => {
    render(<FileIcon file={{ name: 'weird.qux', extension: '.qux' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('document');
  });

  it('exposes empty alt + lazy loading for the decorative image', async () => {
    render(<FileIcon file={{ name: 'a.ts', extension: '.ts' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.alt).toBe('');
    // The component renders loading="lazy" as an attribute; jsdom does not
    // reflect it to the HTMLImageElement.loading property, so assert the attr.
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});

describe('FolderIcon', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('maps recognized folder names (src → folder-src)', async () => {
    render(<FolderIcon dir={{ name: 'src' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder-src');
    expect(img.src).toContain('folder-src.svg');
  });

  it('matches case-insensitively (Tests → folder-test)', async () => {
    render(<FolderIcon dir={{ name: 'Tests' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder-test');
  });

  it('falls back to the generic folder for unknown names', async () => {
    render(<FolderIcon dir={{ name: 'idk-whatever' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder');
  });
});
