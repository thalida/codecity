import { NodeKind } from '@codecity/city';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { NodeIcon } from '@/components/nodes/NodeIcon/NodeIcon';
import { flush } from '../_helpers/preact';

// jsdom never fetches the src, so these assert the URL the component picks, via
// the data-icon-name attribute rather than by parsing it.

describe('NodeIcon — files', () => {
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
    render(<NodeIcon node={{ name: 'coordinator.ts', extension: '.ts' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.classList.contains('file-icon')).toBe(true);
    expect(img.dataset.iconName).toBe('typescript');
    // src is now a Vite-bundled asset URL (not a CDN path), so assert it
    // resolved to *something* rather than the old filename pattern.
    expect(img.src).toBeTruthy();
  });

  it('prefers the filename map over the extension map (package.json → nodejs, not json)', async () => {
    render(<NodeIcon node={{ name: 'package.json', extension: '.json' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('nodejs');
  });

  it('handles extensionless filename hints (Dockerfile → docker)', async () => {
    render(<NodeIcon node={{ name: 'Dockerfile', extension: '' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('docker');
  });

  it('matches filename map case-insensitively (.GITIGNORE → git)', async () => {
    render(<NodeIcon node={{ name: '.GITIGNORE', extension: '' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('git');
  });

  it('falls back to the generic document icon for unknown extensions', async () => {
    render(<NodeIcon node={{ name: 'weird.qux', extension: '.qux' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('document');
  });

  it('exposes empty alt + lazy loading for the decorative image', async () => {
    render(<NodeIcon node={{ name: 'a.ts', extension: '.ts' }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.alt).toBe('');
    // The component renders loading="lazy" as an attribute; jsdom does not
    // reflect it to the HTMLImageElement.loading property, so assert the attr.
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});

describe('NodeIcon — directories', () => {
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
    render(<NodeIcon node={{ name: 'src', type: NodeKind.Directory }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder-src');
    expect(img.src).toBeTruthy();
  });

  it('matches case-insensitively (Tests → folder-test)', async () => {
    render(<NodeIcon node={{ name: 'Tests', type: NodeKind.Directory }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder-test');
  });

  it('falls back to the generic folder for unknown names', async () => {
    render(<NodeIcon node={{ name: 'idk-whatever', type: NodeKind.Directory }} />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder');
  });

  it('renders the open-folder variant when expanded (src → folder-src-open)', async () => {
    render(<NodeIcon node={{ name: 'src', type: NodeKind.Directory }} open />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('folder-src-open');
  });

  it('ignores `open` for files (a file has no open variant)', async () => {
    render(<NodeIcon node={{ name: 'a.ts', extension: '.ts' }} open />, container);
    await flush();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.dataset.iconName).toBe('typescript');
  });
});
