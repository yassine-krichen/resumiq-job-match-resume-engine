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

/** Matches `MasterDBSchema.awards_and_honors`'s element shape — `issuer`
 * isn't collected by this form (not one of the fields the plan calls for),
 * so it's always submitted as an empty string. */
export interface NewAchievement {
  title: string;
  issuer: string;
  date: string;
  description: string;
  related_skills: string[];
}

interface AddAchievementModalProps {
  onAdd: (achievement: NewAchievement) => Promise<void>;
  submitting?: boolean;
}

export function AddAchievementModal({
  onAdd,
  submitting,
}: AddAchievementModalProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [relatedSkills, setRelatedSkills] = useState('');
  const [submitError, setSubmitError] = useState('');

  function resetForm() {
    setTitle('');
    setDate('');
    setDescription('');
    setRelatedSkills('');
    setSubmitError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitError('');
    try {
      // Keep the dialog open with the entered data intact until the save
      // actually succeeds — closing/resetting eagerly would silently
      // discard everything the user typed if the PATCH fails.
      await onAdd({
        title: title.trim(),
        issuer: '',
        date: date.trim(),
        description: description.trim(),
        related_skills: relatedSkills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      resetForm();
      setOpen(false);
    } catch (err) {
      setSubmitError((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" />
        }
      >
        + Add achievement
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add achievement</DialogTitle>
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
            <Button type="submit" disabled={!title.trim() || submitting}>
              {submitting ? 'Adding...' : 'Add achievement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
