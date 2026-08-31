// Shared fixture builders for /discover's test suite. Not a test file itself
// — colocated here since every test in this folder needs realistic,
// schema-shaped DiscoverFeed/UserSettings data.
import type {
  DiscoverFeedItem,
  DiscoverFeedResult,
  DiscoverJob,
  UserSettings,
} from './types';

export function buildDiscoverJob(overrides: Partial<DiscoverJob> = {}): DiscoverJob {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    companyName: 'Acme Corp',
    location: 'Berlin',
    remote: false,
    salaryRange: '$100k-$130k',
    parsedJd: {
      seniority: 'Senior',
      mandatory_technical_skills: ['TypeScript', 'NestJS'],
      nice_to_have_skills: ['Kubernetes'],
    },
    ...overrides,
  };
}

export function buildFeedItem(overrides: Partial<DiscoverFeedItem> = {}): DiscoverFeedItem {
  return {
    job: buildDiscoverJob(),
    matchScore: 78,
    ...overrides,
  };
}

export function buildFeedResult(
  items: DiscoverFeedItem[] = [buildFeedItem()],
  overrides: Partial<DiscoverFeedResult> = {},
): DiscoverFeedResult {
  return {
    total: items.length,
    page: 1,
    pageSize: 20,
    items,
    ...overrides,
  };
}

export function buildUserSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    match_threshold: 50,
    preferred_locations: [],
    target_roles: [],
    resume_template: 'default',
    auto_send_email: false,
    notify_on_new_jobs: true,
    category_tags: [],
    work_mode: [],
    ...overrides,
  };
}
