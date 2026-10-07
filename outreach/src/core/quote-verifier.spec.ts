import type { OutreachClaim } from '../schemas/outreach';

import { claim } from './__fixtures__/outreach-fixtures';
import { isSafeSnapshotId, quoteAppearsInSnapshot, verifyClaims } from './quote-verifier';
import type { SnapshotRecord } from './quote-verifier';

const snapshot = 'Acme Robotics\nToday we are open-sourcing the Acme fleet scheduler.\nIt batches tasks per zone.';

describe('quoteAppearsInSnapshot', () => {
  it('passes on an exact quote', () => {
    expect(quoteAppearsInSnapshot(snapshot, claim.quote)).toBe(true);
  });

  it('passes when case and spacing differ', () => {
    expect(quoteAppearsInSnapshot(snapshot, 'TODAY   we are\nopen-sourcing the acme fleet scheduler.')).toBe(true);
  });

  it('passes when the page uses curly quotes and the quote uses straight ones', () => {
    const page = 'Today we\u2019re shipping \u201Cthe fleet scheduler\u201D to everyone.';

    expect(quoteAppearsInSnapshot(page, 'Today we\'re shipping "the fleet scheduler" to everyone.')).toBe(true);
  });

  it('passes when the quote has curly quotes and the page uses straight ones', () => {
    expect(quoteAppearsInSnapshot('He said "the fleet scheduler" is out', 'said “the fleet scheduler” is')).toBe(true);
  });

  it('passes when the page has non-breaking spaces, en dashes and an ellipsis', () => {
    const page = 'Notre\u00A0planificateur\u202Fest\u00A0open\u00A0source \u2013 pr\u00EAt pour la prod\u2026';

    expect(quoteAppearsInSnapshot(page, 'Notre planificateur est open source - prêt pour la prod...')).toBe(true);
  });

  it('passes on French guillemets against straight double quotes', () => {
    expect(quoteAppearsInSnapshot('Le \u00AB\u00A0Fleet Scheduler\u00A0\u00BB arrive', 'Le "Fleet Scheduler" arrive')).toBe(
      true,
    );
  });

  it('fails when the quote is a paraphrase of the page', () => {
    expect(quoteAppearsInSnapshot(snapshot, 'Acme just released a new fleet scheduler as open source.')).toBe(false);
  });

  it('fails when one word of the quote differs', () => {
    expect(quoteAppearsInSnapshot(snapshot, 'Today we are open-sourcing the Acme fleet planner.')).toBe(false);
  });

  it('fails on an empty quote', () => {
    expect(quoteAppearsInSnapshot(snapshot, '   ')).toBe(false);
  });
});

describe('isSafeSnapshotId', () => {
  it.each(['blog.html', 'page-1_a.txt', 'a1', 'console.txt', 'com10.html'])('accepts %s', (id) => {
    expect(isSafeSnapshotId(id)).toBe(true);
  });

  it.each([
    '../secrets.txt',
    '..',
    'a/../b',
    'sub/dir.html',
    'sub\\dir.html',
    'C:\\Windows\\win.ini',
    '/etc/passwd',
    '.hidden',
    'bad..name',
    '',
    'with space.html',
    'nul\u0000.html',
    'trailing-dot.',
  ])('rejects %j', (id) => {
    expect(isSafeSnapshotId(id)).toBe(false);
  });

  it.each(['CON', 'con.txt', 'PRN.html', 'aux', 'NUL.tar.gz', 'COM1', 'com9.txt', 'LPT1', 'lpt9.log'])(
    'rejects the Windows device name %s',
    (id) => {
      expect(isSafeSnapshotId(id)).toBe(false);
    },
  );
});

describe('verifyClaims', () => {
  const record: SnapshotRecord = { text: snapshot, url: claim.url };
  const good: OutreachClaim = claim;
  const paraphrase: OutreachClaim = { ...claim, id: 'c2', quote: 'Acme released a brand new scheduler for fleets.' };
  const traversal: OutreachClaim = { ...claim, id: 'c3', snapshot_id: '../../.env' };
  const missing: OutreachClaim = { ...claim, id: 'c4', snapshot_id: 'gone.html' };

  it('keeps only claims whose quote is in the cited snapshot and says why the others were dropped', async () => {
    const load = jest.fn((id: string) => (id === good.snapshot_id ? record : null));

    const result = await verifyClaims([good, paraphrase, traversal, missing], load);

    expect(result.verified.map((c) => c.id)).toEqual(['c1']);
    expect(result.rejected.map((r) => [r.claim.id, r.reason])).toEqual([
      ['c2', 'quote_not_found'],
      ['c3', 'unsafe_snapshot_id'],
      ['c4', 'snapshot_missing'],
    ]);
  });

  it('never asks the loader for a path-traversal or device-name snapshot id', async () => {
    const load = jest.fn().mockResolvedValue(record);

    await verifyClaims([traversal, { ...claim, id: 'c5', snapshot_id: 'NUL.txt' }], load);

    expect(load).not.toHaveBeenCalled();
  });

  it('rejects a claim whose snapshot was saved from a different page than the claim URL', async () => {
    const elsewhere: SnapshotRecord = { text: snapshot, url: 'https://other.example/page' };

    const result = await verifyClaims([good], () => elsewhere);

    expect(result.verified).toEqual([]);
    expect(result.rejected[0].reason).toBe('url_mismatch');
  });

  it('compares URLs ignoring scheme, www, fragment, trailing slash and case of the host', async () => {
    const equivalent: SnapshotRecord = {
      text: snapshot,
      url: 'HTTP://WWW.Acme-Robotics.example/blog/fleet-scheduler/#intro',
    };

    const result = await verifyClaims([good], () => equivalent);

    expect(result.verified).toHaveLength(1);
  });

  it('accepts the final URL after a redirect when the snapshot records one', async () => {
    const redirected: SnapshotRecord = { text: snapshot, url: 'https://short.example/x', finalUrl: claim.url };

    const result = await verifyClaims([good], () => redirected);

    expect(result.verified).toHaveLength(1);
  });

  it('does not treat a different query string or path as the same page', async () => {
    const differentPath: SnapshotRecord = { text: snapshot, url: 'https://acme-robotics.example/blog/other' };

    const result = await verifyClaims([good], () => differentPath);

    expect(result.rejected[0].reason).toBe('url_mismatch');
  });
});
