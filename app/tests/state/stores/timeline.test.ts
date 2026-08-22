import { describe, it, expect, beforeEach } from 'vitest';
import { makeCommitBundle } from '../../_helpers/scrub';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

describe('SCRUB_POS range', () => {
  beforeEach(() => {
    session.timeline.reset();
  });

  it('is 0 with no bundle loaded', () => {
    expect(session.timeline.scrubMax.value).toBe(0);
    session.timeline.setScrubPos(5);
    expect(session.timeline.scrubPos.value).toBe(0);
  });

  it('clamps both ends to the loaded bundle', () => {
    session.timeline.bundle.value = makeCommitBundle(4);
    expect(session.timeline.scrubMax.value).toBe(3);

    session.timeline.setScrubPos(-2);
    expect(session.timeline.scrubPos.value).toBe(0);
    session.timeline.setScrubPos(99);
    expect(session.timeline.scrubPos.value).toBe(3);
    session.timeline.setScrubPos(1.5); // float index: scrubbing interpolates between commits
    expect(session.timeline.scrubPos.value).toBe(1.5);
  });

  // Restore paths replay a saved position, so a shorter bundle left it out of
  // range until the next write; clamping against the CURRENT bundle fixes that.
  it('re-clamps when the bundle shrinks, with no new write', () => {
    session.timeline.bundle.value = makeCommitBundle(10);
    session.timeline.setScrubPos(9);
    expect(session.timeline.scrubPos.value).toBe(9);

    session.timeline.bundle.value = makeCommitBundle(3);
    expect(session.timeline.scrubPos.value).toBe(2);
  });

  it('restores the saved position when the bundle grows back', () => {
    session.timeline.bundle.value = makeCommitBundle(10);
    session.timeline.setScrubPos(9);
    session.timeline.bundle.value = makeCommitBundle(3);
    session.timeline.bundle.value = makeCommitBundle(10);
    expect(session.timeline.scrubPos.value).toBe(9);
  });
});

describe('the settled scrub position', () => {
  beforeEach(() => {
    session.timeline.dragging.value = false;
    session.timeline.reset();
    session.timeline.bundle.value = makeCommitBundle(10);
  });

  it('holds still through a drag and lands where it comes to rest', () => {
    session.timeline.setScrubPos(2);
    expect(session.timeline.settledPos.value).toBe(2);
    expect(session.timeline.settledCommit.value).toBe(2);

    session.timeline.dragging.value = true;
    session.timeline.setScrubPos(5);
    session.timeline.setScrubPos(8);
    expect(session.timeline.settledPos.value).toBe(2);
    expect(session.timeline.settledCommit.value).toBe(2);

    session.timeline.dragging.value = false;
    expect(session.timeline.settledPos.value).toBe(8);
    expect(session.timeline.settledCommit.value).toBe(8);
  });

  // SETTLED_COMMIT caps at the newest commit, so it reads the same at the today
  // stop past it — the position is the only one of the two that says "the present".
  it('separates the last commit from the today stop past it', () => {
    session.timeline.bundle.value = makeCommitBundle(10, '2020-01-01T00:00:00Z');
    session.timeline.setTodayMs(Date.parse('2024-01-01T00:00:00Z'));
    expect(session.timeline.scrubMax.value).toBe(10);

    session.timeline.setScrubPos(9);
    expect(session.timeline.settledCommit.value).toBe(9);
    expect(session.timeline.settledPos.value).toBe(9);

    session.timeline.setScrubPos(10);
    expect(session.timeline.settledCommit.value).toBe(9);
    expect(session.timeline.settledPos.value).toBe(10);
  });
});
