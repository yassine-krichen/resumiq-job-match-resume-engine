import { describe, it, expect, beforeEach } from 'vitest';
import type { IngestDraftEntryDto } from '@resumiq/schemas';
import { clearPendingEntries, loadPendingEntries, savePendingEntries } from './pending-entries';

const experienceEntry: IngestDraftEntryDto = {
  type: 'experience',
  missingFields: [],
  entry: {
    company: 'Acme Corp',
    company_industry: 'Software',
    role: 'Backend Engineer',
    location: 'Remote',
    location_type: 'Remote',
    startDate: 'Jan 2023',
    endDate: 'Present',
    isCurrent: true,
    core_competencies: [],
    technologies_used: [],
    raw_achievements: [],
    quantifiable_metrics: [],
  },
};

const interestEntry: IngestDraftEntryDto = { type: 'interest', missingFields: [], entry: 'Chess' };

describe('pending-entries (onboarding sessionStorage handoff)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('loadPendingEntries', () => {
    it('returns null when nothing has been saved', () => {
      expect(loadPendingEntries()).toBeNull();
    });

    it('returns null when the stored value is malformed JSON', () => {
      sessionStorage.setItem('onboarding:pendingIngestEntries', '{not valid json');

      expect(loadPendingEntries()).toBeNull();
    });

    it('returns null when the stored value is valid JSON but not an array', () => {
      sessionStorage.setItem('onboarding:pendingIngestEntries', JSON.stringify({ foo: 'bar' }));

      expect(loadPendingEntries()).toBeNull();
    });

    it('returns the previously saved entries, in the order they were saved', () => {
      savePendingEntries([experienceEntry, interestEntry]);

      expect(loadPendingEntries()).toEqual([experienceEntry, interestEntry]);
    });
  });

  describe('savePendingEntries', () => {
    it('persists entries so a subsequent loadPendingEntries call in the same tab can read them back', () => {
      savePendingEntries([interestEntry]);

      expect(loadPendingEntries()).toEqual([interestEntry]);
    });

    it('overwrites whatever was previously saved rather than appending to it', () => {
      savePendingEntries([experienceEntry]);
      savePendingEntries([interestEntry]);

      expect(loadPendingEntries()).toEqual([interestEntry]);
    });

    it('persists an empty array as an empty array, not as "nothing pending"', () => {
      savePendingEntries([]);

      expect(loadPendingEntries()).toEqual([]);
    });
  });

  describe('clearPendingEntries', () => {
    it('removes previously saved entries so loadPendingEntries returns null afterward', () => {
      savePendingEntries([experienceEntry]);

      clearPendingEntries();

      expect(loadPendingEntries()).toBeNull();
    });

    it('does not throw when there is nothing pending to clear', () => {
      expect(() => clearPendingEntries()).not.toThrow();
    });
  });
});
