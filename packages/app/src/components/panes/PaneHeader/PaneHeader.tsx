// components/panes/PaneHeader/PaneHeader.tsx — the header every pane wears, so they can't drift
// apart and a new pane is one call rather than a copied row.

import './PaneHeader.css';
import { type ComponentChildren, createContext, type RefObject } from 'preact';
import { Focus, EyeOff, ExternalLink } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import { CopyButton } from '@/components/buttons/CopyButton/CopyButton';
import { PaneCloseButton } from '@/components/panes/PaneCloseButton/PaneCloseButton';

// ── Props interface ─────────────────────────────────────────────────────────

export interface PaneHeaderProps {
  /** Initial title text. */
  title: string;
  /** Render the title in monospace — used by panes whose title is a
   *  filename / path identifier instead of a label. Defaults to false. */
  mono?: boolean;
  /** fn() when the user clicks the focus button. Omit to render no button. */
  onFocus?: () => void;
  /** Tooltip text on the focus button. Defaults to "Focus camera". */
  focusTitle?: string;
  /** Text the copy button copies (a path, a SHA). Omit to render no copy button. */
  copyText?: string;
  /** Tooltip / aria-label for the copy button. */
  copyLabel?: string;
  /** Open-on-origin URL (a commit/file/dir link). Omit to render no open link. */
  openUrl?: string | null;
  /** Tooltip / aria-label for the open link. */
  openLabel?: string;
  /** Extra action buttons rendered in the right-hand group, between the open link
   *  and exclude (e.g. CommitPane's view-on-timeline). */
  actionsSlot?: ComponentChildren;
  /** fn() when the user clicks the close button. Omit to render no button. */
  onClose?: () => void;
  /** Tooltip text on the close button. Defaults to "Hide sidebar". */
  closeTitle?: string;
  /** fn() when the user clicks the "exclude from city" button. Omit to render none. */
  onExclude?: () => void;
  /** Tooltip / aria-label for the exclude button. */
  excludeTitle?: string;
  /** Why this node can't be excluded. The button stays, dimmed and carrying the
   *  reason: one field, so a disabled button always says why. */
  excludeDisabledReason?: string;
  /** Rich title content rendered inside the title element instead of the
   *  plain `title` string (e.g. a path breadcrumb, or "Commit <sha> · author"). */
  titleSlot?: ComponentChildren;
}

// ── Preact component ────────────────────────────────────────────────────────

/** What a title measures itself against. The title hugs its content, so it
 *  stops tracking the pane once shrunk; this group fills the row. */
export const PaneTitleBudgetContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function PaneHeader({
  title,
  mono,
  onFocus,
  focusTitle = 'Focus camera',
  copyText,
  copyLabel,
  openUrl,
  openLabel = 'Open on origin',
  actionsSlot,
  onClose,
  closeTitle = 'Hide sidebar',
  onExclude,
  excludeTitle,
  excludeDisabledReason,
  titleSlot,
}: PaneHeaderProps) {
  const leadRef = useRef<HTMLDivElement>(null);
  return (
    <div class="pane-header">
      <div class="pane-header-lead" ref={leadRef}>
        <h3 class={`text-pane-title${mono ? ' is-mono' : ''}`}>
          <PaneTitleBudgetContext.Provider value={leadRef}>
            {titleSlot ?? title}
          </PaneTitleBudgetContext.Provider>
        </h3>
        {(copyText != null || openUrl) && (
          <div class="pane-header-identity">
            {copyText != null && <CopyButton text={copyText} label={copyLabel} />}
            {openUrl && (
              <a
                class="btn-icon btn-icon--link"
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={openLabel}
                aria-label={openLabel}
              >
                <ExternalLink class="icon" />
              </a>
            )}
          </div>
        )}
      </div>
      <div class="pane-header-actions">
        {typeof onFocus === 'function' && (
          <button
            type="button"
            class="btn-icon"
            title={focusTitle}
            aria-label={focusTitle}
            onClick={(e) => {
              // Blurred, so the next Space or Enter reaches the canvas instead
              // of firing this button again.
              (e.currentTarget as HTMLButtonElement).blur();
              onFocus();
            }}
          >
            <Focus class="icon" />
          </button>
        )}
        {actionsSlot ?? null}
        {typeof onExclude === 'function' && (
          <button
            type="button"
            class={`btn-icon${excludeDisabledReason ? ' btn-icon--inert' : ''}`}
            // Tooltip only: the accessible name has to stay the action, or a
            // screen reader announces the objection and never the button.
            title={excludeDisabledReason ?? excludeTitle ?? 'Exclude from city'}
            aria-label={excludeTitle ?? 'Exclude from city'}
            // aria-disabled, not disabled: a disabled button drops its hover,
            // and the tooltip is the whole point of still drawing it.
            aria-disabled={excludeDisabledReason ? 'true' : undefined}
            onClick={excludeDisabledReason ? undefined : () => onExclude()}
          >
            <EyeOff class="icon" />
          </button>
        )}
        {typeof onClose === 'function' && <PaneCloseButton onClose={onClose} title={closeTitle} />}
      </div>
    </div>
  );
}
