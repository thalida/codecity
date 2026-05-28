import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initAppHeader } from '@/views/shell/appHeader.js';

function resetDom() {
  document.body.innerHTML = `
    <header id="app-header-row">
      <div id="app-title"></div>
    </header>
  `;
}

describe('initAppHeader commit selection', () => {
  beforeEach(resetDom);

  it('renders Commit <short-sha> · <author> with focus + copy buttons', () => {
    const onFocus = vi.fn();
    const header = initAppHeader({ rootLabel: 'demo', onFocus });
    header.setSelection({
      kind: 'commit',
      sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
      author: 'Alice Author',
    });
    const title = document.getElementById('app-title')!;
    expect(title.textContent).toContain('Commit');
    expect(title.textContent).toContain('a1b2c3d');
    expect(title.textContent).toContain('Alice Author');
    const focusBtn = title.querySelector('button[aria-label*="Focus" i]') as HTMLButtonElement;
    expect(focusBtn).not.toBeNull();
    focusBtn.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('clears the title when null is passed', () => {
    const header = initAppHeader({ rootLabel: 'demo' });
    header.setSelection({
      kind: 'commit',
      sha: 'a1b2c3d4567890abcdef1234567890abcdef1234',
      author: 'Alice',
    });
    header.setSelection(null);
    expect(document.getElementById('app-title')!.textContent).toBe('');
  });
});
