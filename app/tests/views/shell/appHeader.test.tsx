import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { HeaderTitle } from '@/views/shell/header/HeaderTitle';
import type { HeaderSelection } from '@/views/shell/header/HeaderTitle';
import { NodeKind } from '@/types';

function mountTitle(sel: HeaderSelection | null, onFocus?: () => void) {
  document.body.innerHTML = '<div id="app-title"></div>';
  const slot = document.getElementById('app-title')!;
  render(
    <HeaderTitle
      sel={sel}
      rootLabel="demo"
      rootPath=""
      onFocus={onFocus}
    />,
    slot
  );
  return slot;
}

describe('HeaderTitle commit selection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders Commit <short-sha> · <author> with focus + copy buttons', () => {
    const onFocus = vi.fn();
    const title = mountTitle(
      {
        kind: NodeKind.Commit,
        sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
        authors: ['Alice Author'],
      },
      onFocus
    );
    expect(title.textContent).toContain('Commit');
    expect(title.textContent).toContain('a1b2c3d');
    expect(title.textContent).toContain('Alice Author');
    const focusBtn = title.querySelector('button[aria-label*="Focus" i]') as HTMLButtonElement;
    expect(focusBtn).not.toBeNull();
    focusBtn.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('renders empty when sel is null', () => {
    const title = mountTitle(null);
    expect(title.textContent).toBe('');
  });

  it('renders "<primary> (+N)" for multi-author commits', () => {
    const title = mountTitle({
      kind: NodeKind.Commit,
      sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
      authors: ['Alice Author', 'Bob Builder', 'Carol Coder'],
    });
    expect(title.textContent).toContain('Alice Author (+2)');
    expect(title.textContent).not.toContain('Bob Builder');
    expect(title.textContent).not.toContain('Carol Coder');
  });

  it('renders just "<primary>" with no (+N) suffix for single-author commits', () => {
    const title = mountTitle({
      kind: NodeKind.Commit,
      sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
      authors: ['Solo Author'],
    });
    expect(title.textContent).toContain('Solo Author');
    expect(title.textContent).not.toContain('(+');
  });
});
