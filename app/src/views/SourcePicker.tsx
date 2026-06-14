// views/SourcePicker.tsx — Modal for picking the active source (local path or
// git URL). Owns its own DOM, mounted into #source-picker-root. Recents
// are pulled from state/stores/source.ts each time the modal renders.
//
// Preact component: SourcePicker (signal-driven).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import { listRecents, removeRecent } from '@/state/stores/source';
import { clearManifestCache } from '@/api/manifest';
import { srcKind, SourceKind } from '@/utils/sources';
import { URL_PARAMS } from '@/constants/urlParams';
import { Folder, Trash2, TriangleAlert, X } from 'lucide-preact';
import { SOURCE_PICKER, type SourcePayload } from '@/state/stores/ui';
import { SERVER_CONFIG } from '@/state/stores/serverConfig';

// ── Hosting-site SVG icons ───────────────────────────────────────────────────

import { HostingIcon } from '@/components/HostingIcon';

// ── Public types ────────────────────────────────────────────────────────────

/** Which tab of the picker is active. Matches NodeKind-style enum convention. */
export enum SourceTab {
  Remote = 'remote',
  Local = 'local',
}

/** Infer which tab a source string belongs to: git-like URLs / SCP syntax
 *  → Remote, anything else (filesystem paths) → Local. UX-only tab defaulting
 *  and recents icon selection — the backend is the source of truth for what
 *  a source actually is. */
export function inferSourceTab(src: string): SourceTab {
  return srcKind(src) === SourceKind.Remote ? SourceTab.Remote : SourceTab.Local;
}

// SourcePayload / OpenOpts (the picker's submit + open contracts) live in
// state/stores/ui — see the import above — so state stays view-independent.

// ── Preact component state shape ────────────────────────────────────────────

export interface SourcePickerState {
  dismissible: boolean;
  activeTab: SourceTab;
  prefillSrc: string;
  prefillBranch: string;
  error: string | null;
  allowLocalRepos: boolean;
}

export interface SourcePickerModalProps {
  state: Signal<SourcePickerState>;
  onSubmit: (s: SourcePayload) => void;
  onClose: () => void;
}

// ── Preact component ────────────────────────────────────────────────────────

export function SourcePickerModal({ state, onSubmit, onClose }: SourcePickerModalProps) {
  const s = state.value;

  // This component is only mounted while the picker is visible — the parent
  // (<SourcePicker> / the signal wrapper) renders null when closed, which
  // unmounts us and resets these useState inputs on the next open. So there is
  // no `open` flag and no conditional early return: hooks always run.
  const [activeTab, setActiveTab] = useState<SourceTab>(s.activeTab);
  const [urlValue, setUrlValue] = useState(s.activeTab === SourceTab.Remote ? s.prefillSrc : '');
  const [branchValue, setBranchValue] = useState(s.prefillBranch);
  const [pathValue, setPathValue] = useState(s.activeTab === SourceTab.Local ? s.prefillSrc : '');
  const [skipCache, setSkipCache] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // Escape dismisses the modal when it's dismissible.
  useEffect(() => {
    if (!s.dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [s.dismissible, onClose]);

  // Focus (and select) the active tab's input on mount and on tab switch, so
  // the user can type/paste immediately.
  useEffect(() => {
    const el = activeTab === SourceTab.Local ? pathInputRef.current : urlInputRef.current;
    el?.focus();
    el?.select();
  }, [activeTab]);

  const urlParams = new URLSearchParams(window.location.search);
  const currentSrc = urlParams.get(URL_PARAMS.SRC) ?? '';
  const currentBranch = urlParams.get(URL_PARAMS.BRANCH) ?? '';
  const recents = listRecents();

  function handleSubmit() {
    const src = activeTab === SourceTab.Local ? pathValue.trim() : urlValue.trim();
    if (!src) return;
    const branch = activeTab === SourceTab.Remote ? branchValue.trim() || undefined : undefined;
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
    // No manual re-render needed: removeRecent mutates the RECENTS signal, which
    // this component reads via listRecents(), so the list re-renders on its own.
  }

  const showFormFields = !(!s.allowLocalRepos && activeTab === SourceTab.Local);

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (s.dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Open project">
        <div class="modal-header">
          <span>Open project</span>
          {s.dismissible && (
            <button
              class="btn-icon btn-icon--lg"
              data-action="close"
              aria-label="Close"
              onClick={onClose}
            >
              <X class="lucide-icon" />
            </button>
          )}
        </div>
        <div class="modal-body">
          {s.error && <div class="modal-error">{s.error}</div>}
          <div class="modal-tabs">
            <button
              type="button"
              data-tab="remote"
              class={activeTab === SourceTab.Remote ? 'active' : ''}
              onClick={() => setActiveTab(SourceTab.Remote)}
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

          <div
            data-pane="remote"
            style={{ display: activeTab === SourceTab.Remote ? 'block' : 'none' }}
          >
            <div class="modal-field">
              <label>URL</label>
              <input
                ref={urlInputRef}
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

          <div
            data-pane="local"
            style={{ display: activeTab === SourceTab.Local ? 'block' : 'none' }}
          >
            {s.allowLocalRepos ? (
              <div class="modal-field">
                <label>Path</label>
                <input
                  ref={pathInputRef}
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
                  codecity is running without <code>CODECITY_ALLOW_LOCAL_REPOS=1</code>. Restart the
                  container with the env var set and a read-only mount of the directory you want to
                  load.
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
                />{' '}
                Skip cache (fresh scan)
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
                const disabledTitle = isDisabled
                  ? 'Local repos are disabled. Restart codecity with CODECITY_ALLOW_LOCAL_REPOS=1 to load this.'
                  : '';
                const rowClasses = [
                  'recent-row',
                  isActive && 'recent-row--active',
                  isDisabled && 'recent-row--disabled',
                ]
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
                      <span class="recent-icon">
                        {isDisabled ? (
                          <TriangleAlert class="lucide-icon" />
                        ) : isLocal ? (
                          <Folder class="lucide-icon" />
                        ) : (
                          <HostingIcon src={r.src} />
                        )}
                      </span>
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
                      <Trash2 class="lucide-icon" />
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
// Reads SOURCE_PICKER + SERVER_CONFIG directly for open-state/prefill, but takes
// onSubmit/onClose via props from App (App owns the stateful submit handler from
// useManifestSource and the pure closeSourcePicker store action). Returns null
// when the picker is closed so SourcePickerModal fully unmounts — its
// useState-backed form inputs reset on the next open.

export interface SourcePickerProps {
  onSubmit: (payload: SourcePayload) => void;
  onClose: () => void;
}

export function SourcePicker({ onSubmit, onClose }: SourcePickerProps) {
  const sp = SOURCE_PICKER.value;
  if (!sp.visible) return null;

  const serverCfg = SERVER_CONFIG.value;
  const opts = sp.opts ?? {};
  const prefill = opts.prefill;
  const prefillSrc = prefill?.src ?? '';

  const pickerState: SourcePickerState = {
    dismissible: opts.dismissible ?? false,
    // Only default to the Local tab when local repos are enabled — otherwise a
    // local-path prefill would land on the disabled-Local dead-end view.
    activeTab:
      prefillSrc && serverCfg.allowLocalRepos ? inferSourceTab(prefillSrc) : SourceTab.Remote,
    prefillSrc,
    prefillBranch: prefill?.branch ?? '',
    error: opts.error ?? null,
    allowLocalRepos: serverCfg.allowLocalRepos,
  };

  // Wrap pickerState in a minimal signal-like object so SourcePickerModal's
  // `state.value` read works. The force-re-render write (on recent-remove) is
  // no longer needed: removeRecent writes to RECENTS signal which Preact tracks.
  const stateSignal = {
    get value() {
      return pickerState;
    },
    set value(_: SourcePickerState) {
      /* re-renders via RECENTS signal */
    },
  } as Signal<SourcePickerState>;

  return <SourcePickerModal state={stateSignal} onSubmit={onSubmit} onClose={onClose} />;
}
