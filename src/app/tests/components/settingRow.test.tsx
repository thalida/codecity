import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { FieldRow } from '@/components/fields/FieldRow/FieldRow';
import { Field } from '@/components/fields/Field/Field';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/settings/fields/buildings';
import { flush } from '../_helpers/preact';

describe('FieldRow layout B', () => {
  let container: HTMLDivElement;
  afterEach(() => {
    if (container) {
      render(null, container);
      container.remove();
    }
  });
  const mount = (ui: preact.ComponentChild) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(ui as never, container);
  };

  it('shows the tip as an inline description when present', async () => {
    mount(
      <FieldRow label="Max floors" tip="Floors for the largest file.">
        <input />
      </FieldRow>
    );
    await flush();
    const desc = container.querySelector('.setting-row-desc');
    expect(desc?.textContent).toBe('Floors for the largest file.');
  });

  it('renders no description element when tip is absent', async () => {
    mount(
      <FieldRow label="Saturation">
        <input />
      </FieldRow>
    );
    await flush();
    expect(container.querySelector('.setting-row-desc')).toBeNull();
  });

  it('marks the row inline when inline is set (toggle/color)', async () => {
    mount(
      <FieldRow label="Enabled" inline>
        <input type="checkbox" />
      </FieldRow>
    );
    await flush();
    expect(container.querySelector('.setting-row')?.classList.contains('setting-row--inline')).toBe(
      true
    );
  });

  it('is stacked (not inline) by default', async () => {
    mount(
      <FieldRow label="Speed">
        <input />
      </FieldRow>
    );
    await flush();
    expect(container.querySelector('.setting-row')?.classList.contains('setting-row--inline')).toBe(
      false
    );
  });

  it('keeps the description out of the row body (accessible name stays just the label text)', async () => {
    mount(
      <FieldRow label="Max floors" tip="Floors for the largest file.">
        <input />
      </FieldRow>
    );
    await flush();
    const main = container.querySelector('.setting-row-main');
    expect(main?.textContent).not.toContain('Floors for the largest file.');
    expect(container.querySelector('.setting-row-desc')?.textContent).toBe(
      'Floors for the largest file.'
    );
  });

  // A <label> with no `for` labels its first labelable descendant, which in
  // this row is the reset button: it took the row's name.
  it('is only a <label> when there is a control to point it at', async () => {
    mount(
      <FieldRow label="Accent">
        <button type="button">swatch</button>
      </FieldRow>
    );
    await flush();
    expect(container.querySelector('.setting-row-main')!.tagName).toBe('DIV');

    render(null, container);
    mount(
      <FieldRow label="Poll interval" htmlFor="poll">
        <input id="poll" />
      </FieldRow>
    );
    await flush();
    expect(container.querySelector('.setting-row-main')!.tagName).toBe('LABEL');
  });
});

describe('Field a11y wiring (description via aria-describedby)', () => {
  let container: HTMLDivElement;
  afterEach(() => {
    if (container) {
      render(null, container);
      container.remove();
    }
  });
  const mount = (ui: preact.ComponentChild) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(ui as never, container);
  };

  it('associates the control with its description when the field has a tip', async () => {
    mount(<Field store={BUILDING_DIMENSIONS} fieldKey="MIN_FLOORS" />);
    await flush();
    const input = container.querySelector('input');
    const desc = container.querySelector('.setting-row-desc');
    expect(desc).not.toBeNull();
    expect(desc?.id).toBeTruthy();
    expect(input?.getAttribute('aria-describedby')).toBe(desc?.id);
  });

  it('renders no description and no aria-describedby when the field has no tip', async () => {
    mount(<Field store={BUILDINGS} fieldKey="OUTLINE_HOVER_OPACITY" />);
    await flush();
    const input = container.querySelector('input');
    expect(container.querySelector('.setting-row-desc')).toBeNull();
    expect(input?.hasAttribute('aria-describedby')).toBe(false);
  });
});
