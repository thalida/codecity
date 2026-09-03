// ON_HOME is the one predicate other layers ask about the route, so it has to
// follow the URL rather than any flag someone remembered to set.

import { describe, it, expect, beforeEach } from 'vitest';
import { ON_HOME, ROUTES, navigate } from '@/router/location';

const A_CITY = '/city?src=https%3A%2F%2Fgithub.com%2Fo%2Floaded';

describe('ON_HOME', () => {
  beforeEach(() => navigate(ROUTES.HOME, { replace: true }));

  it('is true on the landing and false on a city', () => {
    expect(ON_HOME.value).toBe(true);
    navigate(A_CITY);
    expect(ON_HOME.value).toBe(false);
  });

  it('follows a Back onto the landing, which no caller announces', () => {
    navigate(A_CITY);
    navigate(ROUTES.HOME); // as a popstate would
    expect(ON_HOME.value).toBe(true);
  });
});
