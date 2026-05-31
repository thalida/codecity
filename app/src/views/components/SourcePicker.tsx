// views/components/sourcePicker.tsx — Modal for picking the active source (local path or
// git URL). Owns its own DOM, mounted into #source-picker-root. Recents
// are pulled from sourceRecents.ts each time the modal renders.
//
// Preact component: SourcePicker (signal-driven).

import { useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { listRecents, removeRecent } from '@/state/runtime/sourceRecents';
import { clearManifestCache } from '@/api/manifest';
import { LucideIcon } from './LucideIcon';
import { LUCIDE_ICON_BASE_URL } from '@/constants';
import { SOURCE_PICKER, closeSourcePicker, submitNewSource } from '@/state/runtime/uiState';
import { SERVER_CONFIG } from '@/state/runtime/serverConfig';

// ── Hosting-site SVG icons ───────────────────────────────────────────────────

import { hostingIconSvg, alertIconSvg, folderIconSvg } from './hostingIcons';

// ── Public types ────────────────────────────────────────────────────────────

/** Which tab of the picker is active. Matches NodeKind-style enum convention. */
export enum SourceTab {
  Git = 'git',
  Local = 'local',
}

/** Infer which tab a source string belongs to: git-like URLs / SCP syntax
 *  → Git, anything else (filesystem paths) → Local. UX-only tab defaulting
 *  and recents icon selection — the backend is the source of truth for what
 *  a source actually is. */
export function inferSourceTab(src: string): SourceTab {
  const gitLike = /:\/\//.test(src) || /^[^@]+@[^:]+:/.test(src);
  return gitLike ? SourceTab.Git : SourceTab.Local;
}

export interface SourcePayload {
  src: string;
  branch?: string;
  /** When true, this open forces a fresh scan (server-side ?no_cache=1).
   *  Not persisted — re-opening from a recent uses cached scan by default. */
  skipCache?: boolean;
}

export interface OpenOpts {
  prefill?: SourcePayload;
  dismissible?: boolean; // default: false
  error?: string;
}

// ── Preact component state shape ────────────────────────────────────────────

export interface SourcePickerState {
  open: boolean;
  dismissible: boolean;
  activeTab: SourceTab;
  prefillSrc: string;
  prefillBranch: string;
  error: string | null;
  allowLocalRepos: boolean;
}

export interface SourcePickerComponentProps {
  state: Signal<SourcePickerState>;
  onSubmit: (s: SourcePayload) => void;
  onClose: () => void;
}

// ── Preact component ────────────────────────────────────────────────────────

export function SourcePickerComponent({ state, onSubmit, onClose }: SourcePickerComponentProps) {
  const s = state.value;
  if (!s.open) return null;

  const [activeTab, setActiveTab] = useState<SourceTab>(s.activeTab);
  const [urlValue, setUrlValue] = useState(s.activeTab === SourceTab.Git ? s.prefillSrc : '');
  const [branchValue, setBranchValue] = useState(s.prefillBranch);
  const [pathValue, setPathValue] = useState(s.activeTab === SourceTab.Local ? s.prefillSrc : '');
  const [skipCache, setSkipCache] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const currentSrc = urlParams.get('src') ?? '';
  const currentBranch = urlParams.get('branch') ?? '';
  const recents = listRecents();

  function handleSubmit() {
    const src = activeTab === SourceTab.Local ? pathValue.trim() : urlValue.trim();
    if (!src) return;
    const branch = activeTab === SourceTab.Git ? (branchValue.trim() || undefined) : undefined;
    onSubmit({ src, branch, skipCache: skipCache || undefined });
  }

  function handleRecentClick(src: string, branch: string | undefined) {
    onSubmit({ src, branch });
  }

  function handleRecentRemove(src: string, branch: string | undefined) {
    const branchSuffix = branch ? ` (${branch})` : '';
    const confirmed = window.confirm(
      `Remove "${src}"${branchSuffix} from recents?\n\n` +
        `This also clears its scan cache — re-adding it will trigger ` +
        `a fresh scan.`
    );
    if (!confirmed) return;
    removeRecent(src, branch);
    clearManifestCache(src, branch);
    // Force re-render by re-opening with same state
    state.value = { ...state.value };
  }

  const showFormFields = !((!s.allowLocalRepos) && activeTab === SourceTab.Local);
  const trashMaskUrl = `url(${LUCIDE_ICON_BASE_URL}trash-2.svg)`;

  return (
    <div class="modal-backdrop" onClick={(e) => {
      if (s.dismissible && e.target === e.currentTarget) onClose();
    }}>
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Open project">
        <div class="modal-header">
          <span>Open project</span>
          {s.dismissible && (
            <button class="btn-icon btn-icon--lg" data-action="close" aria-label="Close" onClick={onClose}>
              <LucideIcon name="x" />
            </button>
          )}
        </div>
        <div class="modal-body">
          {s.error && <div class="modal-error">{s.error}</div>}
          <div class="modal-tabs">
            <button
              type="button"
              data-tab="git"
              class={activeTab === SourceTab.Git ? 'active' : ''}
              onClick={() => setActiveTab(SourceTab.Git)}
            >
              Git URL
            </button>
            <button
              type="button"
              data-tab="local"
              class={activeTab === SourceTab.Local ? 'active' : ''}
              onClick={() => setActiveTab(SourceTab.Local)}
            >
              Local path
            </button>
          </div>

          <div data-pane="git" style={{ display: activeTab === SourceTab.Git ? 'block' : 'none' }}>
            <div class="modal-field">
              <label>URL</label>
              <input
                data-field="url"
                type="text"
                autoComplete="off"
                spellcheck={false}
                value={urlValue}
                onInput={(e) => setUrlValue((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="modal-field">
              <label>Branch</label>
              <input
                data-field="branch"
                type="text"
                autoComplete="off"
                spellcheck={false}
                placeholder="default"
                value={branchValue}
                onInput={(e) => setBranchValue((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>

          <div data-pane="local" style={{ display: activeTab === SourceTab.Local ? 'block' : 'none' }}>
            {s.allowLocalRepos ? (
              <div class="modal-field">
                <label>Path</label>
                <input
                  data-field="path"
                  type="text"
                  autoComplete="off"
                  spellcheck={false}
                  value={pathValue}
                  onInput={(e) => setPathValue((e.target as HTMLInputElement).value)}
                />
              </div>
            ) : (
              <div class="modal-warning">
                <strong>Local repositories are disabled</strong>
                <p>
                  codecity is running without{' '}
                  <code>CODECITY_ALLOW_LOCAL_REPOS=1</code>.
                  Restart the container with the env var set and a read-only mount of the
                  directory you want to load.
                </p>
                <p>
                  <a
                    href="https://github.com/thalida/codecity#local-directories"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    How to enable local repositories →
                  </a>
                </p>
              </div>
            )}
          </div>

          <div data-form-fields style={{ display: showFormFields ? '' : 'none' }}>
            <div class="modal-field">
              <label>
                <input
                  data-field="skip_cache"
                  type="checkbox"
                  checked={skipCache}
                  onChange={(e) => setSkipCache((e.target as HTMLInputElement).checked)}
                />
                {' '}Skip cache (fresh scan)
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="submit" onClick={handleSubmit}>
                Open project
              </button>
            </div>
          </div>

          {recents.length > 0 && (
            <div class="recents-list">
              <h3>Recent</h3>
              {recents.map((r) => {
                const isActive = r.src === currentSrc && (r.branch ?? '') === (currentBranch ?? '');
                const isLocal = inferSourceTab(r.src) === SourceTab.Local;
                const isDisabled = isLocal && !s.allowLocalRepos;
                const icon = isDisabled ? alertIconSvg : isLocal ? folderIconSvg : hostingIconSvg(r.src);
                const disabledTitle = isDisabled
                  ? 'Local repos are disabled. Restart codecity with CODECITY_ALLOW_LOCAL_REPOS=1 to load this.'
                  : '';
                const rowClasses = ['recent-row', isActive && 'recent-row--active', isDisabled && 'recent-row--disabled']
                  .filter(Boolean)
                  .join(' ');
                const subParts = [r.src];
                if (r.branch) subParts.push(r.branch);
                return (
                  <div key={`${r.src}:${r.branch ?? ''}`} class="recent-item">
                    <button
                      type="button"
                      class={rowClasses}
                      title={disabledTitle || undefined}
                      data-src={r.src}
                      data-branch={r.branch ?? ''}
                      data-disabled={isDisabled ? '1' : ''}
                      onClick={() => {
                        if (isActive || isDisabled) return;
                        handleRecentClick(r.src, r.branch);
                      }}
                    >
                      <span class="recent-icon" dangerouslySetInnerHTML={{ __html: icon }} />
                      <div class="recent-row-body">
                        <div class="recent-label">{r.label}</div>
                        <div class="recent-sub">{subParts.join(' · ')}</div>
                      </div>
                      {isActive && <span class="recent-row-badge">Active</span>}
                    </button>
                    <button
                      type="button"
                      class="btn-icon btn-icon--text"
                      data-action="recent-remove"
                      aria-label="Remove from recents"
                      onClick={() => handleRecentRemove(r.src, r.branch)}
                    >
                      <span
                        class="lucide-icon"
                        aria-hidden="true"
                        style={{ maskImage: trashMaskUrl, WebkitMaskImage: trashMaskUrl }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Signal-driven top-level component ──────────────────────────────────────
// Reads SOURCE_PICKER + SERVER_CONFIG directly. App.tsx renders <SourcePicker />
// with no props. Returns null when the picker is closed so SourcePickerComponent
// fully unmounts — its useState-backed form inputs reset on the next open.

export function SourcePicker() {
  const sp = SOURCE_PICKER.value;
  if (!sp.visible) return null;

  const serverCfg = SERVER_CONFIG.value;
  const opts = sp.opts ?? {};
  const prefill = opts.prefill;
  const prefillSrc = prefill?.src ?? '';

  const pickerState: SourcePickerState = {
    open: true,
    dismissible: opts.dismissible ?? false,
    activeTab: prefillSrc ? inferSourceTab(prefillSrc) : SourceTab.Git,
    prefillSrc,
    prefillBranch: prefill?.branch ?? '',
    error: opts.error ?? null,
    allowLocalRepos: serverCfg.allowLocalRepos,
  };

  // Wrap pickerState in a minimal signal-like object so SourcePickerComponent's
  // `state.value` read works. The force-re-render write (on recent-remove) is
  // no longer needed: removeRecent writes to RECENTS signal which Preact tracks.
  const stateSignal = {
    get value() { return pickerState; },
    set value(_: SourcePickerState) { /* re-renders via RECENTS signal */ },
  } as Signal<SourcePickerState>;

  return (
    <SourcePickerComponent
      state={stateSignal}
      onSubmit={(payload) => submitNewSource(payload)}
      onClose={() => closeSourcePicker()}
    />
  );
}
