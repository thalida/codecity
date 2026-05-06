// scene/instanced/labels.ts — Per-block label InstancedMesh + atlas builder.
import type { LabelTypographyConfig } from '@/config/index.js';

export interface LabelAtlasResult {
  canvas: HTMLCanvasElement;
  rectByText: Map<string, { u: number; v: number; w: number; h: number; aspect: number }>;
}

const ATLAS_WIDTH = 4096;
const ATLAS_HEIGHT_MAX = 8192;

export function buildLabelAtlas(
  uniqueTexts: string[],
  typography: LabelTypographyConfig,
): LabelAtlasResult {
  if (uniqueTexts.length === 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, rectByText: new Map() };
  }

  // Step 1: measure each text.
  const measureCtx = document.createElement('canvas').getContext('2d')!;
  const fontSpec = `${typography.FONT_WEIGHT} ${typography.FONT_SIZE_PX}px ${typography.FONT_FAMILY}`;
  measureCtx.font = fontSpec;
  const items = uniqueTexts.map((text) => {
    const w =
      Math.ceil(measureCtx.measureText(text).width) + typography.CANVAS_PADDING_PX * 2;
    const h = typography.FONT_SIZE_PX + typography.CANVAS_PADDING_PX * 2;
    return { text, w, h };
  });

  // Step 2: shelf-fit pack. Sort by height desc; left-to-right with row wraps.
  items.sort((a, b) => b.h - a.h);
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  const placements: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];
  for (const item of items) {
    if (cursorX + item.w > ATLAS_WIDTH) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    if (cursorY + item.h > ATLAS_HEIGHT_MAX) {
      throw new Error(
        `label atlas overflow at ${cursorY + item.h}px height (max ${ATLAS_HEIGHT_MAX}). ` +
          `${uniqueTexts.length} unique labels — paged atlas not yet implemented.`,
      );
    }
    placements.push({ text: item.text, x: cursorX, y: cursorY, w: item.w, h: item.h });
    cursorX += item.w;
    rowH = Math.max(rowH, item.h);
  }
  const atlasH = Math.max(1, cursorY + rowH);

  // Step 3: paint into the atlas canvas.
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontSpec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const rectByText: LabelAtlasResult['rectByText'] = new Map();
  for (const p of placements) {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.lineWidth = typography.STROKE_WIDTH_PX;
    ctx.strokeStyle = typography.STROKE;
    ctx.strokeText(p.text, cx, cy);
    ctx.fillStyle = typography.FILL;
    ctx.fillText(p.text, cx, cy);
    rectByText.set(p.text, {
      u: p.x / ATLAS_WIDTH,
      v: p.y / atlasH,
      w: p.w / ATLAS_WIDTH,
      h: p.h / atlasH,
      aspect: p.w / p.h,
    });
  }
  return { canvas, rectByText };
}
