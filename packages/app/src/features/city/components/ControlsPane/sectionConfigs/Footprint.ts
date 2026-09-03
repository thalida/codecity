// features/city/components/ControlsPane/sectionConfigs/Footprint.ts — City footprint section
// declaration. The dark paved apron slab that follows the city silhouette,
// inflated outward from every layout rect. Its own top-level section (sits
// after Streets) — the slab frames the whole city, it isn't a street surface.
import { CITY_STORES } from '@/features/settings/state/values/city';
import { field } from '@/features/city/field';
import type { SectionNode } from '@/features/city/components/ControlsPane/types';

export const FOOTPRINT_SECTION: SectionNode = {
  key: 'footprint',
  label: 'City Footprint',
  description:
    'The dark paved apron beneath the city: overlapping inflated rects around every building, street, and path compose into one slab that follows the city silhouette.',
  children: [
    field(CITY_STORES.FOOTPRINT, 'ENABLED'),
    field(CITY_STORES.FOOTPRINT, 'COLOR'),
    field(CITY_STORES.FOOTPRINT, 'HALO_WIDTH'),
    field(CITY_STORES.FOOTPRINT, 'CORNER_RADIUS'),
  ],
};
