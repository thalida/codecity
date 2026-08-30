// A command is one city's, plus what this app does to its own screen after it.
// It used to reach a module-level SCENE_HANDLE from inside every function, so
// only one city on the page could be told anything, and a host copying the
// pattern inherited a singleton it never asked for.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FocusMode } from '@codecity/city';
import type { City } from '@codecity/city';
import { cityCommands } from '@/features/city/state/commands';
import { createCityChrome, type CityChromeState } from '@/features/city/state/sidebar';

/** A city that reports whether it found anything to look at. */
function fakeCity(found = true) {
  return {
    focus: vi.fn(() => found),
    picker: {
      hoverByPath: vi.fn(),
      setHover: vi.fn(),
      clearSelection: vi.fn(),
    },
  } as unknown as City;
}

describe('cityCommands', () => {
  // The chrome a command acts on is its own now, the same way the city is: two
  // sets of commands touch two screens.
  let chrome: CityChromeState;
  beforeEach(() => {
    chrome = createCityChrome();
  });

  it('points the city it was bound to, and no other', () => {
    const scene = fakeCity();
    const backdrop = fakeCity();
    const commands = cityCommands(() => scene, chrome);

    commands.focusPath('src/main.ts', FocusMode.Recenter);

    expect(scene.focus).toHaveBeenCalledWith({ path: 'src/main.ts' }, FocusMode.Recenter);
    expect(backdrop.focus).not.toHaveBeenCalled();
  });

  it('drives two cities independently', () => {
    const a = fakeCity();
    const b = fakeCity();
    const forA = cityCommands(() => a, chrome);
    const forB = cityCommands(() => b, chrome);

    forA.goToPath('one.ts');
    forB.goToPath('two.ts');

    expect(a.focus).toHaveBeenCalledWith({ path: 'one.ts' }, undefined);
    expect(b.focus).toHaveBeenCalledWith({ path: 'two.ts' }, undefined);
  });

  // The getter, not a city: the chrome outlives any one instance, and a command
  // issued before the canvas mounts must be a no-op rather than a crash.
  it('does nothing before a city exists', () => {
    const commands = cityCommands(() => null, chrome);
    expect(() => commands.focusPath('src/main.ts')).not.toThrow();
    expect(() => commands.clearSelection()).not.toThrow();
    expect(() => commands.hoverPath('src/main.ts')).not.toThrow();
  });

  describe('and what this app does about it', () => {
    it('clears the details out of the way for a focus', () => {
      const commands = cityCommands(() => fakeCity(), chrome);
      commands.focusPath('src/main.ts');
      expect(chrome.detailsDismissed.value).toBe(true);
    });

    it('opens them for a go-to, which named the node', () => {
      const commands = cityCommands(() => fakeCity(), chrome);
      chrome.dismissDetails();
      commands.goToPath('src/main.ts');
      expect(chrome.detailsDismissed.value).toBe(false);
    });

    // Nothing to look at: the chrome stays where it is rather than clearing
    // itself for a node that is not in this city.
    it('leaves the screen alone when the city found nothing', () => {
      const commands = cityCommands(() => fakeCity(false), chrome);
      commands.focusPath('gone.ts');
      expect(chrome.detailsDismissed.value).toBe(false);
    });

    it('routes a commit the same way as a path', () => {
      const city = fakeCity();
      const commands = cityCommands(() => city, chrome);
      commands.goToCommit('abc123', FocusMode.Recenter);
      expect(city.focus).toHaveBeenCalledWith({ sha: 'abc123' }, FocusMode.Recenter);
      expect(chrome.detailsDismissed.value).toBe(false);
    });

    it('sends hover and clear straight to that city’s picker', () => {
      const city = fakeCity();
      const commands = cityCommands(() => city, chrome);
      commands.hoverPath('src/main.ts');
      commands.clearHover();
      commands.clearSelection();
      expect(city.picker.hoverByPath).toHaveBeenCalledWith('src/main.ts');
      expect(city.picker.setHover).toHaveBeenCalledWith(null);
      expect(city.picker.clearSelection).toHaveBeenCalled();
    });
  });
});
