// components/CopyButton.tsx — Small icon button that copies `text` to
// the clipboard and flashes a brief "Copied!" state on itself (a CSS-side
// .is-copied modifier toggled from component state). Uses the async
// Clipboard API; secure contexts always provide it, so there's no legacy
// execCommand fallback.

import { useState, useRef, useEffect } from 'preact/hooks';
import { Copy } from 'lucide-preact';

// How long the "Copied!" badge lingers after the copy button is clicked.
const DEFAULT_COPY_FEEDBACK_DURATION_MS = 1500;

export interface CopyButtonProps {
  text: string;
  label?: string;
  /** How long the "Copied!" state lingers after a click, in ms. */
  feedbackDurationMs?: number;
}

export function CopyButton({
  text,
  label = 'Copy path',
  feedbackDurationMs = DEFAULT_COPY_FEEDBACK_DURATION_MS,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending reset timer on unmount so it can't fire after teardown.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flash = () => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), feedbackDurationMs);
  };

  const onClick = () => {
    // Optional-chain so the call is a no-op if the API is somehow absent
    // (non-secure context) rather than throwing.
    void navigator.clipboard?.writeText(text).then(flash, () => {
      /* clipboard write denied — leave the button un-flashed */
    });
  };

  return (
    <button
      type="button"
      class={`btn-icon btn-icon--no-drag${copied ? ' is-copied' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Copy class="lucide-icon" />
    </button>
  );
}
