'use client';

import { useState, type FormEvent } from 'react';
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

/** Matches `MasterDBSchema.awards_and_honors`'s element shape — `issuer`
 * isn't collected by this form (not one of the fields the plan calls for),
 * so add-mode always submits it as an empty string. Edit mode preserves
 * whatever `issuer` the entry already had, rather than silently wiping it. */
export interface NewAchievement {
  title: string;
  issuer: string;
  date: string;
  description: string;
  // Optional to stay structurally compatible with
  // `MasterDB['awards_and_honors'][number]` (`AwardSchema.related_skills`
  // is `.optional()`) so existing profile entries can be passed straight
  // through as `entry` without remapping.
  related_skills?: string[];
}

const EMPTY_ACHIEVEMENT: NewAchievement = {
  title: '',
  issuer: '',
  date: '',
  description: '',
  related_skills: [],
};

interface AddAchievementModalProps {
  /** Commits the entered achievement — used both to append a new entry
   * (add mode) and to replace an existing one in place (edit mode, see
   * `entry`). The caller (profile page) decides which by wiring in either
   * `addEntry` or a curried `updateEntry(index, ...)`. */
  onAdd: (achievement: NewAchievement) => Promise<void>;
  submitting?: boolean;
  /** When provided, the modal opens pre-filled for editing this entry
   * instead of creating a new one. */
  entry?: NewAchievement;
  /** Renders a destructive "Delete" action in the footer — only relevant
   * (and only passed) in edit mode. */
  onDelete?: () => Promise<void>;
}

export function AddAchievementModal({
  onAdd,
  submitting,
  entry,
  onDelete,
}: AddAchievementModalProps): React.JSX.Element {
  const isEdit = entry !== undefined;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [date, setDate] = useState(entry?.date ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [relatedSkills, setRelatedSkills] = useState((entry?.related_skills ?? []).join(', '));
  const [submitError, setSubmitError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    const base = entry ?? EMPTY_ACHIEVEMENT;
    setTitle(base.title);
    setDate(base.date);
    setDescription(base.description);
    setRelatedSkills((base.related_skills ?? []).join(', '));
    setSubmitError('');
  }

  function handleOpenChange(next: boolean) {
    // Re-sync from the (possibly updated) `entry` prop every time the
    // dialog opens, so editing a second time after an earlier save shows
    // the latest saved values rather than stale form state.
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const validationError =
      validateFieldLength(title, 'Title', { required: true, max: 200 }) ||
      validateFieldLength(date, 'Date', { max: 50 }) ||
      validateFieldLength(description, 'Description', { max: 5000 });
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitError('');
    try {
      // Keep the dialog open with the entered data intact until the save
      // actually succeeds — closing/resetting eagerly would silently
      // discard everything the user typed if the PATCH fails.
      await onAdd({
        title: title.trim(),
        issuer: entry?.issuer ?? '',
        date: date.trim(),
        description: description.trim(),
        related_skills: relatedSkills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
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
        render={
          <Button type="button" size="sm" variant={isEdit ? 'outline' : 'default'} />
        }
      >
        {isEdit ? 'Edit' : '+ Add achievement'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit achievement' : 'Add achievement'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="achievement-title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="achievement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Employee of the Year"
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="achievement-date">Date</Label>
            <Input
              id="achievement-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="e.g. 2024-03"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="achievement-description">Description</Label>
            <Textarea
              id="achievement-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="achievement-skills">Related skills</Label>
            <Input
              id="achievement-skills"
              value={relatedSkills}
              onChange={(e) => setRelatedSkills(e.target.value)}
              placeholder="Comma-separated"
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
            <Button type="submit" disabled={!title.trim() || submitting || deleting}>
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Adding...'
                : isEdit
                  ? 'Save changes'
                  : 'Add achievement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
