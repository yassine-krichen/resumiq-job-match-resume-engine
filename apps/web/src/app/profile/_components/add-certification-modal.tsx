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

/** Matches `MasterDBSchema.certifications`'s element shape (`CertificationSchema`).
 * `expiration_date`/`credential_id`/`link`/`description` all `.default('')`
 * server-side (frequently absent from raw-text extraction), so this form
 * treats them as optional too. */
export type NewCertification = MasterDB['certifications'][number];

const EMPTY_CERTIFICATION: NewCertification = {
  name: '',
  issuer: '',
  date: '',
  expiration_date: '',
  credential_id: '',
  link: '',
  description: '',
};

interface AddCertificationModalProps {
  /** Commits the entered certification — used both to append a new entry
   * (add mode) and to replace an existing one in place (edit mode, see
   * `entry`). */
  onAdd: (certification: NewCertification) => Promise<void>;
  submitting?: boolean;
  /** When provided, the modal opens pre-filled for editing this entry
   * instead of creating a new one. */
  entry?: NewCertification;
  /** Renders a destructive "Delete" action in the footer — only relevant
   * (and only passed) in edit mode. */
  onDelete?: () => Promise<void>;
}

export function AddCertificationModal({
  onAdd,
  submitting,
  entry,
  onDelete,
}: AddCertificationModalProps): React.JSX.Element {
  const isEdit = entry !== undefined;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry?.name ?? '');
  const [issuer, setIssuer] = useState(entry?.issuer ?? '');
  const [date, setDate] = useState(entry?.date ?? '');
  const [expirationDate, setExpirationDate] = useState(entry?.expiration_date ?? '');
  const [credentialId, setCredentialId] = useState(entry?.credential_id ?? '');
  const [link, setLink] = useState(entry?.link ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [submitError, setSubmitError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function resetForm() {
    const base = entry ?? EMPTY_CERTIFICATION;
    setName(base.name);
    setIssuer(base.issuer);
    setDate(base.date);
    setExpirationDate(base.expiration_date);
    setCredentialId(base.credential_id);
    setLink(base.link);
    setDescription(base.description);
    setSubmitError('');
  }

  function handleOpenChange(next: boolean) {
    if (next) resetForm();
    setOpen(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !issuer.trim()) return;

    const validationError =
      validateFieldLength(name, 'Name', { required: true, max: 200 }) ||
      validateFieldLength(issuer, 'Issuer', { required: true, max: 200 }) ||
      validateFieldLength(date, 'Date', { max: 50 }) ||
      validateFieldLength(expirationDate, 'Expiration date', { max: 50 }) ||
      validateFieldLength(credentialId, 'Credential ID', { max: 200 }) ||
      validateFieldLength(link, 'Link', { max: 2000 }) ||
      validateFieldLength(description, 'Description', { max: 5000 });
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitError('');
    try {
      await onAdd({
        name: name.trim(),
        issuer: issuer.trim(),
        date: date.trim(),
        expiration_date: expirationDate.trim(),
        credential_id: credentialId.trim(),
        link: link.trim(),
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
        {isEdit ? 'Edit' : '+ Add certification'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit certification' : 'Add certification'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="certification-name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="certification-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="certification-issuer">
              Issuer <span className="text-red-500">*</span>
            </Label>
            <Input
              id="certification-issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="certification-date">Date</Label>
              <Input
                id="certification-date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="e.g. 2023-05"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="certification-expiration">Expiration date</Label>
              <Input
                id="certification-expiration"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="certification-credential-id">Credential ID</Label>
            <Input
              id="certification-credential-id"
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="certification-link">Link</Label>
            <Input
              id="certification-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="certification-description">Description</Label>
            <Textarea
              id="certification-description"
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
            <Button type="submit" disabled={!name.trim() || !issuer.trim() || submitting || deleting}>
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Adding...'
                : isEdit
                  ? 'Save changes'
                  : 'Add certification'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
