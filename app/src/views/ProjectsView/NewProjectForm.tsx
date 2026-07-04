// views/ProjectsView/NewProjectForm.tsx — new-source entry. A single source
// field that classifies itself as you type (srcKind) and drives a Git URL /
// Local path segment — manual override still works via the segment itself.
// Git sources get a repo-resolved branch dropdown; skip-cache is tucked
// behind an Advanced disclosure so the common path stays a one-field form.
//
// ProjectsView unmounts this component while a load is in flight (its own
// inline progress block + Cancel take over) — `loading` here only guards
// submit against a stray double-fire in the render that flips it true.

import './NewProjectForm.css';
import { useState } from 'preact/hooks';
import { SegmentedSelect } from '@/components/SegmentedSelect/SegmentedSelect';
import { srcKind, SourceKind } from '@/utils/sources';
import type { SourcePayload } from '@/state/stores/ui';
import { SCAN_PROGRESS } from '@/state/stores/scanProgress';
import { BranchSelect } from './BranchSelect';

export interface NewProjectFormProps {
  allowLocalRepos: boolean;
  prefill?: SourcePayload;
  onSubmit: (payload: SourcePayload) => void;
}

const KIND_OPTIONS = [
  { value: SourceKind.Remote, label: 'Git URL' },
  { value: SourceKind.Local, label: 'Local path' },
];

// A source string worth resolving branches for: has a scheme (https://,
// ssh://, ...) or the scp-form host (user@host:path). Guards against firing
// /api/branches on every keystroke of a half-typed URL.
function looksResolvable(v: string): boolean {
  return srcKind(v) === SourceKind.Remote && (/:\/\/.+\/.+/.test(v) || /^[^@]+@[^:]+:.+/.test(v));
}

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

  const loading = SCAN_PROGRESS.value !== null;
  const localOff = kind === SourceKind.Local && !allowLocalRepos;

  // Smart kind auto-select: reclassify on every keystroke, in either
  // direction (a URL pasted into what was the Local tab flips back to Git).
  // A full clear keeps the current kind rather than snapping to Local on
  // empty input. Clicking the segment directly (onCommit below) is a manual
  // override that bypasses this — it always wins until the next keystroke.
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
      setResolvedUrl(looksResolvable(v) ? v : '');
    }
  }

  const activeSrc = source.trim();
  const canSubmit = !loading && !localOff && activeSrc.length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      src: activeSrc,
      branch: kind === SourceKind.Remote ? branch.trim() || undefined : undefined,
      skipCache: skipCache || undefined,
    });
  }

  return (
    <div class="new-project">
      <SegmentedSelect
        value={kind}
        options={KIND_OPTIONS}
        onCommit={(v) => setKind(v as SourceKind)}
      />

      {!localOff && (
        <div class="new-project-field">
          <label>{kind === SourceKind.Remote ? 'URL' : 'Path'}</label>
          <input
            class="form-input"
            type="text"
            aria-label={kind === SourceKind.Remote ? 'URL' : 'Path'}
            autoComplete="off"
            spellcheck={false}
            value={source}
            onInput={(e) => onSourceInput((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {kind === SourceKind.Remote && (
        <BranchSelect url={resolvedUrl} value={branch} onChange={setBranch} key={resolvedUrl} />
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

      <button
        type="button"
        class="new-project-advanced-toggle"
        aria-expanded={advanced}
        aria-controls="new-project-advanced"
        onClick={() => setAdvanced((a) => !a)}
      >
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

      <button
        type="button"
        class="btn-primary"
        aria-label="Open project"
        disabled={!canSubmit}
        onClick={submit}
      >
        Open project
      </button>
    </div>
  );
}
