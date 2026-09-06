'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { renderResumePreview, saveResumeSelection } from './api';
import type { ResumeSelection, SectionType } from './types';

const PREVIEW_DEBOUNCE_MS = 800;

const SECTION_LABELS: Partial<Record<SectionType, string>> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  certifications: 'Certifications',
  awards: 'Awards',
  volunteering: 'Volunteering',
  publications: 'Publications',
};

function availableSections(selection: ResumeSelection): SectionType[] {
  const sections: SectionType[] = [];
  if (selection.summary) sections.push('summary');
  if (selection.experience.length > 0) sections.push('experience');
  if (selection.projects.length > 0) sections.push('projects');
  if (Object.values(selection.skills).some((values) => values.length > 0)) sections.push('skills');
  if (selection.certifications.length > 0) sections.push('certifications');
  if (selection.awards.length > 0) sections.push('awards');
  if ((selection.volunteering?.length ?? 0) > 0) sections.push('volunteering');
  if ((selection.publications?.length ?? 0) > 0) sections.push('publications');
  return sections;
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

interface ResumeReviewEditorProps {
  applicationId: string;
  selection: ResumeSelection;
  onFinalize: () => void;
  finalizing: boolean;
  progress: string;
  error: string;
  /** True while a regenerate is in flight for this application — disables
   * Save draft/Confirm & continue so a finalize can't race a regenerate
   * against the same application row. */
  disabled?: boolean;
}

export function ResumeReviewEditor({
  applicationId,
  selection: initialSelection,
  onFinalize,
  finalizing,
  progress,
  error,
  disabled,
}: ResumeReviewEditorProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<ResumeSelection>(initialSelection);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  // Guards against out-of-order responses: only the response whose id still
  // matches the latest fired request is allowed to update preview state.
  const previewRequestIdRef = useRef(0);

  const saveMutation = useMutation({
    mutationFn: (next: ResumeSelection) => saveResumeSelection(applicationId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application', applicationId] }),
  });

  // Debounced live preview: re-renders on every edit, replacing the blob URL
  // from the previous render so the <iframe> always shows the latest draft.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const requestId = ++previewRequestIdRef.current;
      setPreviewLoading(true);
      setPreviewError('');
      renderResumePreview(applicationId, selection)
        .then((result) => {
          // A newer edit already fired another request — ignore this stale response.
          if (previewRequestIdRef.current !== requestId) return;
          const bytes = Uint8Array.from(atob(result.pdf), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = url;
          setPreviewUrl(url);
        })
        .catch((e: Error) => {
          if (previewRequestIdRef.current !== requestId) return;
          setPreviewError(e.message);
        })
        .finally(() => {
          if (previewRequestIdRef.current === requestId) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [applicationId, selection]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const sections = useMemo(() => availableSections(selection), [selection]);
  const enabledOrder = selection.section_order.filter((s) => sections.includes(s));
  const disabledSections = sections.filter((s) => !enabledOrder.includes(s));

  function toggleSection(section: SectionType, on: boolean) {
    setSelection((prev) => ({
      ...prev,
      section_order: on
        ? [...prev.section_order, section]
        : prev.section_order.filter((s) => s !== section),
    }));
  }

  function reorderSection(index: number, direction: -1 | 1) {
    setSelection((prev) => ({ ...prev, section_order: moveItem(prev.section_order, index, direction) }));
  }

  function updateExperienceBullets(expIndex: number, bullets: string[]) {
    setSelection((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) => (i === expIndex ? { ...exp, bullets } : exp)),
    }));
  }

  function updateProjectBullets(projIndex: number, bullets: string[]) {
    setSelection((prev) => ({
      ...prev,
      projects: prev.projects.map((proj, i) => (i === projIndex ? { ...proj, bullets } : proj)),
    }));
  }

  function updateSkillCategory(category: keyof ResumeSelection['skills'], values: string[]) {
    setSelection((prev) => ({ ...prev, skills: { ...prev.skills, [category]: values } }));
  }

  // Finalize builds the tailored resume from the persisted resumeSelection —
  // it never reads the in-memory `selection` state. Any edits made since the
  // last "Save draft" click must be persisted first, or they're silently lost.
  async function handleConfirmAndContinue() {
    try {
      await saveMutation.mutateAsync(selection);
      onFinalize();
    } catch {
      // Save failed — saveMutation.isError renders the message below; stay on this step.
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-3 text-base font-semibold">Sections</h2>
          <ul className="space-y-2">
            {enabledOrder.map((section, i) => (
              <li key={section} className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">{SECTION_LABELS[section] ?? section}</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => reorderSection(selection.section_order.indexOf(section), -1)}
                    aria-label={`Move ${SECTION_LABELS[section] ?? section} section up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === enabledOrder.length - 1}
                    onClick={() => reorderSection(selection.section_order.indexOf(section), 1)}
                    aria-label={`Move ${SECTION_LABELS[section] ?? section} section down`}
                  >
                    <ArrowDown />
                  </Button>
                  <Switch checked onCheckedChange={(on) => toggleSection(section, on)} />
                </div>
              </li>
            ))}
            {disabledSections.map((section) => (
              <li key={section} className="flex items-center justify-between gap-2 opacity-50">
                <span className="text-sm text-foreground">{SECTION_LABELS[section] ?? section}</span>
                <Switch checked={false} onCheckedChange={(on) => toggleSection(section, on)} />
              </li>
            ))}
          </ul>
        </div>

        {sections.includes('summary') && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <Label htmlFor="summary">Summary</Label>
            <Textarea
              id="summary"
              value={selection.summary ?? ''}
              onChange={(e) => setSelection((prev) => ({ ...prev, summary: e.target.value }))}
              rows={4}
              className="mt-1"
            />
          </div>
        )}

        {selection.experience.map((exp, expIndex) => (
          <div key={`${exp.company}-${expIndex}`} className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {exp.role} @ {exp.company}
            </h3>
            <BulletsEditor
              bullets={exp.bullets}
              onChange={(bullets) => updateExperienceBullets(expIndex, bullets)}
            />
          </div>
        ))}

        {selection.projects.map((proj, projIndex) => (
          <div key={`${proj.name}-${projIndex}`} className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{proj.name}</h3>
            <BulletsEditor
              bullets={proj.bullets}
              onChange={(bullets) => updateProjectBullets(projIndex, bullets)}
            />
          </div>
        ))}

        {sections.includes('skills') && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold">Skills</h2>
            <SkillCategoryEditor
              label="Languages"
              values={selection.skills.languages}
              onChange={(values) => updateSkillCategory('languages', values)}
            />
            <SkillCategoryEditor
              label="Frameworks & libraries"
              values={selection.skills.frameworks_and_libraries}
              onChange={(values) => updateSkillCategory('frameworks_and_libraries', values)}
            />
            <SkillCategoryEditor
              label="Infrastructure & tools"
              values={selection.skills.infrastructure_and_tools}
              onChange={(values) => updateSkillCategory('infrastructure_and_tools', values)}
            />
            <SkillCategoryEditor
              label="Databases"
              values={selection.skills.databases}
              onChange={(values) => updateSkillCategory('databases', values)}
            />
          </div>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">{(saveMutation.error as Error).message}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => saveMutation.mutate(selection)}
            disabled={saveMutation.isPending || finalizing || disabled}
          >
            Save draft
          </Button>
          <Button
            type="button"
            onClick={handleConfirmAndContinue}
            disabled={finalizing || saveMutation.isPending || disabled}
          >
            {finalizing ? progress || 'Finalizing...' : 'Confirm & continue'}
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-medium text-foreground">Live preview</p>
            {previewLoading && <p className="text-xs text-muted-foreground">Rendering...</p>}
          </div>
          {previewError && <p className="px-1 text-sm text-red-600">{previewError}</p>}
          {previewUrl ? (
            <iframe src={previewUrl} className="h-[80vh] w-full rounded-lg border border-border" title="Resume preview" />
          ) : (
            <div className="flex h-[80vh] items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
              Preview will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BulletsEditor({
  bullets,
  onChange,
}: {
  bullets: string[];
  onChange: (bullets: string[]) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {bullets.map((bullet, i) => (
        <div key={i} className="flex items-start gap-2">
          <Textarea
            value={bullet}
            onChange={(e) => {
              const next = [...bullets];
              next[i] = e.target.value;
              onChange(next);
            }}
            rows={2}
            className="flex-1"
          />
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={i === 0}
              onClick={() => onChange(moveItem(bullets, i, -1))}
              aria-label="Move bullet up"
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={i === bullets.length - 1}
              onClick={() => onChange(moveItem(bullets, i, 1))}
              aria-label="Move bullet down"
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onChange(bullets.filter((_, bi) => bi !== i))}
              aria-label="Remove bullet"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...bullets, ''])}>
        <Plus /> Add bullet
      </Button>
    </div>
  );
}

function SkillCategoryEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}): React.JSX.Element {
  const [text, setText] = useState(values.join(', '));

  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          onChange(
            text
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
        placeholder="Comma-separated"
        className="mt-1"
      />
    </div>
  );
}
