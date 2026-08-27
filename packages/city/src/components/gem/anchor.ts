import { StreetAxis } from '@/city/types/street';
// city/components/gem/anchor.ts — Single source of truth for the gem's anchor point
// (the center of the root street's origin-end cap). Computed from the
// street geometry; shared by the gem mesh and tree placement.

type RootStreetGeometry = {
  x: number;
  y: number;
  width: number;
  length: number;
  orientation: StreetAxis;
};

/** XZ-plane anchor for the gem, in world units. The gem floats above
 *  this point at `radius + width * hoverFrac` on the Y axis. */
export function gemAnchorXZ(street: RootStreetGeometry): { x: number; y: number } {
  // Stadium origin-end cap is centered W/2 inward from the tip.
  if (street.orientation === StreetAxis.X) {
    return {
      x: street.x - street.length / 2 + street.width / 2,
      y: street.y,
    };
  }
  return {
    x: street.x,
    y: street.y - street.length / 2 + street.width / 2,
  };
}
