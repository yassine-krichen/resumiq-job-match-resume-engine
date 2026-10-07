import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { outreachPaths } from '../config/paths';
import { FakeGmail } from '../testing/fake-gmail';

import { fetchAndSaveSignature, loadSignature, SignatureMissingError, signatureFiles } from './signature';

function tempPaths(): ReturnType<typeof outreachPaths> {
  const root = mkdtempSync(join(tmpdir(), 'signature-'));
  mkdirSync(root, { recursive: true });
  return outreachPaths(root);
}

describe('loadSignature', () => {
  it('refuses when signature.html does not exist', () => {
    expect(() => loadSignature(tempPaths())).toThrow(SignatureMissingError);
    expect(() => loadSignature(tempPaths())).toThrow(/npm run outreach -- signature/);
  });

  it.each([[''], ['   \n'], ['<div> <br> </div>']])('refuses a signature that is empty once tags are stripped: %j', (html) => {
    const paths = tempPaths();
    writeFileSync(signatureFiles(paths).html, html);

    expect(() => loadSignature(paths)).toThrow(SignatureMissingError);
  });

  it('returns the HTML and its text form', () => {
    const paths = tempPaths();
    writeFileSync(signatureFiles(paths).html, '<div>Jane Doe<br>Student</div>');

    const signature = loadSignature(paths);

    expect(signature.html).toContain('Jane Doe');
    expect(signature.text).toContain('Jane Doe');
    expect(signature.text).not.toContain('<');
  });
});

describe('fetchAndSaveSignature', () => {
  it('caches the mailbox signature as html and text', async () => {
    const paths = tempPaths();

    const saved = await fetchAndSaveSignature(new FakeGmail(), 'jane.doe@example.com', paths);

    expect(readFileSync(saved.htmlFile, 'utf-8')).toContain('Software Engineering Student');
    expect(readFileSync(saved.textFile, 'utf-8')).toContain('Jane Doe');
    expect(loadSignature(paths).text).toContain('Jane Doe');
  });

  it('refuses to cache an empty signature and writes nothing', async () => {
    const paths = tempPaths();
    const gmail = new FakeGmail();
    gmail.signature = '';

    await expect(fetchAndSaveSignature(gmail, 'jane.doe@example.com', paths)).rejects.toThrow(SignatureMissingError);
    expect(() => loadSignature(paths)).toThrow(SignatureMissingError);
  });
});
