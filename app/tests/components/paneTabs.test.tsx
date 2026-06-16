import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';

afterEach(() => cleanup());
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';

const tabs = [
  { id: 'world', label: 'World' },
  { id: 'readme', label: 'Readme' },
];

describe('PaneTabs', () => {
  it('renders a tab per entry and marks the active one', () => {
    const { getByRole } = render(<PaneTabs tabs={tabs} active="world" onSelect={() => {}} />);
    expect(getByRole('tab', { name: 'World' }).getAttribute('aria-selected')).toBe('true');
    expect(getByRole('tab', { name: 'Readme' }).getAttribute('aria-selected')).toBe('false');
  });

  it('calls onSelect with the clicked tab id', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />);
    fireEvent.click(getByRole('tab', { name: 'Readme' }));
    expect(onSelect).toHaveBeenCalledWith('readme');
  });

  it('ArrowRight moves selection to the next tab', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<PaneTabs tabs={tabs} active="world" onSelect={onSelect} />);
    fireEvent.keyDown(getByRole('tab', { name: 'World' }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('readme');
  });
});
