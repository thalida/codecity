import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { CommitChip } from '@/layout/header/CommitChip';

function mountChip(sha: string, authors: string[], onFocus?: () => void) {
  document.body.innerHTML = '<div id="app-title"></div>';
  const slot = document.getElementById('app-title')!;
  render(<CommitChip sha={sha} authors={authors} onFocus={onFocus} />, slot);
  return slot;
}

describe('CommitChip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders Commit <short-sha> · <author> with focus + copy buttons', () => {
    const onFocus = vi.fn();
    const slot = mountChip('a1b2c3d4567890abcdef1234567890abcdef1234', ['Alice Author'], onFocus);
    expect(slot.textContent).toContain('Commit');
    expect(slot.textContent).toContain('a1b2c3d');
    expect(slot.textContent).toContain('Alice Author');
    const focusBtn = slot.querySelector('button[aria-label*="Focus" i]') as HTMLButtonElement;
    expect(focusBtn).not.toBeNull();
    focusBtn.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('renders "<primary> (+N)" for multi-author commits', () => {
    const slot = mountChip('a1b2c3d4567890abcdef1234567890abcdef1234', [
      'Alice Author',
      'Bob Builder',
      'Carol Coder',
    ]);
    expect(slot.textContent).toContain('Alice Author (+2)');
    expect(slot.textContent).not.toContain('Bob Builder');
    expect(slot.textContent).not.toContain('Carol Coder');
  });

  it('renders just "<primary>" with no (+N) suffix for single-author commits', () => {
    const slot = mountChip('a1b2c3d4567890abcdef1234567890abcdef1234', ['Solo Author']);
    expect(slot.textContent).toContain('Solo Author');
    expect(slot.textContent).not.toContain('(+');
  });
});
