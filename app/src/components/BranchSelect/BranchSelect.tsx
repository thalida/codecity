// components/BranchSelect/BranchSelect.tsx — repo-resolved branch dropdown.
// Fetches the branch list for `url` and preselects the repo default. Owns no
// url-change tracking of its own: the parent re-keys it per resolved url
// (key={url}), so a branch pick from a previous repo can never leak into the
// next one — that remount is the actual fix for bug #2, not anything here.
//
// A resolution failure is reported to the parent via onError (not rendered
// here) — the parent shows it as the URL field's error and blocks submit, since
// a lookup failure means the repo/URL is bad, not that a branch is missing.

import './BranchSelect.css';
import { useEffect, useState } from 'preact/hooks';
import { LoaderCircle } from 'lucide-preact';
import { fetchBranches } from '@/api/branches';

export interface BranchSelectProps {
  url: string; // a resolvable git URL, or '' to stay idle
  value: string; // '' means "use the repo default"
  onChange: (branch: string) => void;
  /** Reports the resolution error to the parent (null once it clears/resolves)
   *  so the parent can surface it as the URL field error and disable submit. */
  onError: (message: string | null) => void;
}

enum BranchStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
}

type State =
  | { status: BranchStatus.Idle }
  | { status: BranchStatus.Loading }
  | { status: BranchStatus.Ready; branches: string[]; def: string | null }
  | { status: BranchStatus.Error };

export function BranchSelect({ url, value, onChange, onError }: BranchSelectProps) {
  const [state, setState] = useState<State>({ status: BranchStatus.Idle });

  useEffect(() => {
    if (!url) {
      setState({ status: BranchStatus.Idle });
      onError(null);
      return;
    }
    let live = true;
    setState({ status: BranchStatus.Loading });
    onError(null);
    fetchBranches(url).then(
      (r) => {
        if (!live) return;
        setState({ status: BranchStatus.Ready, branches: r.branches, def: r.default });
        onError(null);
        if (r.default) onChange(r.default); // preselect the repo default
      },
      (e: unknown) => {
        if (!live) return;
        setState({ status: BranchStatus.Error });
        onError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      live = false;
    };
    // url is the only trigger here — the parent remounts this component per
    // repo (key={url}), so there's no stale-onChange/value closure risk to
    // guard against by widening this dependency list.
  }, [url]);

  // Idle (no url) and error (reported to the parent) render nothing.
  if (state.status === BranchStatus.Idle || state.status === BranchStatus.Error) return null;

  return (
    <div class="branch-select">
      <label>Branch</label>
      {state.status === BranchStatus.Loading && (
        <div class="branch-select-status">
          <LoaderCircle class="lucide-icon branch-select-spinner" />
          Resolving branches…
        </div>
      )}
      {state.status === BranchStatus.Ready && (
        <select
          class="form-input form-input--select"
          aria-label="Branch"
          value={value || state.def || ''}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
        >
          {state.branches.map((b) => (
            <option value={b} key={b}>
              {b}
              {b === state.def ? ' (default)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
