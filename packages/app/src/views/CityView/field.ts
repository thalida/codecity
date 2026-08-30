// utils/field.ts — a typed (store, key) reference for a settings field, so
// naming one that does not exist fails to build.

import type { Signal } from '@preact/signals';
import type { FieldRef } from '@/views/CityView/panes/ControlsPane/types';

/** Reference a field by store + key — `key` must be a key of the store's
 *  config, so typos and dangling refs fail at compile time. */
export function field<T>(store: Signal<T>, key: keyof T & string): FieldRef {
  return { store: store as Signal<unknown>, key };
}
