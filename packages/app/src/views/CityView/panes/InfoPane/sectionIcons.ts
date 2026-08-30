// views/InfoPane/sectionIcons.ts — the world-layer icon for each almanac
// section. Shared by the Overview sections and the Legend rows so both read one
// key→icon source; the layer copy lives alongside in almanac.ts (LAYER_LEGEND).

import {
  Building2,
  Image,
  Binary,
  Signpost,
  TreePine,
  Sparkles,
  type LucideIcon,
} from 'lucide-preact';
import type { AlmanacSectionKey } from './almanac';

export const SECTION_ICON: Record<AlmanacSectionKey, LucideIcon> = {
  buildings: Building2,
  media: Image,
  data: Binary,
  streets: Signpost,
  forest: TreePine,
  fireflies: Sparkles,
};
