// tests/a11y/audit.test.tsx — Automated accessibility audit (issue #79).
//
// Runs axe-core (the engine behind Chrome's a11y audit) against the app's main
// interactive surfaces, plus tool-independent structural guards for the classes
// axe-in-jsdom can miss: interactive controls nested in a <summary>, form fields
// with no id/name, orphan <label>s, and positive tabindex. This is the backstop
// that keeps the surfaces reviewed here from silently regressing.
//
// Note: axe's color-contrast rule needs real layout, which jsdom lacks — contrast
// is verified separately (OKLCH token math). It's disabled here to avoid noise.

import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import axe from 'axe-core';
import { ControlsPane } from '@/views/ControlsPane/ControlsPane';
import { DynamicSection } from '@/views/ControlsPane/partials';
import { BUILDINGS_SECTION } from '@/views/ControlsPane/partials/Buildings';
import { ProjectsView } from '@/views/ProjectsView/ProjectsView';
import { DebugModal } from '@/views/DebugModal/DebugModal';
import { ShortcutsModal } from '@/views/ShortcutsModal/ShortcutsModal';
import { TreePane } from '@/views/TreePane/TreePane';
import {
  openProjectsView,
  openDebug,
  openShortcuts,
  closeDebug,
  closeShortcuts,
} from '@/state/stores/ui';
import type { DirNode } from '@/types';

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

const SURFACES: Surface[] = [
  {
    name: 'ControlsPane',
    mount: (c) => render(<ControlsPane />, c),
    // The full panel (271 controls) is too slow to axe-scan under coverage.
    // Buildings alone exercises every control kind (color/hue/number/range/
    // select/slider/toggle); expand every disclosure so the controls are
    // visible (axe skips display:none) and scan just that.
    axeMount: (c) => {
      render(<DynamicSection node={BUILDINGS_SECTION} />, c);
      c.querySelectorAll<HTMLElement>('.controls-disclosure-toggle').forEach((t) => t.click());
    },
  },
  {
    name: 'ProjectsView',
    mount: (c) => {
      openProjectsView({ dismissible: true });
      render(<ProjectsView onSubmit={() => {}} onCancel={() => {}} onClose={() => {}} />, c);
    },
  },
  {
    name: 'DebugModal',
    mount: (c) => {
      openDebug();
      render(<DebugModal onRunCollisionCheck={() => {}} onRunStemDiagnostic={() => {}} />, c);
    },
  },
  {
    name: 'ShortcutsModal',
    mount: (c) => {
      openShortcuts();
      render(<ShortcutsModal />, c);
    },
  },
  {
    name: 'TreePane',
    mount: (c) =>
      render(
        <TreePane
          manifest={signal(TREE as unknown as DirNode)}
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
    closeDebug();
    closeShortcuts();
  });

  function mountSurface(mount: (c: HTMLElement) => void): HTMLElement {
    const c = document.createElement('div');
    document.body.appendChild(c);
    act(() => mount(c));
    mounted = c;
    return c;
  }

  for (const surface of SURFACES) {
    // Generous timeout: the settings DOM is large and CI is slower than a dev
    // box. axe is also a singleton — a run that times out mid-flight leaves it
    // "running" and the next surface throws, so it must be allowed to finish.
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
});
