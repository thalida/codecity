// components/CommitChip.tsx — Header title slot for a selected commit:
// a focus button + "Commit <short-sha> · <author> (+N)" + copy-SHA button.

import { Focus } from 'lucide-preact';
import { CopyButton } from '@/components/CopyButton';
import { KEY_BINDINGS } from '@/constants';

export interface CommitChipProps {
  sha: string;
  authors: string[];
  onFocus?: () => void;
}

export function CommitChip({ sha, authors, onFocus }: CommitChipProps) {
  // Guard against commits with missing authors (e.g. a manifest from a cache
  // that dropped the field) so the header degrades instead of crashing.
  const list = authors ?? [];
  const primary = list[0] || '(unknown)';
  const coAuthorCount = Math.max(0, list.length - 1);
  const authorText = coAuthorCount > 0 ? ` · ${primary} (+${coAuthorCount})` : ` · ${primary}`;
  const focusTitle = `Focus camera on commit (${KEY_BINDINGS.FOCUS_SELECTION.label})`;

  return (
    <>
      {onFocus && (
        <button
          type="button"
          class="btn-icon btn-icon--no-drag"
          title={focusTitle}
          aria-label={focusTitle}
          onClick={() => onFocus()}
        >
          <Focus class="lucide-icon" />
        </button>
      )}
      {'Commit '}
      <span class="app-header-commit-sha">{sha.slice(0, 7)}</span>
      <span class="app-header-commit-author">{authorText}</span>
      <CopyButton text={sha} label="Copy SHA" />
    </>
  );
}
