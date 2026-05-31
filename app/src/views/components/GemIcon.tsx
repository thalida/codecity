// views/components/GemIcon.tsx — The codecity gem icon, painted as a
// background-image SVG so the per-face fills render directly. Default
// is full multicolor (/gem.svg, same source as the favicon). The
// `simple` prop swaps to a grayscale variant (/gem-simple.svg) for
// quieter contexts (tree rows) where the multicolor palette would
// compete with row text.

export interface GemIconProps {
  /** Extra class added alongside `gem-icon`. */
  class?: string;
  /** Tooltip shown on hover (sets the title attr). */
  title?: string;
  /** Render the grayscale-filled variant for quieter contexts (e.g. tree
   *  rows). Same octahedron geometry, just neutral fills instead of
   *  palette colors. */
  simple?: boolean;
}

export function GemIcon({ class: cls, title, simple }: GemIconProps) {
  const style = simple ? { backgroundImage: 'url(/gem-simple.svg)' } : undefined;
  return (
    <span
      class={`gem-icon${cls ? ` ${cls}` : ''}`}
      aria-hidden="true"
      title={title}
      style={style}
    />
  );
}
