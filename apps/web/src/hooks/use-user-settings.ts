'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { UpdateUserSettingsDto, UserSettingsDto } from '@resumiq/schemas';

export type UserSettings = UserSettingsDto;
export type UpdateUserSettings = UpdateUserSettingsDto;

export const USER_SETTINGS_QUERY_KEY = ['jobs-settings'] as const;

export function getJobsSettings(): Promise<UserSettings> {
  return apiFetch('/jobs/settings');
}

export function updateJobsSettings(patch: UpdateUserSettings): Promise<UserSettings> {
  return apiFetch('/jobs/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * GET /api/jobs/settings — shared by /discover's filter bar (seeds
 * category_tags/work_mode) and /settings (renders all 8 fields), since both
 * read the same persisted UserSettings row.
 */
export function useUserSettings(): UseQueryResult<UserSettings> {
  return useQuery({ queryKey: USER_SETTINGS_QUERY_KEY, queryFn: getJobsSettings });
}

/**
 * PATCH /api/jobs/settings — writes the fresh row straight into the
 * `jobs-settings` cache slot on success, so both /discover and /settings see
 * the update immediately without an extra round-trip.
 */
export function useUpdateUserSettings(): UseMutationResult<
  UserSettings,
  Error,
  UpdateUserSettings
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateJobsSettings,
    onSuccess: (data) => queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, data),
  });
}
