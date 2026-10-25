import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createInventoryStore } from '../inventory/inventory-store';
import { createServer } from '../server';
import { SENTINELS, TempInventory, tempInventory, validInventory } from '../test-support/fixture';

interface TextResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function connect(path: string): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ store: createInventoryStore(path) }).connect(serverSide);
  const client = new Client({ name: 'spec-client', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

/** Runs a tool call and returns its text whether the SDK reports bad input as a result or a protocol error. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  try {
    const result = (await client.callTool({ name, arguments: args })) as TextResult;
    return { isError: result.isError === true, text: result.content.map((c) => c.text).join('\n') };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
}

describe('resumiq MCP tools', () => {
  let file: TempInventory;
  let client: Client;
  const previousEnv = process.env.RESUMIQ_TEST_API_KEY;

  beforeEach(async () => {
    // A planted secret in the environment: no tool output may ever echo it.
    process.env.RESUMIQ_TEST_API_KEY = SENTINELS.key;
    file = tempInventory();
    client = await connect(file.path);
  });

  afterEach(async () => {
    await client.close();
    file.cleanup();
    if (previousEnv === undefined) delete process.env.RESUMIQ_TEST_API_KEY;
    else process.env.RESUMIQ_TEST_API_KEY = previousEnv;
  });

  it('advertises readOnlyHint and a closed world for all three tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['get_entry', 'list_gaps', 'search_profile']);
    for (const tool of tools) {
      expect(tool.annotations).toEqual(expect.objectContaining({ readOnlyHint: true, openWorldHint: false }));
    }
  });

  it('describes list_gaps as an inventory-quality check, not a registry check', async () => {
    const { tools } = await client.listTools();

    const description = tools.find((t) => t.name === 'list_gaps')?.description ?? '';

    expect(description).toMatch(/inventory quality only, not the project registry/);
  });

  it('search_profile returns ranked hits with id, title, snippet, score and sources', async () => {
    const { isError, text } = await call(client, 'search_profile', { query: 'redis', limit: 3 });

    const body = JSON.parse(text);
    expect(isError).toBe(false);
    expect(body.results[0]).toEqual(
      expect.objectContaining({ section: 'projects', id: 'projects:0', title: 'Cache Service', sources: ['git log in Cache Service'] }),
    );
    expect(body.results.length).toBeLessThanOrEqual(3);
  });

  it('search_profile rejects a query over 200 characters and a limit over 25', async () => {
    expect((await call(client, 'search_profile', { query: 'x'.repeat(201) })).isError).toBe(true);
    expect((await call(client, 'search_profile', { query: 'redis', limit: 26 })).isError).toBe(true);
  });

  it('get_entry returns a full entry by index, id and exact case-insensitive name', async () => {
    const byIndex = JSON.parse((await call(client, 'get_entry', { section: 'projects', id: 0 })).text);
    const byId = JSON.parse((await call(client, 'get_entry', { section: 'projects', id: 'projects:0' })).text);
    const byName = JSON.parse((await call(client, 'get_entry', { section: 'projects', id: 'cache SERVICE' })).text);

    expect(byIndex.entry).toEqual(expect.objectContaining({ id: 'projects:0', name: 'Cache Service', technologies_used: ['Redis', 'NestJS'] }));
    expect(byId).toEqual(byIndex);
    expect(byName).toEqual(byIndex);
  });

  it('get_entry returns the candidates for an ambiguous name', async () => {
    const { isError, text } = await call(client, 'get_entry', { section: 'projects', id: 'dup project' });

    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual(
      expect.objectContaining({
        ambiguous: true,
        candidates: [
          { id: 'projects:2', title: 'Dup Project' },
          { id: 'projects:3', title: 'dup project' },
        ],
      }),
    );
  });

  it('get_entry rejects an unknown section, including personal_info', async () => {
    expect((await call(client, 'get_entry', { section: 'personal_info', id: 0 })).isError).toBe(true);
    expect((await call(client, 'get_entry', { section: 'nonsense', id: 0 })).isError).toBe(true);
  });

  it('get_entry reports an unknown name and an out-of-range index as tool errors', async () => {
    expect((await call(client, 'get_entry', { section: 'projects', id: 'No Such Project' })).isError).toBe(true);
    expect((await call(client, 'get_entry', { section: 'projects', id: 99 })).isError).toBe(true);
  });

  it('get_entry strips the certification credential id, including inside its verification link', async () => {
    const { text } = await call(client, 'get_entry', { section: 'certifications', id: 0 });

    expect(JSON.parse(text).entry.name).toBe('Cloud Practitioner');
    expect(JSON.parse(text).entry.link).toBeUndefined();
    expect(text).not.toContain(SENTINELS.credentialId);
  });

  it('list_gaps reports empty raw_achievements with its path', async () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[])[0].raw_achievements = [];
    file.write(data);
    file.touch(60);

    const body = JSON.parse((await call(client, 'list_gaps', {})).text);

    expect(body.gaps).toEqual([expect.objectContaining({ path: 'projects[0].raw_achievements' })]);
  });

  it('list_gaps reports no gaps for a valid fixture', async () => {
    const body = JSON.parse((await call(client, 'list_gaps', {})).text);

    expect(body).toEqual({ total: 0, truncated: false, gaps: [] });
  });

  it('returns a sanitized error, never a path, when the inventory cannot be read', async () => {
    const hidden = `${file.dir}/${SENTINELS.key}/missing.json`;
    const broken = await connect(hidden);

    const { isError, text } = await call(broken, 'search_profile', { query: 'redis' });
    await broken.close();

    expect(isError).toBe(true);
    expect(text).not.toContain(file.dir);
    expect(text).not.toContain(SENTINELS.key);
  });

  it('never puts a planted phone number, email, key or credential id into any tool result', async () => {
    const outputs = [
      await call(client, 'search_profile', { query: 'redis', limit: 25 }),
      await call(client, 'search_profile', { query: `${SENTINELS.email} ${SENTINELS.phone} ${SENTINELS.key}`, limit: 25 }),
      await call(client, 'search_profile', { query: 'sentinel example.com cloud' }),
      await call(client, 'get_entry', { section: 'certifications', id: 0 }),
      await call(client, 'get_entry', { section: 'summary', id: 0 }),
      await call(client, 'get_entry', { section: 'projects', id: 'nope' }),
      await call(client, 'list_gaps', {}),
    ];
    const everything = outputs.map((o) => o.text).join('\n');

    expect(everything).toContain('Cache Service');
    for (const secret of [SENTINELS.phone, SENTINELS.email, SENTINELS.key, SENTINELS.credentialId, SENTINELS.name]) {
      expect(everything).not.toContain(secret);
    }
  });
});
