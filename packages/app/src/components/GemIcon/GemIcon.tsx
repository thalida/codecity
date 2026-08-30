// components/GemIcon/GemIcon.tsx — the gem, inline as JSX so its per-face
// palette fills render directly. Same geometry as the favicon.
import './GemIcon.css';

export interface GemIconProps {
  /** Extra class added alongside `gem-icon`. */
  class?: string;
  /** Tooltip shown on hover (sets the title attr). */
  title?: string;
  /** The grayscale variant for quieter contexts: same geometry, neutral fills. */
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
      {/* Fills come from the shared --cc-gem-* tokens (tokens.css). SVG's `fill`
          attribute doesn't resolve var(), so drive it via `style` instead. */}
      <polygon points="2,12 12,2 12,12" style={{ fill: 'var(--cc-gem-lime)' }} />
      <polygon points="12,2 22,12 12,12" style={{ fill: 'var(--cc-gem-cyan)' }} />
      <polygon points="22,12 12,22 12,12" style={{ fill: 'var(--cc-gem-purple)' }} />
      <polygon points="12,22 2,12 12,12" style={{ fill: 'var(--cc-gem-magenta)' }} />
    </svg>
  );
}
