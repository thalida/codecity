// views/ControlsPane/sections/Gem.ts — the root gem and its repo label.
import { CITY_STORES } from '@/state/settings/cityStores';
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';

export const GEM_SECTION: SectionNode = {
  key: 'gem',
  label: 'Root Gem',
  description: 'The floating spinning octahedron above the root street.',
  children: [
    {
      key: 'size-shape',
      label: 'Size & Shape',
      children: [
        field(CITY_STORES.GEM_SIZING, 'RADIUS_AS_STREET_FRAC'),
        field(CITY_STORES.GEM_SIZING, 'MIN_RADIUS'),
        field(CITY_STORES.GEM, 'SIDES'),
      ],
    },
    {
      key: 'body',
      label: 'Body',
      children: [field(CITY_STORES.GEM, 'EDGE_COLOR'), field(CITY_STORES.GEM, 'BODY_OPACITY')],
    },
    {
      key: 'face-colors',
      label: 'Face Colors',
      children: [
        field(CITY_STORES.GEM, 'FACE_1'),
        field(CITY_STORES.GEM, 'FACE_2'),
        field(CITY_STORES.GEM, 'FACE_3'),
        field(CITY_STORES.GEM, 'FACE_4'),
        field(CITY_STORES.GEM, 'FACE_5'),
        field(CITY_STORES.GEM, 'FACE_6'),
        field(CITY_STORES.GEM, 'FACE_7'),
        field(CITY_STORES.GEM, 'FACE_8'),
      ],
    },
    {
      key: 'glow',
      label: 'Glow Halo',
      children: [
        field(CITY_STORES.GEM, 'GLOW_ENABLED'),
        field(CITY_STORES.GEM, 'GLOW_INNER_SCALE'),
        field(CITY_STORES.GEM, 'GLOW_INNER_OPACITY'),
        field(CITY_STORES.GEM, 'GLOW_OUTER_SCALE'),
        field(CITY_STORES.GEM, 'GLOW_OUTER_OPACITY'),
        field(CITY_STORES.GEM, 'GLOW_ANIMATE_COLORS'),
        field(CITY_STORES.GEM, 'GLOW_CYCLE_PERIOD_SECONDS'),
        field(CITY_STORES.GEM, 'GLOW_EMISSION'),
      ],
    },
    {
      key: 'animation',
      label: 'Animation',
      children: [
        field(CITY_STORES.GEM, 'ROTATION_SPEED'),
        field(CITY_STORES.GEM, 'BOB_FREQUENCY'),
        field(CITY_STORES.GEM, 'BOB_AMPLITUDE_FRAC'),
        field(CITY_STORES.GEM, 'HOVER_SCALE'),
        field(CITY_STORES.GEM, 'SCALE_LERP_SPEED'),
      ],
    },
    {
      key: 'repo-label',
      label: 'Repo Label',
      children: [
        field(CITY_STORES.REPO_LABEL, 'ENABLED'),
        field(CITY_STORES.REPO_LABEL, 'HEIGHT_PCT'),
        field(CITY_STORES.REPO_LABEL, 'FONT_SIZE'),
        field(CITY_STORES.REPO_LABEL, 'ANIMATION_SPEED'),
        field(CITY_STORES.REPO_LABEL, 'OPACITY'),
        field(CITY_STORES.REPO_LABEL, 'BEAM_COLOR'),
        field(CITY_STORES.REPO_LABEL, 'TEXT_COLOR'),
      ],
    },
  ],
};
