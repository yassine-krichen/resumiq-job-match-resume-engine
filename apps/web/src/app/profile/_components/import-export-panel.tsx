'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { apiFetch } from '@/lib/api';
import type { MasterDB } from '@resumiq/schemas';
import { Button } from '@/components/ui/button';

interface ImportExportPanelProps {
  profile: MasterDB;
  /** Called with the merged profile once an import succeeds, so the page
   * re-renders with what was actually merged in instead of a stale copy. */
  onImported: (profile: MasterDB) => void;
}

// Same Blob-download pattern as `downloadResumeSource` in
// `apps/web/src/app/applications/[id]/page.tsx` — no new download mechanism.
function downloadProfileExport(profile: MasterDB): void {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'career-profile.json';
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportExportPanel({ profile, onImported }: ImportExportPanelProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file re-fires `onChange`.
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setMessage(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }

      const updated = await apiFetch<MasterDB>('/profile/import', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      onImported(updated);
      setMessage({ kind: 'success', text: 'Profile imported and merged successfully.' });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mr-auto">
        <h2 className="text-base font-semibold">Import / export</h2>
        <p className="text-sm text-muted-foreground">
          Download your profile as JSON, or import one — array-based sections (experience,
          education, etc.) are merged with your existing entries; personal info is replaced by
          the imported file&apos;s values.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={() => downloadProfileExport(profile)}>
        Export profile
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? 'Importing...' : 'Import profile'}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />
      {message && (
        <p className={`w-full text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
