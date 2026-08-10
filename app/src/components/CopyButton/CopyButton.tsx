// components/CopyButton.tsx — Small icon button that copies `text` to
// the clipboard and flashes a brief "Copied!" state on itself (a CSS-side
// .is-copied modifier toggled from component state). Uses the async
// Clipboard API; secure contexts always provide it, so there's no legacy
// execCommand fallback.

import './CopyButton.css';
import { useState, useRef, useEffect } from 'preact/hooks';
import { Copy } from 'lucide-preact';
import { CLUSTER_ITEM_PRESS } from '@/components/ChromeCluster/ChromeCluster';

// How long the "Copied!" badge lingers after the copy button is clicked.
const DEFAULT_COPY_FEEDBACK_DURATION_MS = 1500;

/** Which box the button takes. */
export enum CopyButtonVariant {
  /** The standalone icon-button box. */
  Icon = 'icon',
  /** The chrome bars' item box, so it matches everything beside it. */
  Cluster = 'cluster',
}

export interface CopyButtonProps {
  text: string;
  label?: string;
  /** How long the "Copied!" state lingers after a click, in ms. */
  feedbackDurationMs?: number;
  variant?: CopyButtonVariant;
}

export function CopyButton({
  text,
  label = 'Copy path',
  feedbackDurationMs = DEFAULT_COPY_FEEDBACK_DURATION_MS,
  variant = CopyButtonVariant.Icon,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending reset timer on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

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
    <>
      <button
        type="button"
        class={`${variant === CopyButtonVariant.Cluster ? CLUSTER_ITEM_PRESS : 'btn-icon'}${copied ? ' is-copied' : ''}`}
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        <Copy class="icon" />
      </button>
      {/* The copied state is otherwise a color-only flash; announce it. */}
      <span class="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
