// components/NewProjectForm/NewProjectForm.tsx — new-source entry. One field
// that takes either a git URL or a local path and classifies itself as you type
// (srcKind): a URL gets a repo-resolved branch dropdown; a local path is opened
// directly. When local repos are off, a clearly-local path shows an inline
// "not enabled" error instead of silently accepting it. skip-cache is tucked
// behind an Advanced disclosure. Submits on Enter (real <form>) or the button.

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
}

const SOURCE_LABEL = 'Repo URL or local path';
const LOCAL_DOCS_URL = 'https://github.com/thalida/codecity#local-directories';

export function NewProjectForm({ allowLocalRepos, prefill, onSubmit }: NewProjectFormProps) {
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

  const loading = SCAN_PROGRESS.value !== null;
  const activeSrc = source.trim();
  // One field, classified by what's typed. Empty defaults to a URL so the
  // branch dropdown's absence (not a path) is the resting state.
  const isRemote = activeSrc ? srcKind(activeSrc) === SourceKind.Remote : true;
  // The one thing this form can't open: a local path while local repos are off.
  // Gated on looksLikePath so a half-typed URL never blinks this error.
  const pathBlocked = !isRemote && !allowLocalRepos && looksLikePath(activeSrc);

  // A path change on a URL resets the branch (no stale pick rides along) and
  // only resolves branches for a URL that passes validation.
  function onSourceInput(v: string) {
    setSource(v);
    if (v.trim() && srcKind(v) === SourceKind.Remote) {
      setBranch('');
      setResolvedUrl(looksResolvable(v) && !validateGitUrl(v) ? v : '');
    } else {
      setResolvedUrl('');
      setBranch('');
    }
  }

  // Validate as a git URL for a URL, and also when local is off and the text
  // isn't a clear path (a partial/typo'd URL) so the guidance stays "enter a URL".
  const urlError = isRemote || (!allowLocalRepos && !pathBlocked) ? validateGitUrl(source) : null;
  const fieldError = urlError ?? (isRemote ? branchError : null);
  const canSubmit = !loading && activeSrc.length > 0 && !fieldError && !pathBlocked;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      src: activeSrc,
      branch: isRemote ? branch.trim() || undefined : undefined,
      skipCache: skipCache || undefined,
    });
  }

  const hasError = Boolean(fieldError) || pathBlocked;

  return (
    <form
      class="new-project"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div class="new-project-field">
        <label>{SOURCE_LABEL}</label>
        <input
          class={hasError ? 'form-input form-input--error' : 'form-input'}
          type="text"
          aria-label={SOURCE_LABEL}
          aria-invalid={hasError ? 'true' : undefined}
          autoComplete="off"
          spellcheck={false}
          placeholder={
            allowLocalRepos
              ? 'https://github.com/owner/repo or ~/projects/repo'
              : 'https://github.com/owner/repo'
          }
          value={source}
          onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
        />
        {pathBlocked ? (
          <p class="new-project-error">
            Local paths aren't enabled.{' '}
            <a class="link--chrome" href={LOCAL_DOCS_URL} target="_blank" rel="noopener noreferrer">
              How to enable
            </a>
          </p>
        ) : (
          fieldError && <p class="new-project-error">{fieldError}</p>
        )}
      </div>

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
        <ChevronRight class="lucide-icon new-project-advanced-caret" />
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
