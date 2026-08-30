/**
 * Abstraction over file storage. LocalStorageService is the only implementation
 * for now; swapping to S3/R2/Supabase later means adding a class that satisfies
 * this interface and changing StorageModule's provider — no caller changes.
 */
export interface StorageService {
  save(key: string, buffer: Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
