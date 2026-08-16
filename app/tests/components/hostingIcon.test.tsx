import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { HostingIcon } from '@/components/HostingIcon/HostingIcon';
import { flush } from '../_helpers/preact';

describe('HostingIcon', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const glyphFor = async (src: string) => {
    render(<HostingIcon src={src} />, container);
    await flush();
    return container.querySelector('svg')!;
  };

  // One component answers "where does this repo live", so a caller can't show a
  // globe next to a path on disk by forgetting the local branch of a ternary.
  it('draws a folder for a path on disk', async () => {
    expect((await glyphFor('/repos/codecity')).classList.contains('lucide-folder')).toBe(true);
  });

  it('draws a provider mark for a host it knows', async () => {
    const github = await glyphFor('https://github.com/thalida/codecity');
    expect(github.getAttribute('fill')).toBe('currentColor');
    expect(github.querySelector('path')).not.toBeNull();
    // Distinct paths, or one provider is drawing another's mark.
    const gitlab = await glyphFor('https://gitlab.com/thalida/codecity');
    expect(gitlab.querySelector('path')!.getAttribute('d')).not.toBe(
      github.querySelector('path')!.getAttribute('d')
    );
  });

  it('falls back to a globe for a host it does not know', async () => {
    const glyph = await glyphFor('https://git.sr.ht/~thalida/codecity');
    expect(glyph.classList.contains('lucide-globe')).toBe(true);
  });

  // .icon is 1em (icons.css), so the header's 14px chip and the switcher's 16px
  // rows each get a glyph that fits without either one restating a size.
  it('hands every glyph to the caller sized in em', async () => {
    for (const src of [
      '/repos/codecity',
      'https://github.com/thalida/codecity',
      'https://gitlab.com/thalida/codecity',
      'https://bitbucket.org/thalida/codecity',
      'https://git.sr.ht/~thalida/codecity',
    ]) {
      expect((await glyphFor(src)).classList.contains('icon'), src).toBe(true);
    }
  });
});
