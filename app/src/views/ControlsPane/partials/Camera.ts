// views/ControlsPane/partials/Camera.ts — Camera section: the default framing
// angle. Draft-backed like the rest of World; the cameraRig snaps to the new
// pose on save.
import { field, type SectionNode } from '.';
import { CAMERA } from '@/state/stores/settings/camera';

export const CAMERA_SECTION: SectionNode = {
  key: 'camera',
  label: 'Camera',
  description: 'The angle the default view frames the city from, always looking at the root gem.',
  children: [field(CAMERA, 'ELEVATION'), field(CAMERA, 'AZIMUTH')],
};
