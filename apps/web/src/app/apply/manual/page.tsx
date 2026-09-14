import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ApplyManualFlow } from './_components/apply-manual-flow';

export default function ApplyManualPage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Paste a job" />
      <div className="flex flex-col items-center px-4 py-12">
        <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
          <ApplyManualFlow />
        </Suspense>
      </div>
    </div>
  );
}
