import { join } from 'node:path';

import { outreachPaths } from '../config/paths';

import { isSnapshotDir } from './run-layout';

const paths = outreachPaths(join(process.cwd(), 'outreach-root'));
const ok = join(paths.runsDir, 'run-1', 'companies', 'acme-fr-7daf4d', 'snapshots');

describe('isSnapshotDir', () => {
  it('accepts exactly runs/<run>/companies/<slug>/snapshots', () => {
    expect(isSnapshotDir(paths, ok)).toBe(true);
    expect(isSnapshotDir(paths, `${ok}/`)).toBe(true);
  });

  it('accepts the sourcing snapshots folder runs/<run>/sourcing/snapshots', () => {
    expect(isSnapshotDir(paths, join(paths.runsDir, 'run-1', 'sourcing', 'snapshots'))).toBe(true);
  });

  it.each([
    ['the runs folder', () => paths.runsDir],
    ['a run folder', () => join(paths.runsDir, 'run-1')],
    ['a company folder', () => join(paths.runsDir, 'run-1', 'companies', 'acme-fr-7daf4d')],
    ['a deeper folder', () => join(ok, 'sub')],
    ['another leaf', () => join(paths.runsDir, 'run-1', 'companies', 'acme-fr-7daf4d', 'input')],
    ['a traversal out of runs', () => join(paths.runsDir, 'run-1', 'companies', '..', '..', '..', 'src', 'snapshots')],
    ['a folder outside the project', () => join(paths.root, '..', 'elsewhere', 'snapshots')],
    ['a deeper sourcing folder', () => join(paths.runsDir, 'run-1', 'sourcing', 'snapshots', 'sub')],
    ['the sourcing folder itself', () => join(paths.runsDir, 'run-1', 'sourcing')],
    ['the hunter folder', () => join(paths.runsDir, 'run-1', 'sourcing', 'hunter')],
    ['an invalid run id', () => join(paths.runsDir, '.hidden', 'companies', 'acme', 'snapshots')],
  ])('rejects %s', (_name, build) => {
    expect(isSnapshotDir(paths, build())).toBe(false);
  });
});
