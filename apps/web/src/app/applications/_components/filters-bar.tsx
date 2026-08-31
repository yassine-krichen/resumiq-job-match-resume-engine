'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ApplicationsFilters } from './types';

const STATUSES = ['gap_reported', 'resume_drafted', 'email_drafted', 'ready'] as const;

const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  gap_reported: 'Gap reported',
  resume_drafted: 'Resume drafted',
  email_drafted: 'Email drafted',
  ready: 'Ready',
};

interface FiltersBarProps {
  filters: ApplicationsFilters;
  onChange: (filters: ApplicationsFilters) => void;
}

export function FiltersBar({ filters, onChange }: FiltersBarProps): React.JSX.Element {
  const [status, setStatus] = useState(filters.status ?? '');
  const [company, setCompany] = useState(filters.company ?? '');
  const [dateFrom, setDateFrom] = useState(filters.date_from ?? '');
  const [dateTo, setDateTo] = useState(filters.date_to ?? '');
  const [matchScoreMin, setMatchScoreMin] = useState(filters.match_score_min?.toString() ?? '');
  const [matchScoreMax, setMatchScoreMax] = useState(filters.match_score_max?.toString() ?? '');

  function handleApply() {
    onChange({
      status: status || undefined,
      company: company.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      match_score_min: matchScoreMin ? Number(matchScoreMin) : undefined,
      match_score_max: matchScoreMax ? Number(matchScoreMax) : undefined,
    });
  }

  return (
    <div className="w-full max-w-5xl rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label htmlFor="filter-status">Status</Label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 h-8 w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 text-sm"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-company">Company</Label>
          <Input
            id="filter-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="filter-date-from">From</Label>
          <Input
            id="filter-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="filter-date-to">To</Label>
          <Input
            id="filter-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="filter-match-min">Match score min</Label>
          <Input
            id="filter-match-min"
            type="number"
            min={0}
            max={100}
            value={matchScoreMin}
            onChange={(e) => setMatchScoreMin(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="filter-match-max">Match score max</Label>
          <Input
            id="filter-match-max"
            type="number"
            min={0}
            max={100}
            value={matchScoreMax}
            onChange={(e) => setMatchScoreMax(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={handleApply}>
          Apply filters
        </Button>
      </div>
    </div>
  );
}
