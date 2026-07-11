// components/BranchSelect/BranchSelect.tsx — repo-resolved branch dropdown.
// Fetches the branch list for `url` and preselects the repo default. Owns no
// url-change tracking of its own: the parent re-keys it per resolved url
// (key={url}), so a branch pick from a previous repo can never leak into the
// next one — that remount is the actual fix for bug #2, not anything here.

import './BranchSelect.css';
import { useEffect, useState } from 'preact/hooks';
import { LoaderCircle } from 'lucide-preact';
import { fetchBranches } from '@/api/branches';

export interface BranchSelectProps {
  url: string; // a resolvable git URL, or '' to stay idle
  value: string; // '' means "use the repo default"
  onChange: (branch: string) => void;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; branches: string[]; def: string | null }
  | { status: 'error'; message: string };

export function BranchSelect({ url, value, onChange }: BranchSelectProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!url) {
      setState({ status: 'idle' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    fetchBranches(url).then(
      (r) => {
        if (!live) return;
        setState({ status: 'ready', branches: r.branches, def: r.default });
        if (r.default) onChange(r.default); // preselect the repo default
      },
      (e: unknown) => {
        if (!live) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => {
      live = false;
    };
    // url is the only trigger here — the parent remounts this component per
    // repo (key={url}), so there's no stale-onChange/value closure risk to
    // guard against by widening this dependency list.
  }, [url]);

  if (state.status === 'idle') return null;

  return (
    <div class="branch-select">
      {/* No "Branch" label in the error state — there's no branch to pick, and
          a lookup failure is usually a bad URL / missing repo, not a branch
          problem. Submit stays enabled; the server gives the definitive error. */}
      {state.status !== 'error' && <label>Branch</label>}
      {state.status === 'loading' && (
        <div class="branch-select-status">
          <LoaderCircle class="lucide-icon branch-select-spinner" />
          Resolving branches…
        </div>
      )}
      {state.status === 'error' && (
        <div class="branch-select-status branch-select-status--error">{state.message}</div>
      )}
      {state.status === 'ready' && (
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
