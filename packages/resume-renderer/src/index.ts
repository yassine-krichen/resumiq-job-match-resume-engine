import { LatexRenderer } from './latex/latex-renderer';
import { TypstRenderer } from './typst/typst-renderer';
import type { RenderEngine } from './render-engine.interface';

export type { RenderEngine, RenderResult } from './render-engine.interface';
export { LatexRenderer } from './latex/latex-renderer';
export { TypstRenderer } from './typst/typst-renderer';

export type RenderEngineName = 'latex' | 'typst';

/**
 * Resolves the RenderEngine implementation from RESUME_RENDER_ENGINE
 * (default: 'latex'). Both engines shell out to local CLI binaries
 * (tectonic / typst) — no HTTP sidecar.
 */
export function getRenderEngine(): RenderEngine {
  const engine = (process.env.RESUME_RENDER_ENGINE ?? 'latex') as RenderEngineName;

  switch (engine) {
    case 'typst':
      return new TypstRenderer();
    case 'latex':
      return new LatexRenderer();
    default:
      throw new Error(
        `Unknown RESUME_RENDER_ENGINE "${engine}" — expected "latex" or "typst"`,
      );
  }
}
