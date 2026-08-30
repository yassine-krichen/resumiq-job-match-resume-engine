import { ResumeService } from './resume.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { getRenderEngine } from '@resumiq/resume-renderer';
import type { AISelection, MasterDB } from '@resumiq/ai-bridge';

jest.mock('@resumiq/resume-renderer', () => ({
  getRenderEngine: jest.fn(),
}));

const getRenderEngineMock = getRenderEngine as jest.Mock;

describe('ResumeService', () => {
  let storage: { save: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let engine: { render: jest.Mock };
  let service: ResumeService;

  const selection = {} as AISelection;
  const db = {} as MasterDB;

  beforeEach(() => {
    storage = { save: jest.fn(), get: jest.fn(), delete: jest.fn() };
    engine = { render: jest.fn() };
    getRenderEngineMock.mockReset().mockReturnValue(engine);
    service = new ResumeService(storage as unknown as LocalStorageService);
  });

  describe('renderPreview', () => {
    it('returns the render engine result directly without persisting anything', async () => {
      const renderResult = { pdf: Buffer.from('pdf'), pageCount: 1, source: 'DOC' };
      engine.render.mockResolvedValue(renderResult);

      const result = await service.renderPreview(selection, db, 'default');

      expect(result).toBe(renderResult);
      expect(engine.render).toHaveBeenCalledWith(selection, db, 'default');
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('renderFinal', () => {
    const originalEngineEnv = process.env.RESUME_RENDER_ENGINE;

    afterEach(() => {
      if (originalEngineEnv === undefined) delete process.env.RESUME_RENDER_ENGINE;
      else process.env.RESUME_RENDER_ENGINE = originalEngineEnv;
    });

    it('renders, persists the PDF under a userId/applicationId key, and returns render metadata', async () => {
      process.env.RESUME_RENDER_ENGINE = 'typst';
      const renderResult = { pdf: Buffer.from('pdf-bytes'), pageCount: 1, source: 'DOC-SOURCE' };
      engine.render.mockResolvedValue(renderResult);
      storage.save.mockResolvedValue('user-1/app-1/resume.pdf');

      const result = await service.renderFinal('app-1', 'user-1', selection, db, 'default');

      expect(storage.save).toHaveBeenCalledWith('user-1/app-1/resume.pdf', renderResult.pdf);
      expect(result).toEqual({
        pdfPath: 'user-1/app-1/resume.pdf',
        pageCount: 1,
        renderedWith: 'typst',
        source: 'DOC-SOURCE',
      });
    });

    it('reports renderedWith as "latex" when RESUME_RENDER_ENGINE is unset', async () => {
      delete process.env.RESUME_RENDER_ENGINE;
      engine.render.mockResolvedValue({ pdf: Buffer.from('x'), pageCount: 1, source: 'S' });
      storage.save.mockResolvedValue('user-2/app-2/resume.pdf');

      const result = await service.renderFinal('app-2', 'user-2', selection, db, 'default');

      expect(result.renderedWith).toBe('latex');
    });
  });
});
