import type { IngestEntryDto } from '@resumiq/schemas';

// The AI parse and the review step live on separate routes (/onboarding and
// /onboarding/review), so the parsed-but-not-yet-persisted entries need to
// survive a client-side navigation. sessionStorage is the simplest option
// that does that without introducing a global state library for one
// short-lived handoff — it's tab-scoped and cleared once confirmed/rejected.
const STORAGE_KEY = 'onboarding:pendingIngestEntries';

export function savePendingEntries(entries: IngestEntryDto[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** Returns `null` if nothing is pending or the stored value is malformed. */
export function loadPendingEntries(): IngestEntryDto[] | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IngestEntryDto[]) : null;
  } catch {
    return null;
  }
}

export function clearPendingEntries(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
