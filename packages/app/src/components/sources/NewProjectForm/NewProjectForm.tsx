// components/sources/NewProjectForm/NewProjectForm.tsx — new-source entry. One field
// takes a git URL or a local path and classifies itself as you type (srcKind).
// Everything describing the field renders in one slot beneath it, so a failure
// can never stack with the guidance it answers.

// Submits on Enter (a real <form>) or the split button, whose menu carries the
// fresh-scan variant: skipping the cache is a way of opening, not a setting.

import './NewProjectForm.css';
import { useEffect, useState } from 'preact/hooks';
import { DatabaseZap } from 'lucide-preact';
import { BranchSelect } from '@/components/sources/BranchSelect/BranchSelect';
import { SplitButton } from '@/components/buttons/SplitButton/SplitButton';
import {
  srcKind,
  SourceKind,
  validateGitUrl,
  looksResolvable,
  looksLikePath,
} from '@/utils/sources';
import {
  UnreachableSource,
  NoticeReason,
} from '@/components/sources/UnreachableSource/UnreachableSource';
import type { SourcePayload } from '@/types/ui';
import { SCAN_PROGRESS } from '@/state/stores/progress';
import { ScanErrorCode } from '@/city/client/manifest';

// Resolving a branch list means the server reaching the remote, and a typed URL
// is valid for most of its last dozen characters. Wait for the typing to stop.
export const BRANCH_LOOKUP_DEBOUNCE_MS = 400;

// Named hosts and then the general case: "any git host" alone reads as a claim,
// while three names and an "any" reads as a range.
const HOSTS_NOTE = 'GitHub, GitLab, Forgejo, any git host';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  /** The message from the load that just failed. Rendered in the field's own
   *  slot: it is about what's in the field, so it belongs under it. */
  error?: string;
  /** The code for that same failure, where there is one. Keyed on rather than
   *  the message text, which is the server's to reword. */
  errorCode?: ScanErrorCode;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
}

const ERROR_ID = 'new-project-error';

export function NewProjectForm({
  allowLocalRepos,
  error,
  errorCode,
  prefill,
  onSubmit,
}: NewProjectFormProps) {
  // Editing the source retires the last attempt's banner. Local, not a write
  // back to SOURCE_ERROR: that failure is still the reason this route is open.
  const [retired, setRetired] = useState(false);
  const [source, setSource] = useState(prefill?.src ?? '');
  const [branch, setBranch] = useState(prefill?.branch ?? '');
  const [resolvedUrl, setResolvedUrl] = useState(
    prefill?.src && srcKind(prefill.src) === SourceKind.Remote && looksResolvable(prefill.src)
      ? prefill.src
      : ''
  );
  const [branchError, setBranchError] = useState<string | null>(null); // from BranchSelect
  // The branch lookup is the FIRST request to touch the remote, so a repo this
  // server can't reach fails here, before anything is submitted.
  const [branchErrorCode, setBranchErrorCode] = useState<ScanErrorCode | undefined>(undefined);

  // Label + placeholder reflect what the field actually accepts here.
  const sourceLabel = allowLocalRepos ? 'Repo URL or local path' : 'Repo URL';
  const placeholder = allowLocalRepos
    ? 'https://github.com/owner/repo or /absolute/path/to/repo'
    : 'https://github.com/owner/repo';

  const loading = SCAN_PROGRESS.value !== null;
  const activeSrc = source.trim();
  // One field, classified by what's typed. Empty defaults to a URL so the
  // branch dropdown's absence (not a path) is the resting state.
  const isRemote = activeSrc ? srcKind(activeSrc) === SourceKind.Remote : true;
  // The one thing this form can't open. Gated on looksLikePath so a half-typed
  // URL never trips it, and it suppresses the "enter a git URL" nudge.
  const pathBlocked = !isRemote && !allowLocalRepos && looksLikePath(activeSrc);
  // A remote repo the server couldn't reach. Shown regardless of what the field
  // now reads as, because it answers the attempt the user just made.
  const openError = retired ? undefined : error;
  const failedToReach =
    (!retired && errorCode === 'repo-not-found') || branchErrorCode === 'repo-not-found';

  // A path change on a URL resets the branch, so no stale pick rides along.
  function onSourceInput(v: string) {
    setRetired(true);
    setSource(v);
    setBranch('');
    setBranchErrorCode(undefined);
  }

  // What the field would resolve to right now: only a URL that passes
  // validation, '' for anything else.
  const resolvableSrc =
    activeSrc && isRemote && looksResolvable(source) && !validateGitUrl(source) ? source : '';

  useEffect(() => {
    // Clearing is immediate: the dropdown must not linger over a URL the field
    // no longer holds. Only committing to a lookup waits.
    if (!resolvableSrc) {
      setResolvedUrl('');
      return;
    }
    const timer = setTimeout(() => setResolvedUrl(resolvableSrc), BRANCH_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [resolvableSrc]);

  const urlError = isRemote || (!allowLocalRepos && !pathBlocked) ? validateGitUrl(source) : null;
  const fieldError = urlError ?? (isRemote ? branchError : null);
  const canSubmit = !loading && activeSrc.length > 0 && !fieldError && !pathBlocked;
  const hasError = Boolean(fieldError) || pathBlocked || Boolean(openError);

  function submit(skipCache = false) {
    if (!canSubmit) return;
    onSubmit({
      src: activeSrc,
      branch: isRemote ? branch.trim() || undefined : undefined,
      skipCache: skipCache || undefined,
    });
  }

  return (
    <form
      class="new-project"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div class="new-project-field">
        <div class="new-project-label-row">
          <label htmlFor="new-project-source">{sourceLabel}</label>
          {/* Beside the label, not in the slot below: that slot is a precedence
              chain, and this is true whatever else it happens to be saying. */}
          <span class="new-project-hosts">{HOSTS_NOTE}</span>
        </div>
        <input
          id="new-project-source"
          class={hasError ? 'form-input form-input--error' : 'form-input'}
          type="text"
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={hasError || failedToReach ? ERROR_ID : undefined}
          autoComplete="off"
          spellcheck={false}
          placeholder={placeholder}
          value={source}
          onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
        />
        {/* One slot: what already failed beats a validation complaint. */}
        {failedToReach ? (
          <UnreachableSource
            id={ERROR_ID}
            allowLocal={allowLocalRepos}
            reason={NoticeReason.Unreachable}
            src={activeSrc || prefill?.src}
          />
        ) : pathBlocked ? (
          <UnreachableSource
            id={ERROR_ID}
            allowLocal={allowLocalRepos}
            reason={NoticeReason.PathBlocked}
          />
        ) : (
          // Live validation beats the message from the last submit, which the
          // next keystroke retires anyway.
          (fieldError || openError) && (
            <p id={ERROR_ID} role="alert" class="new-project-error">
              {fieldError ?? openError}
            </p>
          )
        )}
      </div>

      {isRemote && (
        <BranchSelect
          url={resolvedUrl}
          value={branch}
          onChange={setBranch}
          onError={(message, code) => {
            setBranchError(message);
            setBranchErrorCode(code);
          }}
          key={resolvedUrl}
        />
      )}

      <SplitButton
        class="new-project-open"
        label="Open project"
        // The primary half is the form's real submit, so Enter in the field and
        // a click on the button take the identical path.
        primaryType="submit"
        onPrimary={() => submit()}
        menuLabel="More ways to open"
        disabled={!canSubmit}
        items={[
          {
            id: 'fresh',
            icon: DatabaseZap,
            label: 'Open with a fresh scan',
            sublabel: 'ignore the cache and re-read the whole repo',
            onSelect: () => submit(true),
          },
        ]}
      />
    </form>
  );
}
