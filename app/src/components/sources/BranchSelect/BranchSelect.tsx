// components/sources/BranchSelect/BranchSelect.tsx — the branch dropdown for a
// resolved repo. It tracks no url changes itself: the parent re-keys it per url,
// and that remount is what stops a previous repo's pick leaking into the next.
// A lookup failure goes to onError, since it means the URL is bad, not the branch.
import './BranchSelect.css';
import { useEffect, useState } from 'preact/hooks';
import { LoaderCircle } from 'lucide-preact';
import { fetchBranches } from '@/api/branches';
import { ScanError, type ScanErrorCode } from '@/api/manifest';

export interface BranchSelectProps {
  url: string; // a resolvable git URL, or '' to stay idle
  value: string; // '' means "use the repo default"
  onChange: (branch: string) => void;
  /** Reports the resolution error to the parent (null once it clears/resolves)
   *  so the parent can surface it as the URL field error and disable submit. */
  onError: (message: string | null, code?: ScanErrorCode) => void;
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
        onError(
          e instanceof Error ? e.message : String(e),
          e instanceof ScanError ? e.code : undefined
        );
      }
    );
    return () => {
      live = false;
    };
    // url alone: the parent remounts per repo, so no stale closure to widen
    // this list against.
  }, [url]);

  // Idle (no url) and error (reported to the parent) render nothing.
  if (state.status === BranchStatus.Idle || state.status === BranchStatus.Error) return null;

  return (
    <div class="branch-select">
      <label htmlFor="branch-select">Branch</label>
      {state.status === BranchStatus.Loading && (
        <div class="branch-select-status" role="status">
          <LoaderCircle class="icon branch-select-spinner" aria-hidden="true" />
          Resolving branches…
        </div>
      )}
      {state.status === BranchStatus.Ready && (
        <select
          id="branch-select"
          class="form-input form-input--select"
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
