'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { confirmApplication, saveEmailDraft } from './api';
import type { EmailDraft } from './types';

interface EmailReviewGateProps {
  applicationId: string;
  draft: EmailDraft;
}

export function EmailReviewGate({
  applicationId,
  draft,
}: EmailReviewGateProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  const saveMutation = useMutation({
    mutationFn: (next: EmailDraft) => saveEmailDraft(applicationId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application', applicationId] }),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmApplication(applicationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['application', applicationId] }),
  });

  function handleSaveDraft() {
    saveMutation.mutate({ subject, body });
  }

  function handleConfirm() {
    saveMutation.mutate(
      { subject, body },
      { onSuccess: () => confirmMutation.mutate() },
    );
  }

  const error = saveMutation.error ?? confirmMutation.error;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Review cold email</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        This is not sent automatically — copy it out and send it yourself once you confirm.
      </p>

      <div className="space-y-4">
        <div>
          <Label htmlFor="email-subject">Subject</Label>
          <Input
            id="email-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="email-body">Body</Label>
          <Textarea
            id="email-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            className="mt-1"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{(error as Error).message}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={handleSaveDraft} disabled={saveMutation.isPending}>
          Save draft
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={saveMutation.isPending || confirmMutation.isPending}
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
