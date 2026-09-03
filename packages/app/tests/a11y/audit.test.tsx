// axe-core over the app's interactive surfaces, plus structural guards for what
// axe-in-jsdom misses: controls inside a <summary>, unnamed form fields, orphan
// labels, positive tabindex. Contrast needs real layout, so that rule is off
// here and verified separately through the OKLCH token math.

import type { DirNode, Manifest } from '@codecity/city';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';

// HomeView's form asks the API for branches the moment it holds a remote URL,
// and a live request rejecting mid-run lands in whichever test is up by then.
vi.mock('@/api/client', async (orig) => {
  const mod = (await orig()) as typeof import('@/api/client');
  return {
    API: { ...mod.API, fetchBranches: vi.fn(async () => ({ branches: [], default: null })) },
  };
});
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import axe from 'axe-core';
import { ControlsPane } from '@/features/city/components/ControlsPane/ControlsPane';
import { DynamicSection } from '@/features/settings/components/DynamicSection/DynamicSection';
import { BUILDINGS_SECTION } from '@/features/city/components/ControlsPane/sectionConfigs/Buildings';
import { HomeView } from '@/features/home/HomeView';
import { DebugMenu } from '@/features/city/components/DebugMenu/DebugMenu';
import { ShortcutsMenu } from '@/features/city/components/ShortcutsMenu/ShortcutsMenu';
import { AppearanceMenu } from '@/features/city/components/AppearanceMenu/AppearanceMenu';
import { TreeTab } from '@/features/city/components/ExplorePane/tabs/TreeTab/TreeTab';
import { CityHeader } from '@/features/city/components/CityHeader/CityHeader';
import { CityFooter } from '@/features/city/components/CityFooter/CityFooter';
import { navigate, ROUTES } from '@/router/location';
import { openShortcuts, SHORTCUTS_OPEN, DEBUG_OPEN } from '@/features/city/state/modals';
import { CURRENT_SOURCE } from '@/state/source';
import { renderWithServer } from '../_helpers/query';
import { renderWithCity } from '../_helpers/cityChrome';
import { fakeCity } from '@codecity/city/testing';

/** Enough of a loaded project for the chrome bars to render everything they
 *  have: the project cluster, the freshness readout and the refresh control. */
function loadedCity(): ReturnType<typeof fakeCity> {
  CURRENT_SOURCE.value = { src: 'https://github.com/o/r', branch: 'main' };
  const city = fakeCity();
  city.setManifest({
    tree: { name: 'o/r', type: 'directory', path: '.', children: [] },
    repo: { remote_url: 'https://github.com/o/r' },
  } as unknown as Manifest);
  return city;
}

/** Click a control by its accessible name, so a surface can be audited in an
 *  opened state rather than only at rest. */
function openByLabel(c: HTMLElement, label: string): void {
  c.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
}

const TREE = {
  name: 'p',
  type: 'directory',
  path: '.',
  children: [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    {
      name: 'src',
      type: 'directory',
      path: 'src',
      children: [{ name: 'b.ts', type: 'file', path: 'src/b.ts' }],
    },
  ],
};

interface Surface {
  name: string;
  mount: (c: HTMLElement) => void;
  /** Lighter mount for the axe scan when the full surface is too large to scan
   *  under CI's coverage instrumentation. Structural guards still use `mount`. */
  axeMount?: (c: HTMLElement) => void;
}

// A timed-out run leaves axe's `_running` latch set (teardown() doesn't clear
// it), cascading failures into every later surface. Not in axe's types.
function resetAxe(): void {
  axe.teardown();
  (axe as unknown as { _running: boolean })._running = false;
}

const SURFACES: Surface[] = [
  {
    name: 'ControlsPane',
    mount: (c) => render(<ControlsPane />, c),
    // The full panel is too slow to axe-scan under coverage; Buildings alone
    // covers every control kind. Disclosures expand: axe skips display:none.
    axeMount: (c) => {
      render(<DynamicSection node={BUILDINGS_SECTION} />, c);
      c.querySelectorAll<HTMLElement>('.controls-disclosure-toggle').forEach((t) => t.click());
    },
  },
  {
    name: 'HomeView',
    mount: (c) => {
      navigate(ROUTES.HOME);
      renderWithServer(<HomeView />, c);
    },
  },
  {
    // Both dropdowns, opened: the menu, its items and the auto-refresh row in
    // the footer slot are only in the DOM while open.
    name: 'HomeView (Discover tab, open-project menu)',
    mount: (c) => {
      navigate(ROUTES.HOME);
      renderWithServer(<HomeView />, c, {
        config: { hosted: true },
        discover: [{ url: 'https://github.com/preactjs/preact', label: 'preact', featured: true }],
      });
      openByLabel(c, 'More ways to open');
    },
  },
  {
    name: 'CityHeader (refresh menu open)',
    mount: (c) => {
      renderWithCity(<CityHeader />, c, loadedCity());
      openByLabel(c, 'More refresh options');
    },
  },
  {
    name: 'CityFooter',
    mount: (c) => renderWithServer(<CityFooter />, c),
  },
  {
    name: 'DebugMenu',
    mount: (c) => {
      DEBUG_OPEN.value = true;
      render(<DebugMenu onRunCollisionCheck={() => {}} onRunStemDiagnostic={() => {}} />, c);
    },
  },
  {
    name: 'ShortcutsMenu',
    mount: (c) => {
      openShortcuts();
      render(<ShortcutsMenu />, c);
    },
  },
  {
    name: 'AppearanceMenu',
    mount: (c) => {
      render(<AppearanceMenu />, c);
      openByLabel(c, 'Appearance');
    },
  },
  {
    name: 'TreePane',
    mount: (c) =>
      render(
        <TreeTab
          manifest={TREE as unknown as DirNode}
          selectedPath={signal(null)}
          hoveredPath={signal(null)}
          expanded={signal(new Set(['.']))}
          rootPath="."
        />,
        c
      ),
  },
];

describe('accessibility audit (issue #79)', () => {
  let mounted: HTMLElement | null = null;
  afterEach(() => {
    if (mounted) {
      render(null, mounted);
      mounted.remove();
      mounted = null;
    }
    DEBUG_OPEN.value = false;
    SHORTCUTS_OPEN.value = false;
    CURRENT_SOURCE.value = null;
    resetAxe();
  });

  function mountSurface(mount: (c: HTMLElement) => void): HTMLElement {
    const c = document.createElement('div');
    document.body.appendChild(c);
    act(() => mount(c));
    mounted = c;
    return c;
  }

  for (const surface of SURFACES) {
    // Generous: CI wall-clock is far worse than a dev box. Blowing it fails
    // only this surface; afterEach unwedges axe.
    it(`${surface.name}: no axe violations`, async () => {
      const c = mountSurface(surface.axeMount ?? surface.mount);
      const results = await axe.run(c, {
        // Only compute violations (skip passes / incomplete / inapplicable) —
        // a large speedup on the big settings DOM so CI doesn't time out.
        resultTypes: ['violations'],
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
      const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
      expect(summary, summary.join(', ')).toEqual([]);
    }, 30_000);

    it(`${surface.name}: passes structural guards`, () => {
      const c = mountSurface(surface.mount);

      // No interactive control nested inside a <summary> (unreliable for AT).
      expect(
        c.querySelectorAll('summary :is(button,a,input,select,textarea,[tabindex])')
      ).toHaveLength(0);

      // Every form field has an id or name (associable + autofillable).
      const namelessFields = Array.from(c.querySelectorAll('input,select,textarea')).filter(
        (f) => !f.id && !f.getAttribute('name')
      );
      expect(
        namelessFields,
        namelessFields.map((f) => f.outerHTML.slice(0, 80)).join(' | ')
      ).toHaveLength(0);

      // No <label> that references a missing id or wraps no control.
      const orphanLabels = Array.from(c.querySelectorAll('label')).filter((l) => {
        const target = l.getAttribute('for');
        if (target) return c.querySelector(`[id="${target}"]`) == null;
        return !l.querySelector('input,select,textarea,button');
      });
      expect(orphanLabels, orphanLabels.map((l) => l.textContent).join(' | ')).toHaveLength(0);

      // No positive tabindex (breaks natural tab order).
      const positiveTab = Array.from(c.querySelectorAll('[tabindex]')).filter(
        (e) => Number(e.getAttribute('tabindex')) > 0
      );
      expect(positiveTab).toHaveLength(0);
    });
  }

  // Guards the cascade fix: a timed-out run leaves `_running` set, which used
  // to make every subsequent surface throw instead of scanning.
  it('a wedged axe latch does not poison the next surface (issue #108)', async () => {
    (axe as unknown as { _running: boolean })._running = true;
    resetAxe();

    const c = mountSurface(SURFACES[SURFACES.length - 1].mount);
    const results = await axe.run(c, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
