import { getRenderEngine, LatexRenderer, TypstRenderer } from './index';

describe('getRenderEngine', () => {
  const originalEnv = process.env.RESUME_RENDER_ENGINE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.RESUME_RENDER_ENGINE;
    else process.env.RESUME_RENDER_ENGINE = originalEnv;
  });

  it('defaults to LatexRenderer when RESUME_RENDER_ENGINE is unset', () => {
    delete process.env.RESUME_RENDER_ENGINE;

    expect(getRenderEngine()).toBeInstanceOf(LatexRenderer);
  });

  it('returns TypstRenderer when RESUME_RENDER_ENGINE=typst', () => {
    process.env.RESUME_RENDER_ENGINE = 'typst';

    expect(getRenderEngine()).toBeInstanceOf(TypstRenderer);
  });

  it('returns LatexRenderer when RESUME_RENDER_ENGINE=latex', () => {
    process.env.RESUME_RENDER_ENGINE = 'latex';

    expect(getRenderEngine()).toBeInstanceOf(LatexRenderer);
  });

  it('throws on an unrecognized RESUME_RENDER_ENGINE value instead of silently falling back', () => {
    process.env.RESUME_RENDER_ENGINE = 'docx';

    expect(() => getRenderEngine()).toThrow(/Unknown RESUME_RENDER_ENGINE "docx"/);
  });
});
