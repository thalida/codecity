// components/NewProjectForm/NewProjectForm.tsx — new-source entry. One field
// that takes either a git URL or a local path and classifies itself as you type
// (srcKind): a URL gets a repo-resolved branch dropdown; a local path is opened
// directly. When local repos are off, the field is URL-only: the label,
// placeholder, and a standing UnreachableSource notice all reflect that, and a
// typed path is blocked. Everything that describes the field renders in one
// slot beneath it, so a failure can never stack with the guidance it answers.
//
// Submits on Enter (a real <form>) or the split button, whose menu carries the
// fresh-scan variant. Skipping the cache is a way of opening, not a setting, so
// it lives on the open control rather than in a disclosure beside it.

import './NewProjectForm.css';
import { useState } from 'preact/hooks';
import { DatabaseZap } from 'lucide-preact';
import { BranchSelect } from '@/components/BranchSelect/BranchSelect';
import { SplitButton } from '@/components/SplitButton/SplitButton';
import {
  srcKind,
  SourceKind,
  validateGitUrl,
  looksResolvable,
  looksLikePath,
} from '@/utils/sources';
import { UnreachableSource } from '@/components/UnreachableSource/UnreachableSource';
import type { ScanErrorCode } from '@/api/manifest';
import type { SourcePayload } from '@/state/stores/ui';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  /** This is the public deployment: a local path can never resolve here. */
  hosted: boolean;
  /** The code from the load that just failed, if it failed. Keyed on rather
   *  than the message text, which is the server's to reword. */
  errorCode?: ScanErrorCode;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
  /** Fired when the user edits the source field, so the host can drop a stale
   *  open-error banner (the form itself owns no such error). */
  onDirty?: () => void;
}

const ERROR_ID = 'new-project-error';

export function NewProjectForm({
  allowLocalRepos,
  hosted,
  errorCode,
  prefill,
  onSubmit,
  onDirty,
}: NewProjectFormProps) {
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
  // A local path typed while local repos are off is the one thing this form
  // can't open. Gated on looksLikePath so a half-typed URL never trips it, and
  // it suppresses the "enter a git URL" nudge (the standing notice is the why).
  const pathBlocked = !isRemote && !allowLocalRepos && looksLikePath(activeSrc);
  // The standing notice is only useful while the field could still be a path:
  // hide it once the input reads as a URL so the URL flow stays clean.
  const showStandingNotice = !allowLocalRepos && !(isRemote && activeSrc.length > 0);
  // A remote repo the server couldn't reach. Shown regardless of what the field
  // now reads as, because it answers the attempt the user just made.
  const failedToReach = errorCode === 'repo-not-found' || branchErrorCode === 'repo-not-found';

  // A path change on a URL resets the branch (no stale pick rides along) and
  // only resolves branches for a URL that passes validation.
  function onSourceInput(v: string) {
    onDirty?.(); // editing the source clears any stale open-error banner
    setSource(v);
    if (v.trim() && srcKind(v) === SourceKind.Remote) {
      setBranch('');
      setResolvedUrl(looksResolvable(v) && !validateGitUrl(v) ? v : '');
    } else {
      setResolvedUrl('');
      setBranch('');
    }
    setBranchErrorCode(undefined);
  }

  const urlError = isRemote || (!allowLocalRepos && !pathBlocked) ? validateGitUrl(source) : null;
  const fieldError = urlError ?? (isRemote ? branchError : null);
  const canSubmit = !loading && activeSrc.length > 0 && !fieldError && !pathBlocked;
  const hasError = Boolean(fieldError) || pathBlocked;

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
      {/* Directly under the card's heading, above the field: it says what this
          instance can open, which is context for filling the field in, not a
          footnote on the result. */}
      <div class="new-project-field">
        <label htmlFor="new-project-source">{sourceLabel}</label>
        <input
          id="new-project-source"
          class={hasError ? 'form-input form-input--error' : 'form-input'}
          type="text"
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={fieldError || failedToReach ? ERROR_ID : undefined}
          autoComplete="off"
          spellcheck={false}
          placeholder={placeholder}
          value={source}
          onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
        />
        {/* One slot for everything that describes the field, in precedence
            order: a repo we couldn't reach beats a validation complaint, which
            beats standing guidance about what this instance accepts. */}
        {failedToReach ? (
          <UnreachableSource
            id={ERROR_ID}
            hosted={hosted}
            allowLocal={allowLocalRepos}
            variant="error"
            src={activeSrc || prefill?.src}
          />
        ) : fieldError ? (
          <p id={ERROR_ID} role="alert" class="new-project-error">
            {fieldError}
          </p>
        ) : (
          showStandingNotice && (
            <UnreachableSource hosted={hosted} allowLocal={allowLocalRepos} variant="standing" />
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
