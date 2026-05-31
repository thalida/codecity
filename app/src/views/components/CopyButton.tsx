// views/components/CopyButton.tsx — Small icon button that copies `text`
// to the clipboard, flashes a brief "Copied!" state on the button itself
// (driven by a CSS-side .is-copied modifier), and falls back to a
// hidden <textarea> + execCommand('copy') when the async Clipboard API
// is unavailable (older browsers / non-https contexts).

import { useRef } from 'preact/hooks';
import { LucideIcon } from './LucideIcon';

// How long the "Copied!" badge lingers after the copy button is clicked.
const COPY_FEEDBACK_DURATION_MS = 1500;

function _fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
  } catch (_) {
    /* fallback unavailable */
  }
  document.body.removeChild(ta);
}

function _copy(text: string, btn: HTMLButtonElement): void {
  function flash() {
    if (!btn) return;
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.classList.remove('is-copied');
    }, COPY_FEEDBACK_DURATION_MS);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, () => {
      _fallbackCopy(text);
      flash();
    });
  } else {
    _fallbackCopy(text);
    flash();
  }
}

export interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = 'Copy path' }: CopyButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      class="btn-icon btn-icon--no-drag"
      title={label}
      aria-label={label}
      onClick={() => {
        if (ref.current) _copy(text, ref.current);
      }}
    >
      <LucideIcon name="copy" />
    </button>
  );
}
