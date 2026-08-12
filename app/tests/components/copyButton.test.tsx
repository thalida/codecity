import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CopyButton, CopyButtonVariant } from '@/components/CopyButton/CopyButton';
import { CLUSTER_ITEM } from '@/components/ChromeCluster/ChromeCluster';
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

  it('takes the cluster box in a chrome bar, so it matches its neighbours', async () => {
    render(
      <CopyButton variant={CopyButtonVariant.Cluster} text="/repos/x" label="Copy" />,
      container
    );
    await flush();
    expect(button().classList.contains(CLUSTER_ITEM)).toBe(true);
    expect(button().classList.contains('btn-icon')).toBe(false);
  });

  // The copied flash used to be styled only as .btn-icon.is-copied, which the
  // cluster variant never carries — so the header's copy button gave no
  // feedback at all.
  it('flashes copied feedback in both variants', async () => {
    for (const variant of [CopyButtonVariant.Cluster, undefined]) {
      render(<CopyButton variant={variant} text="/repos/x" label="Copy" />, container);
      await flush();
      await act(async () => {
        button().click();
        await Promise.resolve();
      });
      await flush();
      expect(button().classList.contains('is-copied')).toBe(true);
      render(null, container);
    }
  });
});
