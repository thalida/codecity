import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import {
  UnreachableSource,
  NoticeReason,
} from '@/components/sources/UnreachableSource/UnreachableSource';
import { flush } from '../_helpers/preact';

type Body = 'clone' | 'run-locally' | 'turn-on';

const BODY: Record<Body, RegExp> = {
  clone: /clone it yourself and open the folder/i,
  'run-locally': /private and local repos work/i,
  'turn-on': /turn on local paths to open a folder on this machine/i,
};

// Every preamble the component can write, so a row can assert the others are
// absent without restating the component's branching here.
const REACHED = /couldn't reach that repo/i;
const NO_SWITCH = /can't reach a folder on your machine/i;
const PATHS_OFF = /local paths are turned off/i;
const ALL_PREAMBLES = [REACHED, NO_SWITCH, PATHS_OFF];

// The extra step, only where turning it on is both possible and needed.
const PREREQ = /turn on local paths, clone it yourself/i;

interface State {
  reason: NoticeReason;
  hosted: boolean;
  allowLocal: boolean;
  body: Body;
  prereq: boolean;
  preamble: RegExp | null;
}

// Every state the form can reach. Hosted never stands: the landing's band
// answers that, so NewProjectForm suppresses the standing notice there.
const STATES: State[] = [
  {
    reason: NoticeReason.Standing,
    hosted: false,
    allowLocal: false,
    body: 'turn-on',
    prereq: false,
    preamble: null,
  },
  {
    reason: NoticeReason.PathBlocked,
    hosted: false,
    allowLocal: false,
    body: 'turn-on',
    prereq: false,
    preamble: PATHS_OFF,
  },
  // Hosted there is no switch to have turned off, so the blocked path is stated
  // as a fact about the deployment instead.
  {
    reason: NoticeReason.PathBlocked,
    hosted: true,
    allowLocal: false,
    body: 'run-locally',
    prereq: false,
    preamble: NO_SWITCH,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: false,
    allowLocal: true,
    body: 'clone',
    prereq: false,
    preamble: REACHED,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: false,
    allowLocal: false,
    body: 'clone',
    prereq: true,
    preamble: REACHED,
  },
  // The deploy DOES produce this: a hosted instance can mount a folder for its
  // own filesystem. hosted wins, because the visitor is not on that machine.
  {
    reason: NoticeReason.Unreachable,
    hosted: true,
    allowLocal: true,
    body: 'run-locally',
    prereq: false,
    preamble: REACHED,
  },
  {
    reason: NoticeReason.Unreachable,
    hosted: true,
    allowLocal: false,
    body: 'run-locally',
    prereq: false,
    preamble: REACHED,
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
    for (const { reason, hosted, allowLocal, preamble } of STATES) {
      await show(reason, hosted, allowLocal);
      const isFailure = reason !== NoticeReason.Standing;

      if (preamble) expect(text()).toMatch(preamble);
      for (const other of ALL_PREAMBLES.filter((p) => p !== preamble)) {
        expect(text()).not.toMatch(other);
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

  // GitHub 404s a private repo exactly as it 404s a typo, so claiming privacy
  // would be a guess.
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
      const links = [...container.querySelectorAll('a[href]')];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link.getAttribute('href')).toMatch(/#run-it-yourself$/);
      render(null, container);
    }
  });

  // Offering the plain `docker run` here would send people to a command that
  // cannot open the repo they just failed to open.
  it('hides the run command until asked, then gives the mounted one', async () => {
    await show(NoticeReason.Unreachable, true, false);
    expect(text()).not.toContain('docker run');

    const disclose = container.querySelector<HTMLButtonElement>('.unreachable-disclose')!;
    expect(disclose.getAttribute('aria-expanded')).toBe('false');

    disclose.click();
    await flush();

    expect(disclose.getAttribute('aria-expanded')).toBe('true');
    const command = container.querySelector('.unreachable-command--block pre')!.textContent ?? '';
    expect(command).toContain('ghcr.io/thalida/codecity');
    expect(command).toContain('CODECITY_ALLOW_LOCAL_REPOS=1');
    expect(command).toMatch(/-v "\$HOME\/[^"]+:ro"/);
  });

  it('offers the run command only where running it yourself is the answer', async () => {
    const withDisclosure: boolean[] = [];
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      withDisclosure.push(container.querySelector('.unreachable-disclose') !== null);
      render(null, container);
    }
    expect(withDisclosure).toEqual(STATES.map((state) => state.hosted));
  });

  it('uses no em-dashes in its copy', async () => {
    for (const { reason, hosted, allowLocal } of STATES) {
      await show(reason, hosted, allowLocal);
      expect(text()).not.toContain('—');
      render(null, container);
    }
  });
});
