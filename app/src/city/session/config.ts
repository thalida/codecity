// state/city/config.ts — what ONE city looks like. Every visual setting the
// renderer reads comes from here rather than from a module singleton, which is
// what lets two cities on screen differ: same fields, its own values.

import { signal, computed, type Signal, type ReadonlySignal } from '@preact/signals';
import { fieldsOf, type ChangeRoute, type SettingStore } from '@/state/settings/schema';
import { BUILDINGS, BUILDING_DIMENSIONS } from './settings/buildings';
import { TREES } from './settings/trees';
import { GEM, GEM_SIZING, REPO_LABEL } from './settings/gem';
import { ISLAND, WORLD } from './settings/island';
import { STREETS, STREET_TIERS, STREET_LAYOUT } from './settings/streets';
import { FOOTPRINT } from './settings/footprint';
import { FIREFLIES } from './settings/fireflies';
import { RUINS } from './settings/ruins';
import { RAINBOW, BLOOM } from './settings/effects';
import { SCENE } from './settings/scene';
import { CAMERA } from './settings/camera';
import { HOME_BACKDROP } from './settings/homeBackdrop';

/** One city's settings. Each section follows the panel until this city is given
 *  its own value for it, so the opened city tracks what you save. */
export class CityConfig {
  // app store -> this city's value for it. Iterated by signature(), so the
  // rebuild trigger is this city's fields, not every city's.
  private readonly sections = new Map<SettingStore, ReadonlySignal<unknown>>();
  private readonly own = new Map<SettingStore, Signal<unknown>>();

  readonly BUILDINGS = this.follow(BUILDINGS);
  readonly BUILDING_DIMENSIONS = this.follow(BUILDING_DIMENSIONS);
  readonly TREES = this.follow(TREES);
  readonly GEM = this.follow(GEM);
  readonly GEM_SIZING = this.follow(GEM_SIZING);
  readonly REPO_LABEL = this.follow(REPO_LABEL);
  readonly ISLAND = this.follow(ISLAND);
  readonly WORLD = this.follow(WORLD);
  readonly STREETS = this.follow(STREETS);
  readonly STREET_TIERS = this.follow(STREET_TIERS);
  readonly STREET_LAYOUT = this.follow(STREET_LAYOUT);
  readonly FOOTPRINT = this.follow(FOOTPRINT);
  readonly FIREFLIES = this.follow(FIREFLIES);
  readonly RUINS = this.follow(RUINS);
  readonly RAINBOW = this.follow(RAINBOW);
  readonly BLOOM = this.follow(BLOOM);
  readonly SCENE = this.follow(SCENE);
  readonly CAMERA = this.follow(CAMERA);
  readonly HOME_BACKDROP = this.follow(HOME_BACKDROP);

  /** Give this city its own value for one section. Nothing calls it yet: the
   *  seam is the point, and the second caller is a city that looks different. */
  override<T>(app: Signal<T>, value: T): void {
    this.own.get(app as SettingStore)!.value = value;
  }

  /** Every field with this route, as one string: what a rebuild keys off. */
  signature(route: ChangeRoute): string {
    let sig = '';
    for (const [app, mine] of this.sections) {
      const values = mine.value as Record<string, unknown>;
      const fields = fieldsOf(app);
      for (const key in fields) {
        if (fields[key].route === route) sig += `${key}=${JSON.stringify(values[key])};`;
      }
    }
    return sig;
  }

  // Its own value when it has one, the panel's until then.
  private follow<T>(app: Signal<T>): ReadonlySignal<T> {
    const own = signal<T | null>(null);
    const mine = computed(() => own.value ?? app.value);
    this.own.set(app as SettingStore, own as Signal<unknown>);
    this.sections.set(app as SettingStore, mine as ReadonlySignal<unknown>);
    return mine;
  }
}
