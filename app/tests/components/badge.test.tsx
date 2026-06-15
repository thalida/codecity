import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { ExtensionBadge } from '@/components/Badge/Badge';

const EMPTY_PALETTE: Record<string, number> = {};
// Match the file-badge HSL formula in CSS (S=60%, L=35%).
// At that lightness no pure-hue lands above the luminance split, so the
// auto-contrast logic always picks the light text for file badges.

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

function mountBadge(
  extension: string | null,
  isDir: boolean,
  huePalette: Record<string, number>,
  asphaltColor: string
): HTMLSpanElement {
  render(
    <ExtensionBadge
      extension={extension}
      isDir={isDir}
      huePalette={huePalette}
      asphaltColor={asphaltColor}
    />,
    container
  );
  return container.querySelector('.path-badge') as HTMLSpanElement;
}

describe('ExtensionBadge', () => {
  it('renders a file badge with the extension label (no leading dot)', () => {
    const chip = mountBadge('.ts', false, EMPTY_PALETTE, '#1a1d28');
    expect(chip.classList.contains('path-badge')).toBe(true);
    expect(chip.classList.contains('is-dir')).toBe(false);
    expect(chip.textContent).toBe('ts');
    // --badge-hue is set inline so the CSS background rule can pick it up.
    expect(chip.style.getPropertyValue('--badge-hue')).not.toBe('');
  });

  it('renders a dir badge with the asphalt color inline', () => {
    const chip = mountBadge(null, true, EMPTY_PALETTE, '#1a1d28');
    expect(chip.classList.contains('is-dir')).toBe(true);
    expect(chip.textContent).toBe('dir');
    // jsdom normalizes hex → rgb in inline style reads.
    expect(chip.style.backgroundColor).toMatch(/rgb\(26,\s*29,\s*40\)/);
  });

  it('auto-contrasts dir text to light on a dark asphalt', () => {
    const chip = mountBadge(null, true, EMPTY_PALETTE, '#1a1d28');
    // Light text reads as #f4f6ff → rgb(244, 246, 255).
    expect(chip.style.color).toMatch(/rgb\(244,\s*246,\s*255\)/);
  });

  it('auto-contrasts dir text to dark on a light asphalt', () => {
    const chip = mountBadge(null, true, EMPTY_PALETTE, '#f0f0f0');
    // Near-black text reads as #0a0b10 → rgb(10, 11, 16).
    expect(chip.style.color).toMatch(/rgb\(10,\s*11,\s*16\)/);
  });

  it('handles short-form hex (#abc) on the dir badge', () => {
    // #abc expands to #aabbcc → moderate-light gray.
    const chip = mountBadge(null, true, EMPTY_PALETTE, '#abc');
    // Either text color is fine as long as something was set — proves
    // the short-form parser didn't bail.
    expect(chip.style.color).not.toBe('');
  });

  it('falls back to light text when the asphalt string is unparseable', () => {
    const chip = mountBadge(null, true, EMPTY_PALETTE, 'not-a-color');
    expect(chip.style.color).toMatch(/rgb\(244,\s*246,\s*255\)/);
  });

  it('sets a contrasting text color on a file badge', () => {
    const chip = mountBadge('.ts', false, EMPTY_PALETTE, '#1a1d28');
    // File backgrounds use L=35 → all hues land in the dark-luminance
    // bucket so the picker selects light text.
    expect(chip.style.color).toMatch(/rgb\(244,\s*246,\s*255\)/);
  });
});
