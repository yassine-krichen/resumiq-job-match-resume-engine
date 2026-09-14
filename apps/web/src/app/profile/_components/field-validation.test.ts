import { describe, it, expect } from 'vitest';
import { validateFieldLength } from './field-validation';

describe('validateFieldLength', () => {
  it('returns an empty string for a valid in-bounds required value', () => {
    expect(validateFieldLength('Engineer', 'Role', { required: true, max: 200 })).toBe('');
  });

  it('returns an empty string for a valid in-bounds optional value', () => {
    expect(validateFieldLength('Remote', 'Location type', { max: 100 })).toBe('');
  });

  it('returns an empty string for an empty optional value', () => {
    expect(validateFieldLength('', 'Minor', { max: 200 })).toBe('');
  });

  it('rejects an empty required value with an "is required" message', () => {
    expect(validateFieldLength('', 'Company', { required: true, max: 200 })).toBe(
      'Company is required.',
    );
  });

  it('rejects a required value that is only whitespace', () => {
    expect(validateFieldLength('   ', 'Company', { required: true, max: 200 })).toBe(
      'Company is required.',
    );
  });

  it('rejects a value over the max length with a "characters or fewer" message', () => {
    const tooLong = 'a'.repeat(201);
    expect(validateFieldLength(tooLong, 'Title', { required: true, max: 200 })).toBe(
      'Title must be 200 characters or fewer.',
    );
  });

  it('accepts a value exactly at the max length boundary', () => {
    const exact = 'a'.repeat(200);
    expect(validateFieldLength(exact, 'Title', { required: true, max: 200 })).toBe('');
  });

  it('trims surrounding whitespace before evaluating length, so padding alone does not push a value over max', () => {
    const padded = `  ${'a'.repeat(200)}  `;
    expect(validateFieldLength(padded, 'Title', { required: true, max: 200 })).toBe('');
  });

  // Bounds mirrored from each MasterDB entry schema in packages/schemas/src/index.ts.
  it.each([
    ['ExperienEntrySchema.company', 200],
    ['ExperienceEntrySchema.role', 200],
    ['EducationEntrySchema.degree_type', 100],
    ['EducationEntrySchema.gpa', 20],
    ['ProjectEntrySchema.context', 2000],
    ['CertificationSchema.description', 5000],
  ])('rejects a value one character over the documented %s max of %i', (_label, max) => {
    const oneOver = 'a'.repeat(max + 1);
    expect(validateFieldLength(oneOver, 'Field', { max })).toBe(
      `Field must be ${max} characters or fewer.`,
    );
  });
});
