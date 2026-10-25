import { readFileSync, writeFileSync } from 'fs';

import { SENTINELS, TempInventory, tempInventory, validInventory } from '../test-support/fixture';

import { createInventoryStore } from './inventory-store';

describe('createInventoryStore', () => {
  let file: TempInventory | undefined;

  afterEach(() => {
    file?.cleanup();
    file = undefined;
  });

  it('strips a UTF-8 BOM before parsing', () => {
    file = tempInventory(validInventory(), { bom: true });

    const result = createInventoryStore(file.path).load();

    expect(result.ok).toBe(true);
  });

  it('never exposes personal_info in the loaded view', () => {
    file = tempInventory();

    const result = createInventoryStore(file.path).load();

    expect(result.ok && JSON.stringify(result.snapshot.view)).not.toContain(SENTINELS.email);
  });

  it('reports a schema failure without a stack trace or file path', () => {
    file = tempInventory({ ...validInventory(), experience: 'not a list' });

    const result = createInventoryStore(file.path).load();

    expect(result.ok).toBe(false);
    const error = result.ok ? '' : result.error;
    expect(error).toContain('experience');
    expect(error).not.toMatch(/\n\s+at /);
    expect(error).not.toContain(file.dir);
  });

  it('reports invalid JSON with a fixed message that does not quote file content', () => {
    file = tempInventory();
    writeFileSync(file.path, `{"secret": "${SENTINELS.key}" oops`, 'utf-8');

    const result = createInventoryStore(file.path).load();

    expect(result).toEqual({ ok: false, error: 'Inventory file is not valid JSON' });
  });

  it('reports a missing file without revealing its path', () => {
    file = tempInventory();
    const missing = `${file.dir}/nope.json`;

    const result = createInventoryStore(missing).load();

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).not.toContain(file.dir);
  });

  it('still serves a file that fails strict validation and lists the issues', () => {
    const data = validInventory();
    delete (data.projects as Record<string, unknown>[])[0].startDate;
    file = tempInventory(data);

    const result = createInventoryStore(file.path).load();

    expect(result.ok && result.snapshot.schemaIssues).toEqual([{ path: 'projects[0].startDate', message: 'missing' }]);
    expect(result.ok && result.snapshot.view.projects).toHaveLength(4);
  });

  it('serves the cached snapshot until the file mtime changes, then reloads', () => {
    file = tempInventory();
    let reads = 0;
    const store = createInventoryStore(file.path, {
      readFile: (p) => {
        reads += 1;
        return readFileSync(p, 'utf-8');
      },
    });

    const first = store.load();
    store.load();
    expect(reads).toBe(1);

    const changed = validInventory();
    (changed.summaries as Record<string, unknown>[])[0].target_role = 'Platform Engineer';
    file.write(changed);
    file.touch(60);
    const reloaded = store.load();

    expect(reads).toBe(2);
    expect(first.ok && first.snapshot.view.summary[0].target_role).toBe('Backend Engineer');
    expect(reloaded.ok && reloaded.snapshot.view.summary[0].target_role).toBe('Platform Engineer');
  });
});
