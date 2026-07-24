// city/components/buildings/dataFacade.ts — client-side facade images for
// data-building kinds that aren't a generic byte pattern. Rendered white-on-
// transparent to a canvas (matching the server fingerprint) and uploaded via
// the same texture array. Browser-native so no backend decode/deps:
//   - font  → a lowercase 'a' set in the actual font (FontFace + canvas)
//   - audio → a waveform of the decoded samples (Web Audio decodeAudioData)

import { fetchFileBytes } from '@/api/file';
import { FONT_EXTS, AUDIO_EXTS } from '@/constants/fileKinds';
import { PANEL_TEX_SIZE } from './facadePanelTextureArray';

export type DataFacadeKind = 'font' | 'audio' | 'fingerprint';

/** Which facade a data building's file wears, by extension: fonts get a glyph,
 *  audio a waveform, everything else the byte-pattern fingerprint. */
export function dataFacadeKind(ext: string): DataFacadeKind {
  const e = (ext || '').toLowerCase();
  if (FONT_EXTS.includes(e)) return 'font';
  if (AUDIO_EXTS.includes(e)) return 'audio';
  return 'fingerprint';
}

function _canvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_TEX_SIZE;
  canvas.height = PANEL_TEX_SIZE;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

// Unique @font-face family per render so concurrent facades don't collide.
let _fontSeq = 0;

/** A lowercase 'a' set in the file's own font, white on transparent. Loads the
 *  font via FontFace (handles woff/woff2/ttf/otf like the preview) and removes
 *  it after drawing so no global face leaks. null on any failure. */
export async function renderFontGlyphFacade(
  fullPath: string,
  version: string
): Promise<HTMLCanvasElement | null> {
  if (typeof FontFace === 'undefined' || typeof document.fonts === 'undefined') return null;
  const surface = _canvas();
  if (!surface) return null;
  let face: FontFace | null = null;
  try {
    const buf = await fetchFileBytes(fullPath, version);
    const family = `cc-facade-font-${(_fontSeq += 1)}`;
    face = await new FontFace(family, buf).load();
    document.fonts.add(face);
    const { canvas, ctx } = surface;
    ctx.font = `${PANEL_TEX_SIZE * 1.4}px "${family}"`;
    await document.fonts.load(ctx.font);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('a', PANEL_TEX_SIZE / 2, PANEL_TEX_SIZE / 2);
    return canvas;
  } catch {
    return null;
  } finally {
    if (face) document.fonts.delete(face);
  }
}

// One shared AudioContext (browsers cap the count); decodeAudioData works on it
// suspended, so no user gesture is needed.
let _audioCtx: AudioContext | null = null;
function _getAudioCtx(): AudioContext | null {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!_audioCtx) _audioCtx = new Ctor();
  return _audioCtx;
}

/** A centered waveform of the audio's samples, white on transparent. Decodes the
 *  file with Web Audio (handles mp3/wav/ogg/etc.) and draws one peak bar per
 *  output column. null on any failure. */
export async function renderWaveformFacade(
  fullPath: string,
  version: string
): Promise<HTMLCanvasElement | null> {
  const audioCtx = _getAudioCtx();
  const surface = _canvas();
  if (!audioCtx || !surface) return null;
  try {
    const buf = await fetchFileBytes(fullPath, version);
    // decodeAudioData detaches its input, so hand it a copy.
    const audio = await audioCtx.decodeAudioData(buf.slice(0));
    const data = audio.getChannelData(0);
    const { canvas, ctx } = surface;
    ctx.fillStyle = '#ffffff';
    const bucket = Math.max(1, Math.floor(data.length / PANEL_TEX_SIZE));
    const mid = PANEL_TEX_SIZE / 2;
    for (let x = 0; x < PANEL_TEX_SIZE; x++) {
      let peak = 0;
      for (let i = 0; i < bucket; i++) {
        const v = Math.abs(data[x * bucket + i] || 0);
        if (v > peak) peak = v;
      }
      const h = Math.max(1, peak * PANEL_TEX_SIZE);
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    return canvas;
  } catch {
    return null;
  }
}
