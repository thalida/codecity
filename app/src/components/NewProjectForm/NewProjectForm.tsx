// components/NewProjectForm/NewProjectForm.tsx — new-source entry. A single
// source field that classifies itself as you type (srcKind) and drives a Git
// URL / Local path tab — manual override still works via the tab itself. Git
// sources get a repo-resolved branch dropdown; skip-cache is tucked behind an
// Advanced disclosure so the common path stays a one-field form. Submits on
// Enter (real <form>) or the Open project button.

import './NewProjectForm.css';
import { useState } from 'preact/hooks';
import { ChevronRight } from 'lucide-preact';
import { PaneTabs } from '@/components/PaneTabs/PaneTabs';
import { BranchSelect } from '@/components/BranchSelect/BranchSelect';
import { srcKind, SourceKind, validateGitUrl, looksResolvable } from '@/utils/sources';
import type { SourcePayload } from '@/state/stores/ui';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
}

const KIND_TABS = [
  { id: SourceKind.Remote, label: 'Repo URL' },
  { id: SourceKind.Local, label: 'Local Path' },
];

export function NewProjectForm({ allowLocalRepos, prefill, onSubmit }: NewProjectFormProps) {
  const initialKind = prefill?.src && allowLocalRepos ? srcKind(prefill.src) : SourceKind.Remote;
  const [kind, setKind] = useState<SourceKind>(initialKind);
  const [source, setSource] = useState(prefill?.src ?? '');
  const [branch, setBranch] = useState(prefill?.branch ?? '');
  const [resolvedUrl, setResolvedUrl] = useState(
    initialKind === SourceKind.Remote && prefill?.src && looksResolvable(prefill.src)
      ? prefill.src
      : ''
  );
  const [skipCache, setSkipCache] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null); // from BranchSelect

  const loading = SCAN_PROGRESS.value !== null;
  const localOff = kind === SourceKind.Local && !allowLocalRepos;

  // Smart kind auto-select: reclassify on every keystroke, in either
  // direction (a URL pasted into what was the Local tab flips back to Git).
  // A full clear keeps the current kind rather than snapping to Local on
  // empty input. Clicking a tab directly is a manual override that bypasses
  // this — it always wins until the next keystroke.
  function onSourceInput(v: string) {
    setSource(v);
    const k = v.trim() ? srcKind(v) : kind;
    // Never reclassify to Local when local repos are disabled: Local isn't a
    // reachable destination there, and doing so mid-keystroke (srcKind treats a
    // half-typed URL like "h" as Local) would flip localOff true and unmount
    // the very field the user is typing into, dropping focus. Pin Remote.
    const nextKind = k === SourceKind.Local && !allowLocalRepos ? SourceKind.Remote : k;
    if (nextKind !== kind) setKind(nextKind);
    if (nextKind === SourceKind.Remote) {
      // Branch reset on URL change (bug #2): a stale pick from a previous
      // repo must never ride along to whatever's typed now. BranchSelect is
      // also remounted below (key={resolvedUrl}), so its internal fetch
      // state can't straddle two repos either.
      setBranch('');
      // Only resolve branches for a URL that passes validation, so an invalid
      // URL (a #anchor, say) never fires /api/branches or shows a branch error.
      setResolvedUrl(looksResolvable(v) && !validateGitUrl(v) ? v : '');
    }
  }

  const activeSrc = source.trim();
  const sourceError = kind === SourceKind.Remote ? validateGitUrl(source) : null;
  // A branch-lookup failure means the URL/repo is bad (usually "repository not
  // found"), so treat it like a validation error — one inline field error that
  // blocks submit — rather than letting the user click into a doomed load that
  // fails with a different, jarring error state.
  const fieldError = sourceError ?? (kind === SourceKind.Remote ? branchError : null);
  const canSubmit = !loading && !localOff && activeSrc.length > 0 && !fieldError;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      src: activeSrc,
      branch: kind === SourceKind.Remote ? branch.trim() || undefined : undefined,
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
      <PaneTabs tabs={KIND_TABS} active={kind} onSelect={(id) => setKind(id as SourceKind)} />

      {!localOff && (
        <div class="new-project-field">
          <label>{kind === SourceKind.Remote ? 'URL' : 'Path'}</label>
          <input
            class={fieldError ? 'form-input form-input--error' : 'form-input'}
            type="text"
            aria-label={kind === SourceKind.Remote ? 'URL' : 'Path'}
            aria-invalid={fieldError ? 'true' : undefined}
            autoComplete="off"
            spellcheck={false}
            value={source}
            onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
          />
          {fieldError && <p class="new-project-error">{fieldError}</p>}
        </div>
      )}

      {kind === SourceKind.Remote && (
        <BranchSelect
          url={resolvedUrl}
          value={branch}
          onChange={setBranch}
          onError={setBranchError}
          key={resolvedUrl}
        />
      )}

      {localOff && (
        <div class="new-project-note">
          Local repos are off.{' '}
          <a
            class="link--chrome"
            href="https://github.com/thalida/codecity#local-directories"
            target="_blank"
            rel="noopener noreferrer"
          >
            How to enable
          </a>
        </div>
      )}

      {!localOff && (
        <>
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
        </>
      )}
    </form>
  );
}
