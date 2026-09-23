'use client';

import { useState, type FormEvent } from 'react';
import type { MasterDB } from '@resumiq/schemas';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { validateFieldLength } from './field-validation';
import { joinLines, parseLines } from './list-fields';

/** Matches `MasterDBSchema.experience`'s element shape (`ExperienceEntrySchema`). */
export type NewExperience = MasterDB['experience'][number];

const EMPTY_EXPERIENCE: NewExperience = {
  company: '',
  company_industry: '',
  role: '',
  location: '',
  location_type: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  core_competencies: [],
  technologies_used: [],
  raw_achievements: [],
  quantifiable_metrics: [],
};

interface AddExperienceModalProps {
  /** Commits the entered role — used both to append a new entry (add mode)
   * and to replace an existing one in place (edit mode, see `entry`). */
  onAdd: (experience: NewExperience) => Promise<void>;
  submitting?: boolean;
  /** When provided, the modal opens pre-filled for editing this entry
   * instead of creating a new one. */
  // Partial rather than required: the onboarding-review flow passes
  // possibly-incomplete AI-extracted drafts (see IngestDraftEntryDto) whose
  // missing fields still need an editable input (resetForm falls back
  // per-field to '').
  entry?: Partial<NewExperience>;
  /** Renders a destructive "Delete" action in the footer — only relevant
   * (and only passed) in edit mode. */
  onDelete?: () => Promise<void>;
}

export function AddExperienceModal({
  onAdd,
  submitting,
  entry,
  onDelete,
}: AddExperienceModalProps): React.JSX.Element {
  const isEdit = entry !== undefined;
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(entry?.company ?? '');
  const [companyIndustry, setCompanyIndustry] = useState(entry?.company_industry ?? '');
  const [role, setRole] = useState(entry?.role ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
  const [locationType, setLocationType] = useState(entry?.location_type ?? '');
  const [startDate, setStartDate] = useState(entry?.startDate ?? '');
  const [endDate, setEndDate] = useState(entry?.endDate ?? '');
  const [isCurrent, setIsCurrent] = useState(entry?.isCurrent ?? false);
  const [coreCompetencies, setCoreCompetencies] = useState(joinLines(entry?.core_competencies ?? []));
  const [technologiesUsed, setTechnologiesUsed] = useState(joinLines(entry?.technologies_used ?? []));
  const [rawAchievements, setRawAchievements] = useState(joinLines(entry?.raw_achievements ?? []));
  const [quantifiableMetrics, setQuantifiableMetrics] = useState(joinLines(entry?.quantifiable_metrics ?? []));
  const [submitError, setSubmitError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    // `entry` may be an incomplete onboarding-review draft with missing
    // fields (see IngestDraftEntryDto) — fall back per-field, not just at
    // the object level, so every input still renders (controlled) even when
    // the AI extraction didn't populate that field.
    const base = entry ?? EMPTY_EXPERIENCE;
    setCompany(base.company ?? '');
    setCompanyIndustry(base.company_industry ?? '');
    setRole(base.role ?? '');
    setLocation(base.location ?? '');
    setLocationType(base.location_type ?? '');
    setStartDate(base.startDate ?? '');
    setEndDate(base.endDate ?? '');
    setIsCurrent(base.isCurrent ?? false);
    setCoreCompetencies(joinLines(base.core_competencies ?? []));
    setTechnologiesUsed(joinLines(base.technologies_used ?? []));
    setRawAchievements(joinLines(base.raw_achievements ?? []));
    setQuantifiableMetrics(joinLines(base.quantifiable_metrics ?? []));
    setSubmitError('');
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!company.trim() || !role.trim()) return;

    const validationError =
      validateFieldLength(company, 'Company', { required: true, max: 200 }) ||
      validateFieldLength(role, 'Role', { required: true, max: 200 }) ||
      validateFieldLength(companyIndustry, 'Industry', { max: 200 }) ||
      validateFieldLength(location, 'Location', { max: 200 }) ||
      validateFieldLength(locationType, 'Location type', { max: 100 }) ||
      validateFieldLength(startDate, 'Start date', { max: 50 }) ||
      validateFieldLength(endDate, 'End date', { max: 50 });
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitError('');
    try {
      await onAdd({
        company: company.trim(),
        company_industry: companyIndustry.trim(),
        role: role.trim(),
        location: location.trim(),
        location_type: locationType.trim(),
        startDate: startDate.trim(),
        endDate: isCurrent ? '' : endDate.trim(),
        isCurrent,
        core_competencies: parseLines(coreCompetencies),
        technologies_used: parseLines(technologiesUsed),
        raw_achievements: parseLines(rawAchievements),
        quantifiable_metrics: parseLines(quantifiableMetrics),
      });
      if (!isEdit) resetForm();
      setOpen(false);
    } catch (err) {
      setSubmitError((err as Error).message);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setSubmitError('');
    try {
      await onDelete();
      setOpen(false);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        disabled={submitting}
        render={<Button type="button" size="sm" variant={isEdit ? 'outline' : 'default'} />}
      >
        {isEdit ? 'Edit' : '+ Add experience'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit experience' : 'Add experience'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="experience-company">
              Company <span className="text-red-500">*</span>
            </Label>
            <Input
              id="experience-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="experience-role">
              Role <span className="text-red-500">*</span>
            </Label>
            <Input
              id="experience-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="experience-industry">Industry</Label>
            <Input
              id="experience-industry"
              value={companyIndustry}
              onChange={(e) => setCompanyIndustry(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="experience-location">Location</Label>
              <Input
                id="experience-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="experience-location-type">Location type</Label>
              <Input
                id="experience-location-type"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value)}
                placeholder="e.g. Remote, Hybrid"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="experience-start-date">Start date</Label>
              <Input
                id="experience-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="e.g. 2022-01"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="experience-end-date">End date</Label>
              <Input
                id="experience-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="e.g. 2024-06"
                className="mt-1"
                disabled={isCurrent}
              />
            </div>
          </div>
          <Label htmlFor="experience-is-current" className="font-normal">
            <Checkbox
              id="experience-is-current"
              checked={isCurrent}
              onCheckedChange={(checked) => setIsCurrent(checked === true)}
            />
            I currently work here
          </Label>
          <div>
            <Label htmlFor="experience-technologies">Technologies used</Label>
            <Textarea
              id="experience-technologies"
              value={technologiesUsed}
              onChange={(e) => setTechnologiesUsed(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="experience-competencies">Core competencies</Label>
            <Textarea
              id="experience-competencies"
              value={coreCompetencies}
              onChange={(e) => setCoreCompetencies(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="experience-achievements">Key achievements</Label>
            <Textarea
              id="experience-achievements"
              value={rawAchievements}
              onChange={(e) => setRawAchievements(e.target.value)}
              placeholder="One per line"
              rows={3}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="experience-metrics">Quantifiable metrics</Label>
            <Textarea
              id="experience-metrics"
              value={quantifiableMetrics}
              onChange={(e) => setQuantifiableMetrics(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <DialogFooter>
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="destructive"
                disabled={submitting || deleting}
                onClick={handleDelete}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
            <Button type="submit" disabled={!company.trim() || !role.trim() || submitting || deleting}>
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Adding...'
                : isEdit
                  ? 'Save changes'
                  : 'Add experience'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
