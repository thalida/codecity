// constants/breakpoints.ts — device thresholds the shell changes shape for.
// A custom property can't be used in a media query, so stylesheets restate the
// literal and name the constant in a comment.

/** Sidebars become overlay drawers; chrome bars shed optional items. */
export const PHONE_MAX_PX = 640;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`;

/** Finger-driven: nothing revealed on hover, 24px controls are half a thumb. */
export const COARSE_POINTER_QUERY = '(hover: none) and (pointer: coarse)';
