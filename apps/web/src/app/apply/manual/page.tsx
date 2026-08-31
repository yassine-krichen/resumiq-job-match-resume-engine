import { Suspense } from 'react';
import { ApplyManualFlow } from './_components/apply-manual-flow';

export default function ApplyManualPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading...</p>}>
        <ApplyManualFlow />
      </Suspense>
    </div>
  );
}
