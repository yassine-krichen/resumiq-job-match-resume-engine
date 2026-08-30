import { Injectable } from '@nestjs/common';
import { getRenderEngine } from '@resumiq/resume-renderer';
import type { RenderResult } from '@resumiq/resume-renderer';
import type { AISelection, MasterDB } from '@resumiq/ai-bridge';
import { LocalStorageService } from '../../common/storage/local-storage.service';

@Injectable()
export class ResumeService {
  constructor(private readonly storage: LocalStorageService) {}

  /**
   * Stateless render for live-preview while the user edits their selection.
   * Never persisted — callers stream the bytes straight back to the client.
   */
  async renderPreview(
    selection: AISelection,
    db: MasterDB,
    templateId: string,
  ): Promise<RenderResult> {
    const engine = getRenderEngine();
    return engine.render(selection, db, templateId);
  }

  /**
   * Final render — compiles the confirmed selection and persists the PDF via
   * StorageService. Caller (ApplicationsService) is responsible for persisting
   * resumeSource/renderedWith/status on the Application row.
   */
  async renderFinal(
    applicationId: string,
    userId: string,
    selection: AISelection,
    db: MasterDB,
    templateId: string,
  ): Promise<{ pdfPath: string; pageCount: number; renderedWith: string; source: string }> {
    const engine = getRenderEngine();
    const result = await engine.render(selection, db, templateId);

    const key = `${userId}/${applicationId}/resume.pdf`;
    const pdfPath = await this.storage.save(key, result.pdf);

    const renderedWith = process.env.RESUME_RENDER_ENGINE ?? 'latex';

    return { pdfPath, pageCount: result.pageCount, renderedWith, source: result.source };
  }
}
