import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CopyButton } from '@/components/CopyButton/CopyButton';
import { flush } from '../_helpers/preact';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('CopyButton', () => {
  const button = () => container.querySelector('button')!;

  // The button is the same button everywhere: a chrome bar restyles it from
  // the cluster it sits in, rather than the button knowing where it is.
  it('renders one button shape, whatever it sits in', async () => {
    render(<CopyButton text="/repos/x" label="Copy" />, container);
    await flush();
    expect(button().classList.contains('btn-icon')).toBe(true);
  });

  it('flashes copied feedback', async () => {
    render(<CopyButton text="/repos/x" label="Copy" />, container);
    await flush();
    await act(async () => {
      button().click();
      await Promise.resolve();
    });
    await flush();
    expect(button().classList.contains('is-copied')).toBe(true);
  });
});
