// The view's own shape. Every part of it has its own test; what none of them
// covers is the ORDER they land in, which is how a footer once rendered at the
// top of the page — each piece correct, assembled wrong.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';

// jsdom has no WebGL, and this is about layout: the canvas need not build.
vi.mock('@codecity/city/preact', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codecity/city/preact')>()),
  City: () => null,
}));

import { CityView } from '@/features/city/CityView';
import { navigate, ROUTES } from '@/router/location';
import { renderWithServer } from '../../_helpers/query';
import { drainAsync } from '../../_helpers/preact';

describe('CityView', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    navigate(ROUTES.CITY, { replace: true });
    renderWithServer(<CityView />, container);
    await drainAsync();
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    navigate(ROUTES.HOME, { replace: true });
  });

  /** Where each landmark sits among the view's own children. */
  const order = () => {
    const top = Array.from(container.children);
    const at = (sel: string) => top.findIndex((el) => el.matches(sel) || el.querySelector(sel));
    return {
      skip: at('.skip-link'),
      header: at('#city-header'),
      body: top.findIndex((el) => el.id === 'city-body'),
      footer: at('#city-footer'),
    };
  };

  it('puts the header above the city and the footer below it', () => {
    const { header, body, footer } = order();
    expect(header, 'a header').toBeGreaterThanOrEqual(0);
    expect(body, 'the city').toBeGreaterThanOrEqual(0);
    expect(footer, 'a footer').toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(body);
    expect(body).toBeLessThan(footer);
  });

  it('leads with the skip link, so the first tab stop reaches the content', () => {
    const { skip, header } = order();
    expect(skip).toBe(0);
    expect(skip).toBeLessThan(header);
    expect(container.querySelector<HTMLAnchorElement>('.skip-link')!.hash).toBe('#city-body');
  });

  it('gives the sidebars the stage between them', () => {
    const body = container.querySelector('#city-body')!;
    const ids = Array.from(body.children).map((el) => el.id || el.className);
    const left = ids.findIndex((c) => String(c).includes('city-sidebar-left'));
    const stage = ids.findIndex((c) => String(c).includes('city-stage'));
    const right = ids.findIndex((c) => String(c).includes('city-sidebar-right'));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(stage);
    expect(stage).toBeLessThan(right);
  });
});
