import { backfillDescription } from './detail-fetch';
import { loadHtmlToText } from './provider-loader';
import type { CareerOpsHttpContext, ScrapedJobInput } from './types';

// Mirrors orchestrator.spec.ts's convention of mocking provider-loader
// wholesale — its real loadHtmlToText() dynamic-imports a vendored .mjs at
// runtime, which needs Node's native ESM loader (--experimental-vm-modules)
// that this package's default ts-jest/CJS setup doesn't enable. The stub
// below reimplements just enough of _html-to-text.mjs's tag-stripping (no
// entity decoding — none of these fixtures use HTML entities) to prove
// backfillDescription wires extraction → stripping → job.description
// correctly; the vendored stripper's own fidelity is untested either here
// or anywhere else in this package (third-party vendored code, no existing
// spec covers it).
jest.mock('./provider-loader', () => ({
  loadHtmlToText: jest.fn(),
}));

const loadHtmlToTextMock = loadHtmlToText as jest.Mock;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function jobFixture(overrides: Partial<ScrapedJobInput> = {}): ScrapedJobInput {
  return {
    title: 'Backend Engineer',
    url: 'https://example.com/jobs/1',
    company: 'Acme Corp',
    location: 'Remote',
    ...overrides,
  };
}

function jsonLdScript(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function pageHtml(...scripts: string[]): string {
  return `<html><head>${scripts.join('\n')}</head><body>irrelevant</body></html>`;
}

describe('backfillDescription', () => {
  let ctx: { fetchText: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = { fetchText: jest.fn() };
    loadHtmlToTextMock.mockResolvedValue(stripTags);
  });

  it('returns the job unchanged without fetching when description is already set', async () => {
    const job = jobFixture({ description: 'Already have one.' });

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(ctx.fetchText).not.toHaveBeenCalled();
    expect(result).toEqual(job);
  });

  it('populates description from a bare JobPosting JSON-LD object, HTML-stripped', async () => {
    const job = jobFixture();
    const html = pageHtml(
      jsonLdScript({ '@type': 'JobPosting', description: '<p>We build things. Great benefits.</p>' }),
    );
    ctx.fetchText.mockResolvedValue(html);

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(ctx.fetchText).toHaveBeenCalledWith(job.url, { redirect: 'error' });
    expect(result.description).toBe('We build things. Great benefits.');
    expect(result).toMatchObject({ title: job.title, url: job.url, company: job.company });
  });

  it('populates description from a JobPosting entry inside a JSON-LD array', async () => {
    const job = jobFixture();
    const html = pageHtml(
      jsonLdScript([
        { '@type': 'Organization', name: 'Acme Corp' },
        { '@type': 'JobPosting', description: '<div>Ship Rust services.</div>' },
      ]),
    );
    ctx.fetchText.mockResolvedValue(html);

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(result.description).toBe('Ship Rust services.');
  });

  it('selects the JobPosting script among multiple ld+json blocks of other @types', async () => {
    const job = jobFixture();
    const html = pageHtml(
      jsonLdScript({ '@type': 'Organization', name: 'Acme Corp' }),
      jsonLdScript({ '@type': 'BreadcrumbList', itemListElement: [] }),
      jsonLdScript({ '@type': 'JobPosting', description: '<p>Own the payments platform.</p>' }),
    );
    ctx.fetchText.mockResolvedValue(html);

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(result.description).toBe('Own the payments platform.');
  });

  it('returns the job unchanged when the page has no JSON-LD script at all', async () => {
    const job = jobFixture();
    ctx.fetchText.mockResolvedValue('<html><body><p>No structured data here.</p></body></html>');

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(result).toEqual(job);
    expect(result.description).toBeFalsy();
  });

  it('returns the job unchanged when the ld+json script contains malformed JSON', async () => {
    const job = jobFixture();
    const html = pageHtml('<script type="application/ld+json">{not valid json</script>');
    ctx.fetchText.mockResolvedValue(html);

    await expect(backfillDescription(job, ctx as unknown as CareerOpsHttpContext)).resolves.toEqual(job);
  });

  it('returns the job unchanged when none of the ld+json blocks are a JobPosting', async () => {
    const job = jobFixture();
    const html = pageHtml(
      jsonLdScript({ '@type': 'Organization', name: 'Acme Corp' }),
      jsonLdScript({ '@type': 'BreadcrumbList', itemListElement: [] }),
    );
    ctx.fetchText.mockResolvedValue(html);

    const result = await backfillDescription(job, ctx as unknown as CareerOpsHttpContext);

    expect(result).toEqual(job);
  });

  it('returns the job unchanged when ctx.fetchText rejects (network failure)', async () => {
    const job = jobFixture();
    ctx.fetchText.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(backfillDescription(job, ctx as unknown as CareerOpsHttpContext)).resolves.toEqual(job);
  });

  it('returns the job unchanged when loadHtmlToText() itself rejects', async () => {
    const job = jobFixture();
    const html = pageHtml(jsonLdScript({ '@type': 'JobPosting', description: '<p>We build things.</p>' }));
    ctx.fetchText.mockResolvedValue(html);
    loadHtmlToTextMock.mockRejectedValue(new Error('failed to load vendored stripper module'));

    await expect(backfillDescription(job, ctx as unknown as CareerOpsHttpContext)).resolves.toEqual(job);
  });

  it('returns the job unchanged when the resolved htmlToText() function throws on the extracted description', async () => {
    const job = jobFixture();
    const html = pageHtml(jsonLdScript({ '@type': 'JobPosting', description: '<p>Malformed markup breaks the stripper.</p>' }));
    ctx.fetchText.mockResolvedValue(html);
    loadHtmlToTextMock.mockResolvedValue(() => {
      throw new Error('stripper exploded on this input');
    });

    await expect(backfillDescription(job, ctx as unknown as CareerOpsHttpContext)).resolves.toEqual(job);
  });
});
