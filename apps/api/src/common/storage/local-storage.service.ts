import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import type { StorageService } from './storage.service';

const STORAGE_ROOT = resolve(process.cwd(), 'storage');

/**
 * Local filesystem storage — paths like ./storage/<userId>/<applicationId>/resume.pdf.
 * `key` is a relative path segment; callers never pass an absolute path.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  async save(key: string, buffer: Buffer): Promise<string> {
    const filePath = this.resolveKey(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw new NotFoundException(`File not found: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    const filePath = resolve(STORAGE_ROOT, key);
    if (!filePath.startsWith(STORAGE_ROOT)) {
      throw new Error(`Invalid storage key (path traversal attempt): ${key}`);
    }
    return join(STORAGE_ROOT, key);
  }
}
