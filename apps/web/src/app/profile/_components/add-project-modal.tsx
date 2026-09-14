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

/** Matches `MasterDBSchema.projects`'s element shape (`ProjectEntrySchema`).
 * `links` isn't collected by this form (no dedicated UI for a list of
 * type/url pairs yet — same judgment call as `AddAchievementModal` omitting
 * `issuer`), so it's always submitted as `[]` on add and left untouched
 * (preserved from `entry`) on edit. */
export type NewProject = MasterDB['projects'][number];

const EMPTY_PROJECT: NewProject = {
  name: '',
  context: '',
  links: [],
  startDate: '',
  endDate: '',
  technologies_used: [],
  raw_achievements: [],
  quantifiable_metrics: [],
};

interface AddProjectModalProps {
  /** Commits the entered project — used both to append a new entry (add
   * mode) and to replace an existing one in place (edit mode, see `entry`). */
  onAdd: (project: NewProject) => Promise<void>;
  submitting?: boolean;
  /** When provided, the modal opens pre-filled for editing this entry
   * instead of creating a new one. */
  entry?: NewProject;
  /** Renders a destructive "Delete" action in the footer — only relevant
   * (and only passed) in edit mode. */
  onDelete?: () => Promise<void>;
}

export function AddProjectModal({
  onAdd,
  submitting,
  entry,
  onDelete,
}: AddProjectModalProps): React.JSX.Element {
  const isEdit = entry !== undefined;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry?.name ?? '');
  const [context, setContext] = useState(entry?.context ?? '');
  const [startDate, setStartDate] = useState(entry?.startDate ?? '');
  const [endDate, setEndDate] = useState(entry?.endDate ?? '');
  const [technologiesUsed, setTechnologiesUsed] = useState(joinLines(entry?.technologies_used ?? []));
  const [rawAchievements, setRawAchievements] = useState(joinLines(entry?.raw_achievements ?? []));
  const [quantifiableMetrics, setQuantifiableMetrics] = useState(joinLines(entry?.quantifiable_metrics ?? []));
  const [submitError, setSubmitError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    const base = entry ?? EMPTY_PROJECT;
    setName(base.name);
    setContext(base.context);
    setStartDate(base.startDate);
    setEndDate(base.endDate);
    setTechnologiesUsed(joinLines(base.technologies_used));
    setRawAchievements(joinLines(base.raw_achievements));
    setQuantifiableMetrics(joinLines(base.quantifiable_metrics));
    setSubmitError('');
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const validationError =
      validateFieldLength(name, 'Name', { required: true, max: 200 }) ||
      validateFieldLength(context, 'Context', { max: 2000 }) ||
      validateFieldLength(startDate, 'Start date', { max: 50 }) ||
      validateFieldLength(endDate, 'End date', { max: 50 });
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitError('');
    try {
      await onAdd({
        name: name.trim(),
        context: context.trim(),
        links: entry?.links ?? [],
        startDate: startDate.trim(),
        endDate: endDate.trim(),
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
        {isEdit ? 'Edit' : '+ Add project'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit project' : 'Add project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="project-name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="project-context">Context</Label>
            <Textarea
              id="project-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="project-start-date">Start date</Label>
              <Input
                id="project-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="e.g. 2023-01"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="project-end-date">End date</Label>
              <Input
                id="project-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="e.g. 2023-06"
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="project-technologies">Technologies used</Label>
            <Textarea
              id="project-technologies"
              value={technologiesUsed}
              onChange={(e) => setTechnologiesUsed(e.target.value)}
              placeholder="One per line"
              rows={2}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="project-achievements">Key achievements</Label>
            <Textarea
              id="project-achievements"
              value={rawAchievements}
              onChange={(e) => setRawAchievements(e.target.value)}
              placeholder="One per line"
              rows={3}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="project-metrics">Quantifiable metrics</Label>
            <Textarea
              id="project-metrics"
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
            <Button type="submit" disabled={!name.trim() || submitting || deleting}>
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Adding...'
                : isEdit
                  ? 'Save changes'
                  : 'Add project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
