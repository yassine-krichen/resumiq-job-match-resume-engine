'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUpdateUserSettings, useUserSettings } from '@/hooks/use-user-settings';

const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
const SENIORITY_LEVELS = ['Entry', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead'] as const;

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function SettingsPage(): React.JSX.Element {
  const settingsQuery = useUserSettings();
  const updateMutation = useUpdateUserSettings();

  const [matchThreshold, setMatchThreshold] = useState('50');
  const [preferredLocations, setPreferredLocations] = useState('');
  const [targetRoles, setTargetRoles] = useState('');
  const [seniority, setSeniority] = useState('');
  const [categoryTags, setCategoryTags] = useState('');
  const [workMode, setWorkMode] = useState<string[]>([]);
  const [autoSendEmail, setAutoSendEmail] = useState(false);
  const [notifyOnNewJobs, setNotifyOnNewJobs] = useState(true);

  // Seeds the form from the persisted settings once, on first load — after
  // that, "Save settings" is the only thing that pushes changes back out.
  // Adjusted during render rather than in an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const settings = settingsQuery.data;
  const [seeded, setSeeded] = useState(false);
  if (!seeded && settings) {
    setSeeded(true);
    setMatchThreshold(String(settings.match_threshold));
    setPreferredLocations(settings.preferred_locations.join(', '));
    setTargetRoles(settings.target_roles.join(', '));
    setSeniority(settings.seniority ?? '');
    setCategoryTags(settings.category_tags.join(', '));
    setWorkMode(settings.work_mode);
    setAutoSendEmail(settings.auto_send_email);
    setNotifyOnNewJobs(settings.notify_on_new_jobs);
  }

  function toggleWorkMode(mode: string) {
    setWorkMode((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
  }

  function handleSave() {
    updateMutation.mutate({
      match_threshold: Number(matchThreshold),
      preferred_locations: parseCommaSeparated(preferredLocations),
      target_roles: parseCommaSeparated(targetRoles),
      seniority: seniority || undefined,
      category_tags: parseCommaSeparated(categoryTags),
      work_mode: workMode,
      auto_send_email: autoSendEmail,
      notify_on_new_jobs: notifyOnNewJobs,
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-12">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Controls how jobs are matched and surfaced on your Discover feed.
        </p>
      </div>

      {settingsQuery.isLoading && <p className="text-muted-foreground">Loading settings...</p>}
      {settingsQuery.isError && (
        <p className="text-red-600">{(settingsQuery.error as Error).message}</p>
      )}

      {settings && (
        <div className="w-full max-w-2xl space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div>
            <Label htmlFor="match-threshold">Match threshold (0–100)</Label>
            <Input
              id="match-threshold"
              type="number"
              min={0}
              max={100}
              value={matchThreshold}
              onChange={(e) => setMatchThreshold(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Jobs scoring below this are treated as a gap report instead of a resume draft.
            </p>
          </div>

          <div>
            <Label htmlFor="preferred-locations">Preferred locations</Label>
            <Input
              id="preferred-locations"
              value={preferredLocations}
              onChange={(e) => setPreferredLocations(e.target.value)}
              placeholder="e.g. Berlin, Remote"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="target-roles">Target roles</Label>
            <Input
              id="target-roles"
              value={targetRoles}
              onChange={(e) => setTargetRoles(e.target.value)}
              placeholder="e.g. Backend Engineer, Platform Engineer"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="seniority">Seniority</Label>
            <select
              id="seniority"
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Any</option>
              {SENIORITY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="category-tags">Category / field</Label>
            <Input
              id="category-tags"
              value={categoryTags}
              onChange={(e) => setCategoryTags(e.target.value)}
              placeholder="e.g. backend, data"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Work mode</Label>
            <div className="mt-1 flex flex-wrap gap-3 pt-1.5">
              {WORK_MODES.map((mode) => (
                <label key={mode} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={workMode.includes(mode)}
                    onChange={() => toggleWorkMode(mode)}
                    className="h-4 w-4 rounded border-input"
                  />
                  {mode}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto-send-email">Auto-send email</Label>
              <p className="text-xs text-muted-foreground">Not yet wired to actually send anything.</p>
            </div>
            <Switch
              id="auto-send-email"
              checked={autoSendEmail}
              onCheckedChange={setAutoSendEmail}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="notify-new-jobs">Notify on new jobs</Label>
            <Switch
              id="notify-new-jobs"
              checked={notifyOnNewJobs}
              onCheckedChange={setNotifyOnNewJobs}
            />
          </div>

          <div>
            <Label htmlFor="resume-template">Resume template</Label>
            <select
              id="resume-template"
              disabled
              value={settings.resume_template}
              className="mt-1 h-8 w-full rounded-lg border border-input bg-muted px-2.5 text-sm text-muted-foreground"
              onChange={() => {}}
            >
              <option value={settings.resume_template}>{settings.resume_template}</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Coming soon — currently hardcoded.</p>
          </div>

          <div>
            <Label htmlFor="ai-provider-override">AI provider override</Label>
            <Input
              id="ai-provider-override"
              disabled
              value={settings.ai_provider_override ?? ''}
              placeholder="Not configurable yet"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Coming soon — the LLM layer doesn&apos;t support a per-user override yet.
            </p>
          </div>

          {updateMutation.isError && (
            <p className="text-sm text-red-600">{(updateMutation.error as Error).message}</p>
          )}
          {updateMutation.isSuccess && (
            <p className="text-sm text-emerald-600">Settings saved.</p>
          )}

          <div className="flex justify-end">
            <Button type="button" onClick={handleSave} disabled={updateMutation.isPending}>
              Save settings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
