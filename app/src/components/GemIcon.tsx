// components/GemIcon.tsx — The codecity gem icon, rendered inline as JSX
// (same pattern as HostingIcon / lucide icons) so the per-face palette fills
// render directly. Default is full multicolor (same geometry as /gem.svg, the
// favicon). The `simple` prop swaps to a grayscale-filled variant for quieter
// contexts (tree rows) where the multicolor palette would compete with row text.

import './GemIcon.css';

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
  const className = `gem-icon${cls ? ` ${cls}` : ''}`;
  if (simple) {
    return (
      <svg class={className} viewBox="0 0 24 24" aria-hidden="true" title={title}>
        <g stroke="#fff" stroke-width="2" stroke-linejoin="round">
          <polygon points="2,12 12,2 12,12" fill="#ffffff88" />
          <polygon points="12,2 22,12 12,12" fill="#ffffff55" />
          <polygon points="22,12 12,22 12,12" fill="#ffffff22" />
          <polygon points="12,22 2,12 12,12" fill="#ffffff55" />
        </g>
      </svg>
    );
  }
  return (
    <svg class={className} viewBox="0 0 24 24" aria-hidden="true" title={title}>
      <polygon points="2,12 12,2 12,12" fill="#bfff33" />
      <polygon points="12,2 22,12 12,12" fill="#26e5ff" />
      <polygon points="22,12 12,22 12,12" fill="#9940ff" />
      <polygon points="12,22 2,12 12,12" fill="#ff338c" />
    </svg>
  );
}
