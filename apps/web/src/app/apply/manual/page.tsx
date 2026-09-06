import { Suspense } from 'react';
import { ApplyManualFlow } from './_components/apply-manual-flow';

export default function ApplyManualPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-12">
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <ApplyManualFlow />
      </Suspense>
    </div>
  );
}
