import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { UnreachableSource, NoticeReason } from '@/components/UnreachableSource/UnreachableSource';
import { flush } from '../_helpers/preact';

type Body = 'clone' | 'run-locally' | 'turn-on';

const BODY: Record<Body, RegExp> = {
  clone: /clone it yourself and open the folder/i,
  'run-locally': /need codecity running on your own machine/i,
  'turn-on': /turn on local paths to open a folder on this machine/i,
};

const PREAMBLE: Record<NoticeReason, RegExp | null> = {
  [NoticeReason.Standing]: null,
  [NoticeReason.Unreachable]: /couldn't reach that repo/i,
  [NoticeReason.PathBlocked]: /local paths are turned off/i,
};

// The extra step, only where turning it on is both possible and needed.
const PREREQ = /turn on local paths, clone it yourself/i;

// Every state the form can actually reach. standing and path-blocked both
// require local paths to be off (the form gates them on it), so a mounted
// instance only ever produces the unreachable rows.
const STATES: {
  reason: NoticeReason;
  hosted: boolean;
  allowLocal: boolean;
  body: Body;
  prereq: boolean;
}[] = [
  {
    reason: NoticeReason.Standing,
    hosted: false,
    allowLocal: false,
    body: 'turn-on',
    prereq: false,
  },
  {
    reason: NoticeReason.Standing,
    hosted: true,
    allowLocal: false,
    body: 'run-locally',
    prereq: false,
  },
  {
    reason: NoticeReason.PathBlocked,
    hosted: false,
    allowLocal: false,
    body: 'turn-on',
    prereq: false,
  },
  {
    reason: NoticeReason.PathBlocked,
    hosted: true,
    allowLocal: false,
    body: 'run-locally',
    prereq: false,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: false,
    allowLocal: true,
    body: 'clone',
    prereq: false,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: false,
    allowLocal: false,
    body: 'clone',
    prereq: true,
  },
  // The deploy DOES produce this: a hosted instance can mount a folder for its
  // own filesystem. hosted wins, because the visitor is not on that machine.
  {
    reason: NoticeReason.Unreachable,
    hosted: true,
    allowLocal: true,
    body: 'run-locally',
    prereq: false,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: true,
    allowLocal: false,
    body: 'run-locally',
    prereq: false,
  },
];

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

  const show = async (reason: NoticeReason, hosted: boolean, allowLocal: boolean) => {
    render(
      <UnreachableSource
        hosted={hosted}
        allowLocal={allowLocal}
        reason={reason}
        src="https://github.com/owner/repo"
      />,
      container
    );
    await flush();
  };

  for (const { reason, hosted, allowLocal, body, prereq } of STATES) {
    it(`${reason} hosted=${hosted} allowLocal=${allowLocal} -> ${body}${prereq ? ' + prereq' : ''}`, async () => {
      await show(reason, hosted, allowLocal);

      expect(text()).toMatch(BODY[body]);
      // Exactly one body, never two.
      for (const other of (Object.keys(BODY) as Body[]).filter((b) => b !== body)) {
        expect(text()).not.toMatch(BODY[other]);
      }
      // A hosted visitor can't turn local paths on, and a mounted instance has
      // nothing to turn on, so the extra step must not leak into either.
      expect(PREREQ.test(text())).toBe(prereq);
    });
  }

  // The trap this component fell into: an empty field carrying instructions for
  // a failure that hasn't happened.
  it('states a capability when standing, and never a remedy', async () => {
    for (const hosted of [false, true]) {
      await show(NoticeReason.Standing, hosted, false);
      expect(text()).not.toMatch(/clone it yourself/i);
      expect(text()).not.toMatch(PREREQ);
      render(null, container);
    }
  });

  it('names what happened in the preamble, and only when something did', async () => {
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      const expected = PREAMBLE[reason];
      const isFailure = reason !== NoticeReason.Standing;

      if (expected) expect(text()).toMatch(expected);
      for (const other of (Object.keys(PREAMBLE) as NoticeReason[]).filter((v) => v !== reason)) {
        const marker = PREAMBLE[other];
        if (marker) expect(text()).not.toMatch(marker);
      }
      // A failure announces itself; guidance must not.
      expect(container.querySelector('[role="alert"]') !== null).toBe(isFailure);
      expect(container.querySelector('.unreachable--error') !== null).toBe(isFailure);
      render(null, container);
    }
  });

  it("shows the git clone line only where a folder is the viewer's to open", async () => {
    const withClone: boolean[] = [];
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      withClone.push(text().includes('git clone https://github.com/owner/repo'));
      render(null, container);
    }
    // Cloning is the answer to an unreachable repo on your own machine. It is
    // not an answer to a path this instance won't take, nor to a hosted one.
    expect(withClone).toEqual(
      STATES.map((s) => s.reason === NoticeReason.Unreachable && !s.hosted)
    );
  });

  it('omits the clone line when there is no source to clone', async () => {
    render(
      <UnreachableSource hosted={false} allowLocal reason={NoticeReason.Unreachable} />,
      container
    );
    await flush();
    expect(text()).not.toContain('git clone');
  });

  // GitHub 404s a private repo to an unauthenticated caller exactly as it 404s
  // a typo, so claiming privacy would be a guess; and "you don't have access"
  // blames the user for a property of this server.
  it('never asserts the repo is private, and never blames the user', async () => {
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      expect(text()).not.toMatch(/is private/i);
      expect(text()).not.toMatch(/you (do not|don't) have access/i);
      render(null, container);
    }
  });

  it('always points somewhere to read more', async () => {
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      const link = container.querySelector('.unreachable-remedy a');
      expect(link?.getAttribute('href')).toMatch(/#(local-directories|run-it-yourself)$/);
      render(null, container);
    }
  });

  it('uses no em-dashes in its copy', async () => {
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      expect(text()).not.toContain('—');
      render(null, container);
    }
  });
});
