'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { getApplications } from './_components/api';
import { ApplicationsTable } from './_components/applications-table';
import { FiltersBar } from './_components/filters-bar';
import type { ApplicationsFilters } from './_components/types';

const APPLICATIONS_PAGE_SIZE = 20;

export default function ApplicationsPage(): React.JSX.Element {
  const [filters, setFilters] = useState<ApplicationsFilters>({});
  const [page, setPage] = useState(1);

  const applicationsQuery = useQuery({
    queryKey: ['applications', filters, page] as const,
    queryFn: () => getApplications(filters, page),
    placeholderData: keepPreviousData,
  });

  function handleFiltersChange(next: ApplicationsFilters) {
    setFilters(next);
    setPage(1);
  }

  const total = applicationsQuery.data?.total ?? 0;
  const pageSize = applicationsQuery.data?.pageSize ?? APPLICATIONS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-12">
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="mt-1 text-muted-foreground">Every application you&apos;ve drafted, filterable by status, company, date, and match score.</p>
      </div>

      <FiltersBar filters={filters} onChange={handleFiltersChange} />

      {applicationsQuery.isLoading && <p className="text-muted-foreground">Loading applications...</p>}
      {applicationsQuery.isError && (
        <p className="text-red-600">{(applicationsQuery.error as Error).message}</p>
      )}

      {applicationsQuery.data && (
        <>
          <div
            className={applicationsQuery.isPlaceholderData ? 'w-full max-w-5xl opacity-50 transition-opacity' : 'w-full max-w-5xl transition-opacity'}
          >
            <ApplicationsTable items={applicationsQuery.data.items} />
          </div>

          <div className="flex w-full max-w-5xl items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {applicationsQuery.data.page} of {totalPages} ({total} total)
              {applicationsQuery.isPlaceholderData && ' · Updating...'}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
