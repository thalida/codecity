// What the open project is, and the one commit point every view goes through.

import { describe, it, expect, afterEach } from 'vitest';
import { sourceKey } from '@codecity/city';

import { CURRENT_SOURCE, CURRENT_SOURCE_KEY } from '@/state/source';

describe('CURRENT_SOURCE → CURRENT_SOURCE_KEY (derived)', () => {
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    history.replaceState(null, '', '/');
  });

  it('is null when no source is applied', () => {
    CURRENT_SOURCE.value = null;
    expect(CURRENT_SOURCE_KEY.value).toBeNull();
  });

  it('derives the hash from the applied source', () => {
    CURRENT_SOURCE.value = { src: '/foo', branch: 'main' };
    expect(CURRENT_SOURCE_KEY.value).toBe(sourceKey('/foo', 'main'));
  });
});
