import { rm } from 'fs/promises';
import { resolve } from 'path';
import { NotFoundException } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service';

// Exercises the real filesystem under a dedicated test subtree (gitignored via
// apps/api/storage/) rather than mocking fs — path-traversal protection lives
// in path resolution, which a mock would trivially bypass.
const TEST_ROOT = resolve(process.cwd(), 'storage', 'local-storage.spec');

describe('LocalStorageService', () => {
  let service: LocalStorageService;

  beforeEach(() => {
    service = new LocalStorageService();
  });

  afterAll(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('round-trips a buffer through save() and get()', async () => {
    const key = 'local-storage.spec/round-trip/resume.pdf';
    const content = Buffer.from('%PDF-1.4 fake pdf bytes');

    const returnedKey = await service.save(key, content);
    const readBack = await service.get(returnedKey);

    expect(returnedKey).toBe(key);
    expect(readBack).toEqual(content);
  });

  it('creates intermediate directories that do not yet exist', async () => {
    const key = 'local-storage.spec/deeply/nested/path/resume.pdf';

    await service.save(key, Buffer.from('x'));
    const readBack = await service.get(key);

    expect(readBack).toEqual(Buffer.from('x'));
  });

  it('throws NotFoundException when reading a key that was never saved', async () => {
    await expect(service.get('local-storage.spec/does-not-exist.pdf')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete() removes a previously saved file so a subsequent get() 404s', async () => {
    const key = 'local-storage.spec/to-delete/resume.pdf';
    await service.save(key, Buffer.from('x'));

    await service.delete(key);

    await expect(service.get(key)).rejects.toThrow(NotFoundException);
  });

  it('delete() does not throw when the key was never saved', async () => {
    await expect(service.delete('local-storage.spec/never-existed.pdf')).resolves.not.toThrow();
  });

  it('rejects a save() key that attempts to traverse outside the storage root', async () => {
    await expect(
      service.save('../../../etc/passwd', Buffer.from('x')),
    ).rejects.toThrow(/path traversal/i);
  });

  it('rejects a delete() key that attempts to traverse outside the storage root', async () => {
    await expect(service.delete('../../../etc/passwd')).rejects.toThrow(/path traversal/i);
  });

  // Note: get()'s try/catch wraps the resolveKey() call itself, so a traversal
  // attempt is masked as a generic NotFoundException rather than surfacing the
  // "path traversal" error thrown by save()/delete() — still fails closed
  // (no read outside STORAGE_ROOT occurs), but the signal differs from the
  // other two methods. Flagging for the implementer/reviewer, not fixing here.
  it('still denies (fails closed) a traversal attempt on get(), surfaced as NotFoundException', async () => {
    await expect(service.get('../../../etc/passwd')).rejects.toThrow(NotFoundException);
  });
});
