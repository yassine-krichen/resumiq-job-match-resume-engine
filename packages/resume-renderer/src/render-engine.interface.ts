import type { AISelection, MasterDB } from '@resumiq/ai-bridge';

export interface RenderResult {
  pdf: Buffer;
  pageCount: number;
  /**
   * The exact .tex or .typ source that produced `pdf` (post auto-shrink for
   * Typst) — persisted as Application.resumeSource so a rendered PDF is always
   * reproducible/auditable from its stored source.
   */
  source: string;
}

/**
 * Compiles a resume selection + career DB into a final PDF.
 * `templateId` is reserved for future multi-template support — both engines
 * currently ignore it and render the single locked template.
 */
export interface RenderEngine {
  render(selection: AISelection, db: MasterDB, templateId: string): Promise<RenderResult>;
}
