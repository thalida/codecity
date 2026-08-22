import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import {
  UnreachableSource,
  NoticeReason,
} from '@/components/sources/UnreachableSource/UnreachableSource';
import { flush } from '../_helpers/preact';

const SRC = 'https://github.com/owner/private';

const PREAMBLE: Record<NoticeReason, RegExp> = {
  [NoticeReason.Unreachable]: /couldn't reach that repo/i,
  [NoticeReason.PathBlocked]: /couldn't open that path/i,
};

const REMEDY: Record<NoticeReason, RegExp> = {
  [NoticeReason.Unreachable]: /clone it yourself and open the folder/i,
  [NoticeReason.PathBlocked]: /local folders have to be mounted/i,
};

// Three states, not eight. `allowLocal` is the only thing that changes the
// remedy, and a blocked path can only arise while it is false.
const STATES: { reason: NoticeReason; allowLocal: boolean; mounts: boolean }[] = [
  { reason: NoticeReason.Unreachable, allowLocal: true, mounts: false },
  { reason: NoticeReason.Unreachable, allowLocal: false, mounts: true },
  { reason: NoticeReason.PathBlocked, allowLocal: false, mounts: true },
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

  /** `null` means the caller wants no src at all: an explicit `undefined` would
   *  fall through to the default and quietly hand the component SRC. */
  const show = async (reason: NoticeReason, allowLocal: boolean, src: string | null = SRC) => {
    render(
      <UnreachableSource allowLocal={allowLocal} reason={reason} src={src ?? undefined} />,
      container
    );
    await flush();
  };

  const disclose = () => container.querySelector<HTMLButtonElement>('.unreachable-disclose');

  const expand = async () => {
    disclose()!.click();
    await flush();
  };

  for (const { reason, allowLocal, mounts } of STATES) {
    it(`${reason} allowLocal=${allowLocal} -> ${mounts ? 'mount it' : 'open the folder'}`, async () => {
      await show(reason, allowLocal);

      expect(text()).toMatch(PREAMBLE[reason]);
      expect(text()).toMatch(REMEDY[reason]);
      // Neither the other failure's name nor its remedy may leak in.
      for (const other of Object.values(NoticeReason).filter((r) => r !== reason)) {
        expect(text()).not.toMatch(PREAMBLE[other]);
        expect(text()).not.toMatch(REMEDY[other]);
      }
    });
  }

  // The folder is already on the machine. Telling someone to clone it, which the
  // merged copy did, is an instruction to fetch something they are looking at.
  it('never tells a blocked path to clone anything', async () => {
    await show(NoticeReason.PathBlocked, false, null);
    expect(text()).not.toMatch(/clone/i);
    await expand();
    expect(text()).not.toMatch(/clone/i);
  });

  // A failure is the only thing this renders, so it always announces itself.
  it('announces every state it can be in', async () => {
    for (const { reason, allowLocal } of STATES) {
      await show(reason, allowLocal);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      render(null, container);
    }
  });

  // The old copy told an unmounted local instance to "turn on local paths" and
  // left it there. `-e` plus a `-v` IS turning them on, so both audiences get it.
  it('offers a command in every state, never just a link', async () => {
    for (const { reason, allowLocal, mounts } of STATES) {
      await show(reason, allowLocal);
      if (mounts) await expand();
      expect(text()).toContain(mounts ? 'docker run' : 'git clone');
      render(null, container);
    }
  });

  it('hides the run command until asked, then gives the mounted one', async () => {
    await show(NoticeReason.PathBlocked, false, null);
    expect(text()).not.toContain('docker run');
    expect(disclose()!.getAttribute('aria-expanded')).toBe('false');

    await expand();

    expect(disclose()!.getAttribute('aria-expanded')).toBe('true');
    const command = container.querySelector('.unreachable-command--block pre')!.textContent ?? '';
    expect(command).toContain('ghcr.io/thalida/codecity');
    expect(command).toContain('CODECITY_ALLOW_LOCAL_REPOS=1');
    expect(command).toMatch(/-v "\$HOME\/[^"]+:ro"/);
  });

  // Two steps, so both are on offer where the repo to clone is known.
  it('gives the clone and the run together when it knows what failed', async () => {
    await show(NoticeReason.Unreachable, false);
    await expand();
    const commands = [...container.querySelectorAll('.unreachable-command')].map(
      (n) => n.textContent ?? ''
    );
    expect(commands[0]).toContain(`git clone ${SRC}`);
    expect(commands[1]).toContain('docker run');
  });

  it('omits the clone line when there is no source to clone', async () => {
    await show(NoticeReason.Unreachable, true, null);
    expect(text()).not.toContain('git clone');
  });

  // Every state sends people to the same README section, so every state calls it
  // the same thing. It used to be "See docs" here and "Full setup" next door.
  it('always points somewhere to read more, by one name', async () => {
    for (const { reason, allowLocal } of STATES) {
      await show(reason, allowLocal);
      const links = [...container.querySelectorAll('a[href]')];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute('href')).toMatch(/#run-it-yourself$/);
        expect(link.textContent?.replace(/\s+/g, ' ')).toMatch(/setup guide/i);
      }
      render(null, container);
    }
  });

  // GitHub 404s a private repo exactly as it 404s a typo, so claiming privacy
  // would be a guess.
  it('never asserts the repo is private, and never blames the user', async () => {
    for (const { reason, allowLocal } of STATES) {
      await show(reason, allowLocal);
      expect(text()).not.toMatch(/is private/i);
      expect(text()).not.toMatch(/you (do not|don't) have access/i);
      render(null, container);
    }
  });

  it('uses no em-dashes in its copy', async () => {
    for (const { reason, allowLocal, mounts } of STATES) {
      await show(reason, allowLocal);
      if (mounts) await expand();
      expect(text()).not.toContain('—');
      render(null, container);
    }
  });
});
