/**
 * Validates a trimmed text field against the `.min(1)`/`.max(N)` bounds
 * mirrored from the corresponding Zod schema in `packages/schemas/src/index.ts`
 * (e.g. `ExperienceEntrySchema.role`). Runs client-side so the user sees a
 * clear message immediately instead of only a raw 400 from `PATCH /profile`
 * after submitting.
 *
 * Returns an empty string when the value is valid, otherwise a
 * human-readable error message.
 */
export function validateFieldLength(
  value: string,
  label: string,
  { required = false, max }: { required?: boolean; max: number },
): string {
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return `${label} is required.`;
  if (trimmed.length > max) return `${label} must be ${max} characters or fewer.`;
  return '';
}
