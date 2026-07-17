// components/NewProjectForm/NewProjectForm.tsx — new-source entry. One field
// that takes either a git URL or a local path and classifies itself as you type
// (srcKind): a URL gets a repo-resolved branch dropdown; a local path is opened
// directly. When local repos are off, the field is URL-only — the label,
// placeholder, and a standing "how to enable" notice all reflect that, and a
// typed path is blocked. skip-cache is tucked behind an Advanced disclosure.
// Submits on Enter (real <form>) or the button.

import './NewProjectForm.css';
import { useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import { BranchSelect } from '@/components/BranchSelect/BranchSelect';
import {
  srcKind,
  SourceKind,
  validateGitUrl,
  looksResolvable,
  looksLikePath,
} from '@/utils/sources';
import type { SourcePayload } from '@/state/stores/ui';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
  /** Fired when the user edits the source field, so the host can drop a stale
   *  open-error banner (the form itself owns no such error). */
  onDirty?: () => void;
}

const LOCAL_DOCS_URL = 'https://github.com/thalida/codecity#local-directories';

export function NewProjectForm({
  allowLocalRepos,
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
  const [skipCache, setSkipCache] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null); // from BranchSelect

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
  // The "local paths off" notice is only useful while the field could be a path
  // — hide it once the input reads as a URL so the URL flow stays clean.
  const showLocalNotice = !allowLocalRepos && !(isRemote && activeSrc.length > 0);

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
  }

  const urlError = isRemote || (!allowLocalRepos && !pathBlocked) ? validateGitUrl(source) : null;
  const fieldError = urlError ?? (isRemote ? branchError : null);
  const canSubmit = !loading && activeSrc.length > 0 && !fieldError && !pathBlocked;
  const hasError = Boolean(fieldError) || pathBlocked;

  function submit() {
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
        <label htmlFor="new-project-source">{sourceLabel}</label>
        <input
          id="new-project-source"
          class={hasError ? 'form-input form-input--error' : 'form-input'}
          type="text"
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={fieldError ? 'new-project-error' : undefined}
          autoComplete="off"
          spellcheck={false}
          placeholder={placeholder}
          value={source}
          onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
        />
        {fieldError && (
          <p id="new-project-error" role="alert" class="new-project-error">
            {fieldError}
          </p>
        )}
      </div>

      {showLocalNotice && (
        <p class="new-project-note">
          Local paths aren't enabled.{' '}
          <a class="link--chrome" href={LOCAL_DOCS_URL} target="_blank" rel="noopener noreferrer">
            How to enable
          </a>
        </p>
      )}

      {isRemote && (
        <BranchSelect
          url={resolvedUrl}
          value={branch}
          onChange={setBranch}
          onError={setBranchError}
          key={resolvedUrl}
        />
      )}

      <button
        type="button"
        class="new-project-advanced-toggle"
        aria-expanded={advanced}
        aria-controls="new-project-advanced"
        onClick={() => setAdvanced((a) => !a)}
      >
        <ChevronRight class="icon new-project-advanced-caret" />
        Advanced
      </button>
      {advanced && (
        <label id="new-project-advanced" class="new-project-skip-cache">
          <input
            type="checkbox"
            checked={skipCache}
            onChange={(e) => setSkipCache((e.target as HTMLInputElement).checked)}
          />
          Skip cache (fresh scan)
        </label>
      )}

      <button type="submit" class="btn-primary" aria-label="Open project" disabled={!canSubmit}>
        Open project
      </button>
    </form>
  );
}
