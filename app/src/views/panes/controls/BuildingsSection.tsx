// views/panes/controls/BuildingsSection.tsx — Per-file boxes: height from
// line count, width from byte size, color from extension + age. The
// largest section by far (layout, transitions, palette, per-extension
// hues, outlines, facade, aging, selection fade).

import {
  BUILDING_DIMENSIONS,
  BUILDINGS,
  BUILDING_FADE,
} from '@/state/settings/index';
import {
  FACADE_GEOMETRY,
  FACADE_DETAIL,
  WINDOW_LIGHTING,
} from '@/state/settings/components/facade';
import { AD_PANEL } from '@/state/settings/components/adPanels';
import { FadeDetail } from '@/types';
import { getDefault } from '@/state/persist';
import { Section } from './Section';
import { CollapsibleSubgroup } from './CollapsibleSubgroup';
import {
  ColorField,
  NestedSliderField,
  NumberField,
  RangePairField,
  SelectField,
  SliderField,
  ToggleField,
} from './Fields';

const DETAIL_OPTIONS = [
  { value: FadeDetail.Full, label: 'Full' },
  { value: FadeDetail.Silhouette, label: 'Silhouette' },
  { value: FadeDetail.Hidden, label: 'Hidden' },
];

function FadeTier({
  groupName,
  prefix,
}: {
  groupName: string;
  prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4';
}) {
  const detailTip =
    prefix === 'DEFAULT'
      ? 'Full = textured walls + windows + doors. Silhouette = solid-color box. Hidden = body invisible (only outline can show).'
      : undefined;
  return (
    <CollapsibleSubgroup name={groupName}>
      <SelectField
        label="Detail"
        store={BUILDING_FADE}
        fieldKey={`${prefix}_DETAIL`}
        options={DETAIL_OPTIONS}
        tip={detailTip}
      />
      <ToggleField
        label="Outline"
        store={BUILDING_FADE}
        fieldKey={`${prefix}_OUTLINE`}
        tip={prefix === 'DEFAULT' ? 'Show the wireframe edge overlay.' : undefined}
      />
      <SliderField
        label="Body opacity"
        store={BUILDING_FADE}
        fieldKey={`${prefix}_BODY_OPACITY`}
        min={0}
        max={1}
        step={0.05}
        tip={prefix === 'DEFAULT' ? 'Opacity for the body / silhouette layer.' : undefined}
      />
      <SliderField
        label="Outline opacity"
        store={BUILDING_FADE}
        fieldKey={`${prefix}_OUTLINE_OPACITY`}
        min={0}
        max={1}
        step={0.05}
        tip={prefix === 'DEFAULT' ? 'Opacity for the wireframe outline layer (only visible if Outline is on).' : undefined}
      />
    </CollapsibleSubgroup>
  );
}

export function BuildingsSection() {
  const hueDefaults = (getDefault(BUILDINGS, 'HUE_EXT_MAP') as Record<string, number>) || {};
  const hueExtensions = Object.keys(hueDefaults).sort();

  return (
    <Section
      name="Buildings"
      hint="Per-file boxes — height from line count, width from byte size, color from extension + age."
    >
      <CollapsibleSubgroup name="Building layout">
        <RangePairField label="Floors range" store={BUILDING_DIMENSIONS} minKey="MIN_FLOORS" maxKey="MAX_FLOORS" min={1} max={200} step={1}
          tip="How tall a building gets — represents the file's line count. Smallest file in the project lands at MIN floors; largest at MAX. Sqrt-interpolated across line counts." />
        <NumberField label="Floor height" store={BUILDING_DIMENSIONS} fieldKey="FLOOR_HEIGHT" min={1} max={50} step={1}
          tip="Vertical world units per floor (multiplier on the floor count above). Default is 10; above 50 the floor-to-width aspect breaks readability." />
        <RangePairField label="Width range" store={BUILDING_DIMENSIONS} minKey="MIN_WIDTH" maxKey="MAX_WIDTH" min={1} max={200} step={1}
          tip="How wide a building's footprint is — represents the file's byte size. Smallest file lands at MIN width; largest at MAX. Log-interpolated across byte sizes. Footprints are square (depth = width)." />
        <NumberField label="Distance from road" store={BUILDING_DIMENSIONS} fieldKey="DISTANCE_FROM_ROAD" min={0} max={50} step={1}
          tip="Gap between the building wall and the street edge. Same for every building." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Transitions">
        <NumberField label="Enter / refresh (ms)" store={BUILDINGS} fieldKey="BUILDING_TRANSITION_MS" min={50} max={3000} step={10}
          tip="Fade-in / stay duration for buildings as they enter on initial render or refresh when the manifest changes. Above 3000ms tweens feel sluggish; below 50ms reads as a hard cut." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Color palette (HSL)">
        <RangePairField label="Saturation range" store={BUILDINGS} minKey="SATURATION_MIN" maxKey="SATURATION_MAX" min={0} max={100} step={5}
          tip="HSL saturation range — older files tend to MIN, newly-created tend to MAX." />
        <RangePairField label="Lightness range" store={BUILDINGS} minKey="LIGHTNESS_MIN" maxKey="LIGHTNESS_MAX" min={0} max={100} step={5}
          tip="HSL lightness range — recently-modified files tend to MAX (brighter); stale files tend to MIN." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Extension hues (0–359°)">
        {hueExtensions.map((ext) => (
          <NestedSliderField
            key={ext}
            label={ext}
            store={BUILDINGS}
            parentKey="HUE_EXT_MAP"
            subKey={ext}
            min={0}
            max={359}
            step={1}
            tip="Hue (0–359°) for files with this extension."
            previewHue
          />
        ))}
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Outlines">
        <NumberField label="Linewidth" store={BUILDINGS} fieldKey="OUTLINE_WIDTH" min={1} max={10} step={1}
          tip="Pixel thickness shared by per-building, hover, and selected outlines. Above 10 pixels the wireframe occludes facade detail; below 1 it vanishes at typical zoom." />
        <ColorField label="Hover color" store={BUILDINGS} fieldKey="OUTLINE_HOVER_COLOR"
          tip="Outline color when the cursor is over a building." />
        <SliderField label="Hover opacity" store={BUILDINGS} fieldKey="OUTLINE_HOVER_OPACITY" min={0} max={1} step={0.05} />
        <SliderField label="Selected opacity" store={BUILDINGS} fieldKey="OUTLINE_SELECTED_OPACITY" min={0} max={1} step={0.05}
          tip="Selected outline uses an animated rainbow color — see Effects > Rainbow." />
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Facade">
        <CollapsibleSubgroup name="Geometry">
          <SliderField label="Slab thickness × floor" store={FACADE_GEOMETRY} fieldKey="SLAB_HEIGHT_FRAC" min={0} max={0.4} step={0.01}
            tip="Floor-slab strip height as a fraction of one floor. Above 0.4 the slab eats more than the floor's window band — the facade reads as horizontal banding instead of windowed." />
          <SliderField label="Window width × cell" store={FACADE_GEOMETRY} fieldKey="WINDOW_WIDTH_FRAC" min={0} max={1} step={0.01}
            tip="Window width as a fraction of its grid cell." />
          <SliderField label="Window height × floor" store={FACADE_GEOMETRY} fieldKey="WINDOW_HEIGHT_FRAC" min={0} max={1} step={0.01}
            tip="Window height as a fraction of one floor." />
          <SliderField label="Window margin × face" store={FACADE_GEOMETRY} fieldKey="WINDOW_MARGIN_FRAC" min={0} max={0.2} step={0.005}
            tip="Horizontal margin per edge of the window grid, as a fraction of face width. Above 0.2 there is only room for ~3 window columns on a typical building." />
          <SliderField label="Door height × floor" store={FACADE_GEOMETRY} fieldKey="DOOR_HEIGHT_FRAC" min={0} max={1} step={0.01}
            tip="Door height as a fraction of one floor." />
          <SliderField label="Roof border × face" store={FACADE_GEOMETRY} fieldKey="ROOF_BORDER_FRAC" min={0} max={0.1} step={0.005}
            tip="Width of the roof border strip, as a fraction of the face. Above 0.1 (10% of face width) the border eats into the icon area at the top of the facade." />
          <NumberField label="Max window columns" store={FACADE_GEOMETRY} fieldKey="WINDOW_COLS_MAX" min={1} max={10} step={1}
            tip="Hard cap on window columns per face. Rebuild required. Above 10 the window grid becomes too dense to read at typical zoom." />
          <NumberField label="Width per window col" store={FACADE_GEOMETRY} fieldKey="WIDTH_PER_WINDOW_COL" min={1} max={32} step={1}
            tip="World-unit width allotted per window column (cols = floor(buildingWidth / this)). Rebuild required. Above 32 world units per column, small buildings end up with zero windows." />
          <SliderField label="Door width" store={FACADE_GEOMETRY} fieldKey="DOOR_WIDTH_FRAC" min={0} max={1} step={0.05}
            tip="Door width as a fraction of the building's own width. Bigger buildings get proportionally wider doors. Rebuild required." />
        </CollapsibleSubgroup>

        <CollapsibleSubgroup name="Contrast (HSL lightness Δ)">
          <SliderField label="Floor slab" store={FACADE_DETAIL} fieldKey="SLAB_LIGHTNESS_DELTA" min={-100} max={100} step={1}
            tip="Lightness offset for the floor-slab strip, in HSL percentage points (negative darkens)." />
          <SliderField label="Door" store={FACADE_DETAIL} fieldKey="DOOR_LIGHTNESS_DELTA" min={-100} max={100} step={1}
            tip="Lightness offset for the door (negative darkens)." />
          <SliderField label="Roof border" store={FACADE_DETAIL} fieldKey="ROOF_BORDER_LIGHTNESS_DELTA" min={-100} max={100} step={1}
            tip="Lightness offset for the roof border strip (negative darkens)." />
        </CollapsibleSubgroup>

        <CollapsibleSubgroup name="Window lighting">
          <SliderField label="Unlit pane lightness Δ" store={WINDOW_LIGHTING} fieldKey="UNLIT_LIGHTNESS_DELTA" min={-20} max={20} step={1}
            tip="HSL lightness offset applied to unlit panes (relative to the building hue)." />
          <SliderField label="Gap fraction (base)" store={WINDOW_LIGHTING} fieldKey="GAP_BASE_THRESHOLD" min={0} max={1} step={0.01}
            tip="Base fraction of cells with no window at all (architectural gaps)." />
          <SliderField label="Gap fraction (age bonus)" store={WINDOW_LIGHTING} fieldKey="GAP_AGE_BONUS" min={0} max={1} step={0.01}
            tip="Extra empty-cell fraction added for the oldest building (interpolates down to 0 for the newest)." />
          <SliderField label="Lit-window dim curve" store={WINDOW_LIGHTING} fieldKey="LIT_FRESHNESS_EXPONENT" min={1} max={4} step={0.1}
            tip="Exponent on the recency curve that drives lit-window count + HDR emission. 1 = linear; higher dims mid-age buildings faster so only the freshest ones glow. Beyond 4 only the newest ~6% of files visibly emit (exponent applied to recency)." />
          <ColorField label="Old building glow" store={WINDOW_LIGHTING} fieldKey="DIM_GLOW_COLOR"
            tip="Warm-amber tint that lit panes drift toward as the file ages (created-date axis, not last-modified)." />
        </CollapsibleSubgroup>

        <CollapsibleSubgroup name="Ad panels (media files)">
          <SliderField label="Side margin × width" store={AD_PANEL} fieldKey="AD_SIDE_MARGIN_FRAC" min={0} max={0.4} step={0.01}
            tip="Horizontal margin on each side of the building width — controls how much building wall is visible to the left and right of the ad. Above 0.4 the margins consume more than 80% of the face and the ad becomes a sliver." />
          <SliderField label="Bottom offset × floors" store={AD_PANEL} fieldKey="AD_BOTTOM_OFFSET_FLOORS" min={0} max={3} step={0.1}
            tip="Ad bottom edge sits this many floor heights above the ground — guarantees the door (0.75 of a floor tall) stays uncovered. 1.0 leaves a clean strip; raise it to lift the ad higher on the building." />
          <ColorField label="Placeholder color" store={AD_PANEL} fieldKey="AD_PLACEHOLDER_COLOR"
            tip="Color shown on the ad plane while the texture is loading (or if the load fails)." />
        </CollapsibleSubgroup>
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Aging">
        <CollapsibleSubgroup name="Grime streaks">
          <ToggleField label="Enabled" store={BUILDINGS} fieldKey="GRIME_ENABLED"
            tip="Vertical streaks of darker color falling from the top of each face on aged buildings. Off → clean facades regardless of age." />
          <SliderField label="Intensity" store={BUILDINGS} fieldKey="GRIME_INTENSITY" min={0} max={1} step={0.05}
            tip="How dark each streak gets. 0 = invisible; 1 = strongly darkened wall color." />
          <SliderField label="Coverage" store={BUILDINGS} fieldKey="GRIME_COVERAGE" min={0} max={1} step={0.05}
            tip="Fraction of vertical bands the oldest building shows as streaky. Lower = sparser streaks; higher = nearly every band weathers." />
        </CollapsibleSubgroup>

        <CollapsibleSubgroup name="Tilt">
          <ToggleField label="Enabled" store={BUILDINGS} fieldKey="TILT_ENABLED"
            tip="Small lean around the base, proportional to createdAge. Each building leans in a stable hashed direction. Off → all buildings stand perfectly upright." />
          <SliderField label="Max degrees" store={BUILDINGS} fieldKey="TILT_DEGREES" min={0} max={10} step={0.1}
            tip="Maximum lean angle (degrees) applied to the oldest building. Newer buildings interpolate down to 0. Above 10° buildings visually clip into their neighbors." />
        </CollapsibleSubgroup>
      </CollapsibleSubgroup>

      <CollapsibleSubgroup name="Selection fade">
        <FadeTier groupName="Default tier — selected, hovered, or idle" prefix="DEFAULT" />
        <FadeTier groupName="Level 1 — same dir as selection" prefix="LEVEL1" />
        <FadeTier groupName="Level 2 — one dir away (up or down)" prefix="LEVEL2" />
        <FadeTier groupName="Level 3 — two dirs away" prefix="LEVEL3" />
        <FadeTier groupName="Level 4 — three or more dirs away" prefix="LEVEL4" />
      </CollapsibleSubgroup>
    </Section>
  );
}
