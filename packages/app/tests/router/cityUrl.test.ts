// Dropping a load out of the URL. A cancel with no city to fall back to must
// not leave a reload re-running what it just called off.

import { describe, it, expect, afterEach } from 'vitest';

import { clearSourceUrl } from '@/router/cityUrl';
import { navigate, ROUTES, ROUTE_PATH, ROUTE_PARAMS } from '@/router/location';

describe('clearSourceUrl', () => {
  afterEach(() => navigate(ROUTES.HOME, { replace: true }));

  it('drops the load AND what was being viewed of it, and goes home', () => {
    // A cancel with no city to fall back to leaves the switcher open over
    // nothing: a reload must not re-run the load that was just called off.
    navigate(
      '/city?src=https://github.com/o/r&branch=main&exclude=docs&mode=timeline&commit=abc&sel=file:a.ts'
    );
    clearSourceUrl();

    expect(ROUTE_PATH.value).toBe(ROUTES.HOME);
  });

  it('leaves anything it does not own alone', () => {
    navigate('/city?src=/proj&utm_source=x');
    clearSourceUrl();

    expect(ROUTE_PATH.value).toBe(ROUTES.HOME);
    expect(ROUTE_PARAMS.value.has('src')).toBe(false);
    expect(ROUTE_PARAMS.value.get('utm_source')).toBe('x');
  });
});
