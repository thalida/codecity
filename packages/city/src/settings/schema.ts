// settings/schema.ts — how a city setting is DECLARED. A field says what it IS
// and what changing it costs. The values, their persistence and their signals
// belong to whoever drives the city, not to the package.

/** A Select field's choices, declared here rather than imported from the view
 *  so state/ stays view-independent. Structurally what the widget renders. */
export interface SelectOption {
  value: string;
  label: string;
}

export enum FieldKind {
  SliderField = 'slider',
  Number = 'number',
  Color = 'color',
  ToggleField = 'toggle',
  Select = 'select',
  RangePairField = 'rangePair',
  /** An ordered array of { min_descendants, width } street tiers — one width
   *  slider per tier. The field's value is the whole array (see STREET_TIERS). */
  TierWidths = 'tierWidths',
  /** A { key: hue } map — one 0–359° hue slider per key, with a swatch preview.
   *  The field's value is the whole object (see BUILDINGS.HUE_EXT_MAP). */
  HueMap = 'hueMap',
}

/** What changing a field requires of the scene. reactions.ts generates its
 *  signatures from this, so nothing keeps a per-store key list. See README.md. */
export enum ChangeRoute {
  Refresh = 'refresh',
  Rebuild = 'rebuild',
  Live = 'live',
}

/** One field's intrinsic definition; `default`'s type flows through to the
 *  store's config type. `route` is required, and reactions.ts reads it. */
export interface FieldDef<T = unknown> {
  kind: FieldKind;
  route: ChangeRoute;
  default: T;
  label: string;
  tip?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: SelectOption[];
}

/** A store's fields: a flat key → FieldDef map. */
export type FieldMap = Record<string, FieldDef>;

/** Derive the persisted config object type from a field map:
 *  { KEY: typeof KEY.default }. */
export type ConfigOf<F extends FieldMap> = { [K in keyof F]: F[K]['default'] };

function clampToBounds(n: number, def: FieldDef): number {
  if (def.min != null && n < def.min) return def.min;
  if (def.max != null && n > def.max) return def.max;
  return n;
}

export function coerceField(value: unknown, def: FieldDef): unknown | undefined {
  switch (def.kind) {
    case FieldKind.SliderField:
    case FieldKind.Number:
      return typeof value === 'number' && Number.isFinite(value)
        ? clampToBounds(value, def)
        : undefined;
    case FieldKind.RangePairField:
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? [clampToBounds(value[0] as number, def), clampToBounds(value[1] as number, def)]
        : undefined;
    case FieldKind.ToggleField:
      return typeof value === 'boolean' ? value : undefined;
    case FieldKind.Select:
      return def.options?.some((o) => o.value === value) ? value : undefined;
    default:
      return typeof value === typeof def.default &&
        Array.isArray(value) === Array.isArray(def.default)
        ? value
        : undefined;
  }
}
