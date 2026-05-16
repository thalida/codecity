// sourcePicker.ts — Modal for picking the active source (local path or
// git URL). Owns its own DOM, mounted into #source-picker-root. Recents
// are pulled from sourceRecents.ts each time the modal renders.

import { listRecents, removeRecent } from './sourceRecents.js';

export interface SourcePayload {
  src: string;
  branch?: string;
}

export interface OpenOpts {
  prefill?: SourcePayload;
  dismissible?: boolean;       // default: false
  error?: string;
}

export interface SourcePicker {
  open(opts?: OpenOpts): void;
  close(): void;
}

export function createSourcePicker(opts: {
  onSubmit: (s: SourcePayload) => void;
}): SourcePicker {
  const root = document.getElementById('source-picker-root');
  if (!root) {
    return { open: () => {}, close: () => {} };
  }

  let dismissible = false;
  let activeTab: 'local' | 'git' = 'local';

  function isGitLike(s: string): boolean {
    return /:\/\//.test(s) || /^[^@]+@[^:]+:/.test(s);
  }

  function deriveTabFromPrefill(p?: SourcePayload): 'local' | 'git' {
    if (!p) return 'local';
    return isGitLike(p.src) ? 'git' : 'local';
  }

  function render(o: OpenOpts) {
    dismissible = !!o.dismissible;
    activeTab = deriveTabFromPrefill(o.prefill);
    const prefillSrc = o.prefill?.src ?? '';
    const prefillBranch = o.prefill?.branch ?? '';

    root!.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Open project">
          <div class="modal-header">
            <span>Open project</span>
            ${dismissible
              ? '<button class="modal-close" aria-label="Close">×</button>'
              : ''}
          </div>
          <div class="modal-body">
            ${o.error ? `<div class="modal-error">${escapeHtml(o.error)}</div>` : ''}
            <div class="modal-tabs">
              <button type="button" data-tab="local"
                class="${activeTab === 'local' ? 'active' : ''}">Local path</button>
              <button type="button" data-tab="git"
                class="${activeTab === 'git' ? 'active' : ''}">Git URL</button>
            </div>

            <div data-pane="local" style="display: ${activeTab === 'local' ? 'block' : 'none'};">
              <div class="modal-field">
                <label>Path</label>
                <input data-field="path" type="text" autocomplete="off" spellcheck="false"
                  value="${activeTab === 'local' ? escapeAttr(prefillSrc) : ''}">
              </div>
            </div>

            <div data-pane="git" style="display: ${activeTab === 'git' ? 'block' : 'none'};">
              <div class="modal-field">
                <label>URL</label>
                <input data-field="url" type="text" autocomplete="off" spellcheck="false"
                  value="${activeTab === 'git' ? escapeAttr(prefillSrc) : ''}">
              </div>
              <div class="modal-field">
                <label>Branch (optional)</label>
                <input data-field="branch" type="text" autocomplete="off" spellcheck="false"
                  value="${escapeAttr(prefillBranch)}">
              </div>
            </div>

            <div class="modal-actions">
              <button type="button" class="submit">Open project</button>
            </div>

            ${renderRecents()}
          </div>
        </div>
      </div>
    `;

    wireEvents();
    root!.style.display = 'block';
    focusActiveInput();
  }

  function renderRecents(): string {
    const list = listRecents();
    if (list.length === 0) return '';
    const rows = list.map((r) => `
      <div class="recent-row" data-src="${escapeAttr(r.src)}"
           data-branch="${escapeAttr(r.branch ?? '')}">
        <span class="recent-icon">${isGitLike(r.src) ? '🌐' : '📁'}</span>
        <div>
          <div class="recent-label">${escapeHtml(r.label)}</div>
          <div class="recent-sub">${escapeHtml(r.src)}${
            r.branch ? ' · ' + escapeHtml(r.branch) : ''
          }</div>
        </div>
        <button class="recent-remove" aria-label="Remove from recents">×</button>
      </div>
    `).join('');
    return `<div class="recents-list"><h3>Recent</h3>${rows}</div>`;
  }

  function wireEvents(): void {
    // Tab switching
    root!.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab as 'local' | 'git';
        (root!.querySelector('[data-pane="local"]') as HTMLElement).style.display
          = activeTab === 'local' ? 'block' : 'none';
        (root!.querySelector('[data-pane="git"]') as HTMLElement).style.display
          = activeTab === 'git' ? 'block' : 'none';
        root!.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        focusActiveInput();
      });
    });

    // Submit
    root!.querySelector<HTMLButtonElement>('button.submit')!
      .addEventListener('click', submitFromForm);

    // Recent rows
    root!.querySelectorAll<HTMLElement>('.recent-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('recent-remove')) return;
        const src = row.dataset.src!;
        const branch = row.dataset.branch || undefined;
        opts.onSubmit({ src, branch });
      });
      row.querySelector<HTMLButtonElement>('.recent-remove')!
        .addEventListener('click', (e) => {
          e.stopPropagation();
          const src = row.dataset.src!;
          const branch = row.dataset.branch || undefined;
          removeRecent(src, branch);
          // Re-render: cheap.
          render({ dismissible });
        });
    });

    // Dismissible-only handlers
    if (dismissible) {
      root!.querySelector<HTMLButtonElement>('button.modal-close')!
        .addEventListener('click', close);
      root!.querySelector<HTMLElement>('.modal-backdrop')!
        .addEventListener('click', (e) => {
          if (e.target === e.currentTarget) close();
        });
      document.addEventListener('keydown', escHandler);
    }
  }

  function escHandler(e: KeyboardEvent): void {
    if (!dismissible) return;
    if (e.key === 'Escape') close();
  }

  function submitFromForm(): void {
    const src = activeTab === 'local'
      ? (root!.querySelector('[data-field="path"]') as HTMLInputElement).value.trim()
      : (root!.querySelector('[data-field="url"]') as HTMLInputElement).value.trim();
    if (!src) return;
    const branch = activeTab === 'git'
      ? (root!.querySelector('[data-field="branch"]') as HTMLInputElement).value.trim() || undefined
      : undefined;
    opts.onSubmit({ src, branch });
  }

  function focusActiveInput(): void {
    const sel = activeTab === 'local' ? '[data-field="path"]' : '[data-field="url"]';
    (root!.querySelector(sel) as HTMLInputElement | null)?.focus();
  }

  function close(): void {
    document.removeEventListener('keydown', escHandler);
    root!.style.display = 'none';
  }

  return {
    open(o: OpenOpts = {}) { render(o); },
    close,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string { return escapeHtml(s); }
