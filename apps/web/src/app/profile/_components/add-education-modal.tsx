'use client';

import { useState, type FormEvent } from 'react';
import type { MasterDB } from '@resumiq/schemas';
import { Button } from '@/components/ui/button';
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

/** Matches `MasterDBSchema.education`'s element shape (`EducationEntrySchema`). */
export type NewEducation = MasterDB['education'][number];

const EMPTY_EDUCATION: NewEducation = {
  institution: '',
  degree_type: '',
  major: '',
  minor: '',
  location: '',
  startDate: '',
  endDate: '',
  gpa: '',
  honors: [],
  relevant_coursework: [],
  thesis_or_capstone: '',
  extracurriculars: [],
  description: '',
};

interface AddEducationModalProps {
  /** Commits the entered degree — used both to append a new entry (add
   * mode) and to replace an existing one in place (edit mode, see `entry`). */
  onAdd: (education: NewEducation) => Promise<void>;
  submitting?: boolean;
  /** When provided, the modal opens pre-filled for editing this entry
   * instead of creating a new one. */
  // Partial rather than required: the onboarding-review flow passes
  // possibly-incomplete AI-extracted drafts (see IngestDraftEntryDto) whose
  // missing fields still need an editable input (resetForm falls back
  // per-field to '').
  entry?: Partial<NewEducation>;
  /** Renders a destructive "Delete" action in the footer — only relevant
   * (and only passed) in edit mode. */
  onDelete?: () => Promise<void>;
}

export function AddEducationModal({
  onAdd,
  submitting,
  entry,
  onDelete,
}: AddEducationModalProps): React.JSX.Element {
  const isEdit = entry !== undefined;
  const [open, setOpen] = useState(false);
  const [institution, setInstitution] = useState(entry?.institution ?? '');
  const [degreeType, setDegreeType] = useState(entry?.degree_type ?? '');
  const [major, setMajor] = useState(entry?.major ?? '');
  const [minor, setMinor] = useState(entry?.minor ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
  const [startDate, setStartDate] = useState(entry?.startDate ?? '');
  const [endDate, setEndDate] = useState(entry?.endDate ?? '');
  const [gpa, setGpa] = useState(entry?.gpa ?? '');
  const [honors, setHonors] = useState(joinLines(entry?.honors ?? []));
  const [relevantCoursework, setRelevantCoursework] = useState(joinLines(entry?.relevant_coursework ?? []));
  const [thesisOrCapstone, setThesisOrCapstone] = useState(entry?.thesis_or_capstone ?? '');
  const [extracurriculars, setExtracurriculars] = useState(joinLines(entry?.extracurriculars ?? []));
  const [description, setDescription] = useState(entry?.description ?? '');
  const [submitError, setSubmitError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    // `entry` may be an incomplete onboarding-review draft with missing
    // fields (see IngestDraftEntryDto) — fall back per-field, not just at
    // the object level, so every input still renders (controlled) even when
    // the AI extraction didn't populate that field.
    const base = entry ?? EMPTY_EDUCATION;
    setInstitution(base.institution ?? '');
    setDegreeType(base.degree_type ?? '');
    setMajor(base.major ?? '');
    setMinor(base.minor ?? '');
    setLocation(base.location ?? '');
    setStartDate(base.startDate ?? '');
    setEndDate(base.endDate ?? '');
    setGpa(base.gpa ?? '');
    setHonors(joinLines(base.honors ?? []));
    setRelevantCoursework(joinLines(base.relevant_coursework ?? []));
    setThesisOrCapstone(base.thesis_or_capstone ?? '');
    setExtracurriculars(joinLines(base.extracurriculars ?? []));
    setDescription(base.description ?? '');
    setSubmitError('');
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!institution.trim() || !degreeType.trim() || !major.trim()) return;

    const validationError =
      validateFieldLength(institution, 'Institution', { required: true, max: 200 }) ||
      validateFieldLength(degreeType, 'Degree type', { required: true, max: 100 }) ||
      validateFieldLength(major, 'Major', { required: true, max: 200 }) ||
      validateFieldLength(minor, 'Minor', { max: 200 }) ||
      validateFieldLength(location, 'Location', { max: 200 }) ||
      validateFieldLength(startDate, 'Start date', { max: 50 }) ||
      validateFieldLength(endDate, 'End date', { max: 50 }) ||
      validateFieldLength(gpa, 'GPA', { max: 20 }) ||
      validateFieldLength(thesisOrCapstone, 'Thesis / capstone', { max: 500 }) ||
      validateFieldLength(description, 'Description', { max: 5000 });
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitError('');
    try {
      await onAdd({
        institution: institution.trim(),
        degree_type: degreeType.trim(),
        major: major.trim(),
        minor: minor.trim(),
        location: location.trim(),
        startDate: startDate.trim(),
        endDate: endDate.trim(),
        gpa: gpa.trim(),
        honors: parseLines(honors),
        relevant_coursework: parseLines(relevantCoursework),
        thesis_or_capstone: thesisOrCapstone.trim(),
        extracurriculars: parseLines(extracurriculars),
        description: description.trim(),
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
        {isEdit ? 'Edit' : '+ Add education'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit education' : 'Add education'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="education-institution">
              Institution <span className="text-red-500">*</span>
            </Label>
            <Input
              id="education-institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="education-degree-type">
                Degree type <span className="text-red-500">*</span>
              </Label>
              <Input
                id="education-degree-type"
                value={degreeType}
                onChange={(e) => setDegreeType(e.target.value)}
                placeholder="e.g. Bachelor's"
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="education-major">
                Major <span className="text-red-500">*</span>
              </Label>
              <Input
                id="education-major"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                className="mt-1"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="education-minor">Minor</Label>
              <Input
                id="education-minor"
                value={minor}
                onChange={(e) => setMinor(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="education-location">Location</Label>
              <Input
                id="education-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="education-start-date">Start date</Label>
              <Input
                id="education-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="e.g. 2018-09"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="education-end-date">End date</Label>
              <Input
                id="education-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="e.g. 2022-06"
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="education-gpa">GPA</Label>
            <Input
              id="education-gpa"
              value={gpa}
              onChange={(e) => setGpa(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="education-honors">Honors</Label>
            <Textarea
              id="education-honors"
              value={honors}
              onChange={(e) => setHonors(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="education-coursework">Relevant coursework</Label>
            <Textarea
              id="education-coursework"
              value={relevantCoursework}
              onChange={(e) => setRelevantCoursework(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="education-extracurriculars">Extracurriculars</Label>
            <Textarea
              id="education-extracurriculars"
              value={extracurriculars}
              onChange={(e) => setExtracurriculars(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="education-thesis">Thesis / capstone</Label>
            <Input
              id="education-thesis"
              value={thesisOrCapstone}
              onChange={(e) => setThesisOrCapstone(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="education-description">Description</Label>
            <Textarea
              id="education-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
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
            <Button
              type="submit"
              disabled={!institution.trim() || !degreeType.trim() || !major.trim() || submitting || deleting}
            >
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Adding...'
                : isEdit
                  ? 'Save changes'
                  : 'Add education'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
