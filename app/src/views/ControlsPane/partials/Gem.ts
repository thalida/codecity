// views/ControlsPane/partials/gem.ts — Root gem section declaration. Three
// stores (GEM visual, GEM_SIZING layout, REPO_LABEL feature); the subgroups
// below are arrangement only.
import { field, type SectionNode } from '.';
import { GEM, GEM_SIZING, REPO_LABEL } from '@/state/stores/settings/gem';

export const GEM_SECTION: SectionNode = {
  key: 'gem',
  label: 'Root gem',
  description: 'The floating spinning octahedron above the root street.',
  children: [
    {
      key: 'size-shape',
      label: 'Size & shape',
      children: [
        field(GEM_SIZING, 'RADIUS_AS_STREET_FRAC'),
        field(GEM_SIZING, 'MIN_RADIUS'),
        field(GEM, 'SIDES'),
      ],
    },
    {
      key: 'appearance',
      label: 'Appearance',
      children: [field(GEM, 'EDGE_COLOR'), field(GEM, 'BODY_OPACITY')],
    },
    {
      key: 'face-colors',
      label: 'Face colors',
      children: [
        field(GEM, 'FACE_1'), field(GEM, 'FACE_2'), field(GEM, 'FACE_3'), field(GEM, 'FACE_4'),
        field(GEM, 'FACE_5'), field(GEM, 'FACE_6'), field(GEM, 'FACE_7'), field(GEM, 'FACE_8'),
      ],
    },
    {
      key: 'glow',
      label: 'Glow halo',
      children: [
        field(GEM, 'GLOW_ENABLED'),
        field(GEM, 'GLOW_INNER_SCALE'),
        field(GEM, 'GLOW_INNER_OPACITY'),
        field(GEM, 'GLOW_OUTER_SCALE'),
        field(GEM, 'GLOW_OUTER_OPACITY'),
        field(GEM, 'GLOW_ANIMATE_COLORS'),
        field(GEM, 'GLOW_CYCLE_PERIOD_SECONDS'),
      ],
    },
    {
      key: 'animation',
      label: 'Animation',
      children: [
        field(GEM, 'ROTATION_SPEED'),
        field(GEM, 'BOB_FREQUENCY'),
        field(GEM, 'BOB_AMPLITUDE_FRAC'),
        field(GEM, 'HOVER_SCALE'),
        field(GEM, 'SCALE_LERP_SPEED'),
      ],
    },
    {
      key: 'repo-label',
      label: 'Repo label',
      children: [
        field(REPO_LABEL, 'ENABLED'),
        field(REPO_LABEL, 'HEIGHT_PCT'),
        field(REPO_LABEL, 'FONT_SIZE'),
        field(REPO_LABEL, 'ANIMATION_SPEED'),
        field(REPO_LABEL, 'OPACITY'),
        field(REPO_LABEL, 'BEAM_COLOR'),
        field(REPO_LABEL, 'TEXT_COLOR'),
      ],
    },
  ],
};
