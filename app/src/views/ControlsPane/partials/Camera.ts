// views/ControlsPane/partials/Camera.ts — Camera section: the default framing
// angle. CAMERA is autosave, so the sliders re-frame the view live as you drag
// (the cameraRig subscribes and snaps to the new pose).
import { field, type SectionNode } from '.';
import { CAMERA } from '@/state/stores/settings/camera';

export const CAMERA_SECTION: SectionNode = {
  key: 'camera',
  label: 'Camera',
  description:
    'The angle the default view frames the city from, always looking at the root gem. Drag to preview it live.',
  children: [field(CAMERA, 'ELEVATION'), field(CAMERA, 'AZIMUTH')],
};
