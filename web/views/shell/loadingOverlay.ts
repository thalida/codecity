// loadingOverlay.ts — Centered spinner + caption shown whenever a manifest
// is being fetched or applied. Reused for direct-boot loads and modal
// submits so the user sees the same UI regardless of entry point.

export interface LoadingOverlay {
  show(caption: string): void;
  hide(): void;
}

export function createLoadingOverlay(): LoadingOverlay {
  const root = document.getElementById('loading-overlay-root');
  if (!root) {
    return {
      show: () => {},
      hide: () => {},
    };
  }

  // Render once; show/hide just toggles display + updates caption text.
  root.innerHTML = `
    <div class="loading-backdrop">
      <div class="loading-card">
        <div class="loading-spinner"></div>
        <div class="loading-caption" role="status" aria-live="polite"></div>
      </div>
    </div>
  `;
  const captionEl = root.querySelector('.loading-caption') as HTMLDivElement;

  return {
    show(caption: string) {
      captionEl.textContent = caption;
      root.style.display = 'block';
    },
    hide() {
      root.style.display = 'none';
    },
  };
}
