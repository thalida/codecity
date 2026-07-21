import { test, expect } from 'vitest';
import { timelineUrlFor } from '@/api/timeline';

test('timelineUrlFor builds the endpoint URL with src', () => {
  const u = timelineUrlFor('/repo', undefined);
  expect(u).toContain('/api/timeline');
  expect(u).toContain('src=%2Frepo');
});
