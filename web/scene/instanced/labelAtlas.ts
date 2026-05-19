// scene/instanced/labelAtlas.ts — Shared atlas builder for label text.
//
// Extracted from labels.ts so that both the per-block label factory
// (labels.ts) and the cell-aware label factory (labelsCell.ts) can
// reuse the same shelf-packing + canvas-rasterisation logic.
//
// The only visible behaviour change vs. the original labels.ts atlas
// is the overflow strategy: instead of throwing when MAX_PAGES is
// exceeded, overflow labels are truncated+hashed to a shorter form.
// If the truncated form can be placed (it's shorter so it may fit in
// a pre-existing row), it is; otherwise the label is silently dropped
// from the atlas (writeLabelToSlot will treat missing rects as
// zero-scale, i.e. invisible). The renderer warns but does not crash.

import type { LabelTypographyConfig } from '@/config/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LabelAtlasRect {
  page: number;
  u: number;
  v: number;
  w: number;
  h: number;
  aspect: number;
}

export interface LabelAtlasResult {
  pages: HTMLCanvasElement[];
  rectByText: Map<string, LabelAtlasRect>;
}

// ---------------------------------------------------------------------------
// Module-level constants (same values as in the original labels.ts)
// ---------------------------------------------------------------------------

// WebGL2 guarantees MAX_TEXTURE_SIZE >= 2048; virtually all desktop GPUs
// support 8192. We pack labels into multiple pages of this size so a single
// codebase can have arbitrarily many distinct directory names.
const ATLAS_WIDTH = 8192;
const ATLAS_HEIGHT_MAX = 8192;
// Sanity bound. 16 pages of 8192×8192 = 1 GiB of texture memory if every
// page is full-bleed RGBA; in practice each page renders only the rows it
// uses, so memory tracks the actual label count. A real monorepo would
// need >2000 unique directory names to push past page 1 at default font.
const MAX_PAGES = 16;

// Maximum label character-width used during overflow truncation.
const OVERFLOW_MAX_LEN = 16;

// ---------------------------------------------------------------------------
// Hash helpers for overflow truncation
// ---------------------------------------------------------------------------

/**
 * DJB2 hash of a string — fast, non-cryptographic.
 * Returns an unsigned 32-bit integer.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}

/**
 * Truncate `s` to at most `maxLen` characters, appending a ~XXXX
 * hash suffix so that two different long strings that share a prefix
 * still produce distinct truncated labels.
 */
function truncateWithHash(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const hash = djb2(s).toString(16).slice(-4);
  return `${s.slice(0, maxLen - 5)}~${hash}`;
}

// ---------------------------------------------------------------------------
// Core atlas builder
// ---------------------------------------------------------------------------

/**
 * Pack `uniqueTexts` into a series of fixed-width canvas pages using
 * a shelf-fit algorithm. Returns the pages (as HTMLCanvasElements,
 * already painted) and a UV-rect map keyed by text.
 *
 * When the number of pages would exceed MAX_PAGES (the hard GPU-memory
 * budget), overflow labels are truncated+hashed to a shorter form:
 *   - If the truncated form was already placed, the original maps to
 *     that same rect (shared slot, slightly wrong text — acceptable
 *     for overflow corner cases).
 *   - Otherwise the label is dropped (no rect entry) so the mesh slot
 *     renders scale-zero (invisible). The renderer warns but does not
 *     crash.
 */
export function buildLabelAtlas(
  uniqueTexts: string[],
  typography: LabelTypographyConfig,
): LabelAtlasResult {
  if (uniqueTexts.length === 0) {
    return { pages: [], rectByText: new Map() };
  }

  // Step 1: measure each text.
  const measureCtx = document.createElement('canvas').getContext('2d')!;
  const fontSpec = `${typography.FONT_WEIGHT} ${typography.FONT_SIZE_PX}px ${typography.FONT_FAMILY}`;
  measureCtx.font = fontSpec;
  const paddingPx = Math.round(typography.FONT_SIZE_PX * typography.CANVAS_PADDING_FRAC);
  const strokeWidthPx = Math.round(typography.FONT_SIZE_PX * typography.STROKE_WIDTH_FRAC);
  const items = uniqueTexts.map((text) => {
    const w =
      Math.ceil(measureCtx.measureText(text).width) + paddingPx * 2;
    const h = typography.FONT_SIZE_PX + paddingPx * 2;
    return { text, w, h };
  });

  // Step 2: shelf-fit pack across multiple pages. Sort by height desc; place
  // left-to-right with row wraps. When a row would overflow page height,
  // start a new page.
  items.sort((a, b) => b.h - a.h);
  type Placement = { text: string; page: number; x: number; y: number; w: number; h: number };
  const placements: Placement[] = [];
  // Index of already-placed text → its placement, for overflow dedup.
  const placedByText = new Map<string, Placement>();

  let page = 0;
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const pageHeights: number[] = [];

  // overflow aliases: original text → display text (the truncated form
  // that was actually placed, or the original if not overflowed).
  const aliases = new Map<string, string>();

  for (const item of items) {
    // Wrap to next row when the current row is full.
    if (cursorX + item.w > ATLAS_WIDTH) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    // If the next row would overflow this page, start a new page.
    if (cursorY + item.h > ATLAS_HEIGHT_MAX) {
      pageHeights[page] = cursorY;
      page += 1;
      if (page >= MAX_PAGES) {
        // Atlas budget exhausted. Truncate this label and try to reuse
        // an existing placement or silently drop.
        const truncated = truncateWithHash(item.text, OVERFLOW_MAX_LEN);
        console.warn('[labelAtlas] atlas overflow; truncating label', {
          original: item.text,
          truncated,
        });
        if (placedByText.has(truncated)) {
          // Reuse the truncated form's slot.
          aliases.set(item.text, truncated);
        }
        // If not placed either, drop (no entry → invisible slot).
        // Either way skip this item — do NOT page-overflow further.
        page = MAX_PAGES - 1; // clamp so next item tries last page
        cursorX = 0;
        cursorY = 0;
        rowH = 0;
        continue;
      }
      cursorX = 0;
      cursorY = 0;
      rowH = 0;
    }

    if (placedByText.has(item.text)) {
      // Already placed (can happen if two originals truncate to same form).
      aliases.set(item.text, item.text);
      continue;
    }

    const placement: Placement = {
      text: item.text,
      page,
      x: cursorX,
      y: cursorY,
      w: item.w,
      h: item.h,
    };
    placements.push(placement);
    placedByText.set(item.text, placement);
    cursorX += item.w;
    rowH = Math.max(rowH, item.h);
  }
  pageHeights[page] = cursorY + rowH;

  // Step 3: paint each page into its own canvas. Trim each canvas to the
  // height actually used so we don't upload empty pixels to the GPU.
  const pages: HTMLCanvasElement[] = [];
  const pageContexts: CanvasRenderingContext2D[] = [];
  for (let p = 0; p <= page; p++) {
    const c = document.createElement('canvas');
    c.width = ATLAS_WIDTH;
    c.height = Math.max(1, pageHeights[p] ?? 1);
    const ctx = c.getContext('2d')!;
    ctx.font = fontSpec;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pages.push(c);
    pageContexts.push(ctx);
  }

  const rectByText: LabelAtlasResult['rectByText'] = new Map();
  for (const p of placements) {
    const ctx = pageContexts[p.page];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.lineWidth = strokeWidthPx;
    ctx.strokeStyle = typography.STROKE;
    ctx.strokeText(p.text, cx, cy);
    ctx.fillStyle = typography.FILL;
    ctx.fillText(p.text, cx, cy);
    const pageH = pages[p.page].height;
    rectByText.set(p.text, {
      page: p.page,
      u: p.x / ATLAS_WIDTH,
      // CanvasTexture defaults flipY=true, so the GPU sees the canvas
      // vertically inverted: a rect at canvas top (p.y=0) is at GL
      // texture v=1, not v=0. With a single-row atlas this didn't matter
      // (rect spanned v=0..1 either way); with multi-row atlases, rows
      // sample from the wrong band — every block read its neighbor's
      // text. Convert canvas-y → GL-v explicitly here.
      v: 1 - (p.y + p.h) / pageH,
      w: p.w / ATLAS_WIDTH,
      h: p.h / pageH,
      aspect: p.w / p.h,
    });
  }

  // Resolve aliases (overflow-truncated originals sharing a placed slot).
  for (const [original, display] of aliases) {
    const rect = rectByText.get(display);
    if (rect) rectByText.set(original, rect);
  }

  return { pages, rectByText };
}
