import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { UnreachableSource } from '@/components/UnreachableSource/UnreachableSource';
import { flush } from '../_helpers/preact';

// The remedy is a function of the server, not of the trigger. This table is the
// spec's remedy matrix: three server shapes times two triggers, and the trigger
// column must never change which remedy appears.
type Remedy = 'clone' | 'run-locally' | 'enable-local';

const MATRIX: { hosted: boolean; allowLocal: boolean; remedy: Remedy }[] = [
  { hosted: false, allowLocal: true, remedy: 'clone' },
  // hosted + allowLocal is not a shape the deploy produces, but the remedy is
  // keyed on allowLocal first, so it must still resolve to something coherent.
  { hosted: true, allowLocal: true, remedy: 'clone' },
  { hosted: true, allowLocal: false, remedy: 'run-locally' },
  { hosted: false, allowLocal: false, remedy: 'enable-local' },
];

const MARKER: Record<Remedy, RegExp> = {
  clone: /clone it yourself and open the folder/i,
  'run-locally': /need codecity running on your own machine/i,
  'enable-local': /Local paths aren't enabled/i,
};

describe('UnreachableSource', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const text = () => container.textContent ?? '';

  for (const { hosted, allowLocal, remedy } of MATRIX) {
    for (const variant of ['standing', 'error'] as const) {
      it(`hosted=${hosted} allowLocal=${allowLocal} ${variant} -> ${remedy}`, async () => {
        render(
          <UnreachableSource
            hosted={hosted}
            allowLocal={allowLocal}
            variant={variant}
            src="https://github.com/owner/repo"
          />,
          container
        );
        await flush();
        expect(text()).toMatch(MARKER[remedy]);
        // Exactly one remedy, never two.
        const others = (Object.keys(MARKER) as Remedy[]).filter((r) => r !== remedy);
        for (const other of others) expect(text()).not.toMatch(MARKER[other]);
      });
    }
  }

  it('shows the git clone line in exactly the allowLocal cells', async () => {
    const withClone: boolean[] = [];
    for (const { hosted, allowLocal } of MATRIX) {
      render(
        <UnreachableSource
          hosted={hosted}
          allowLocal={allowLocal}
          variant="error"
          src="https://github.com/owner/repo"
        />,
        container
      );
      await flush();
      withClone.push(text().includes('git clone https://github.com/owner/repo'));
      render(null, container);
    }
    expect(withClone).toEqual(MATRIX.map((row) => row.allowLocal));
  });

  it('omits the clone line when there is no source to clone', async () => {
    render(<UnreachableSource hosted={false} allowLocal variant="standing" />, container);
    await flush();
    expect(text()).not.toContain('git clone');
  });

  it('the error variant adds a preamble and the standing variant does not', async () => {
    render(<UnreachableSource hosted allowLocal={false} variant="error" src="x" />, container);
    await flush();
    expect(text()).toContain("Couldn't reach that repo.");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    render(<UnreachableSource hosted allowLocal={false} variant="standing" src="x" />, container);
    await flush();
    expect(text()).not.toContain("Couldn't reach that repo.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  // GitHub 404s a private repo to an unauthenticated caller exactly as it 404s
  // a typo, so claiming privacy would be a guess; and "you don't have access"
  // blames the user for a property of this server.
  it('never asserts the repo is private, and never blames the user', async () => {
    for (const { hosted, allowLocal } of MATRIX) {
      for (const variant of ['standing', 'error'] as const) {
        render(
          <UnreachableSource
            hosted={hosted}
            allowLocal={allowLocal}
            variant={variant}
            src="https://github.com/owner/repo"
          />,
          container
        );
        await flush();
        expect(text()).not.toMatch(/is private/i);
        expect(text()).not.toMatch(/you (do not|don't) have access/i);
        render(null, container);
      }
    }
  });

  it('uses no em-dashes in its copy', async () => {
    for (const { hosted, allowLocal } of MATRIX) {
      render(
        <UnreachableSource hosted={hosted} allowLocal={allowLocal} variant="error" src="x" />,
        container
      );
      await flush();
      expect(text()).not.toContain('—');
      render(null, container);
    }
  });
});
