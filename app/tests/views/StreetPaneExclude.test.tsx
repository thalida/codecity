import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { StreetPane, type StreetPaneState } from '@/views/StreetPane/StreetPane';
import { NodeKind } from '@/types';

function mount(ui: preact.VNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(ui, host);
  return host;
}

const dir = {
  name: 'vendor',
  type: NodeKind.Directory,
  path: 'vendor',
  children: [],
  descendants_ext_breakdown: [],
} as never;

describe('StreetPane exclude action', () => {
  it('calls onExclude with the directory when the exclude button is clicked', () => {
    const onExclude = vi.fn();
    const state = signal<StreetPaneState>({ directory: dir });
    const host = mount(<StreetPane state={state} onExclude={onExclude} />);
    const btn = host.querySelector<HTMLButtonElement>('button[aria-label*="Exclude"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onExclude).toHaveBeenCalledWith(dir);
  });
});
