#!/usr/bin/env node
/**
 * Retrieval eval for search_profile over the REAL inventory (never run from tests).
 *
 *   RESUMIQ_INVENTORY_PATH=<path to data_inventory.json> node eval/run-eval.js
 *
 * Needs `npm run build` first. Talks to the built server over stdio, like a real
 * MCP client, and prints metrics only; inventory text is never written anywhere.
 */
const { readFileSync, statSync } = require('fs');
const { join } = require('path');
const { performance } = require('perf_hooks');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const REPEATS = 5;
const RANK_DEPTH = 25;
const DEFAULT_LIMIT = 8;

const inventoryPath = process.env.RESUMIQ_INVENTORY_PATH;
if (!inventoryPath) {
  console.error('Set RESUMIQ_INVENTORY_PATH to the inventory JSON to evaluate against.');
  process.exit(1);
}
const { queries } = JSON.parse(readFileSync(join(__dirname, 'queries.json'), 'utf-8'));

// Whitespace is collapsed so a stray double space in an entry name does not read as a miss.
const squash = (text) => text.replace(/\s+/g, ' ').trim();
const isExpected = (hit, expected) => {
  const title = squash(hit.title);
  const name = squash(expected.name);
  return hit.section === expected.section && (title === name || title.endsWith(` at ${name}`));
};

async function search(client, query, limit) {
  const started = performance.now();
  const result = await client.callTool({ name: 'search_profile', arguments: { query, limit } });
  const millis = performance.now() - started;
  const text = result.content[0].text;
  return { millis, bytes: Buffer.byteLength(text, 'utf-8'), body: JSON.parse(text) };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, '..', 'dist', 'main.js')],
    env: { ...process.env, RESUMIQ_INVENTORY_PATH: inventoryPath },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'resumiq-eval', version: '0.0.0' });
  await client.connect(transport);

  await search(client, 'warm up', DEFAULT_LIMIT); // first call pays the file read and index build

  const rows = [];
  for (const q of queries) {
    const deep = await search(client, q.query, RANK_DEPTH);
    const top5 = deep.body.results.slice(0, 5);
    const found = q.expected.filter((e) => top5.some((h) => isExpected(h, e)));
    const firstRank = deep.body.results.findIndex((h) => q.expected.some((e) => isExpected(h, e))) + 1;

    const timings = [];
    let defaultBytes = 0;
    for (let i = 0; i < REPEATS; i += 1) {
      const run = await search(client, q.query, DEFAULT_LIMIT);
      timings.push(run.millis);
      defaultBytes = run.bytes;
    }
    const five = await search(client, q.query, 5);

    rows.push({
      id: q.id,
      query: q.query,
      expected: q.expected.length,
      foundAt5: found.length,
      recallAt5: found.length / q.expected.length,
      firstRank: firstRank || null,
      reciprocalRank: firstRank ? 1 / firstRank : 0,
      latencyMs: mean(timings),
      bytesLimit8: defaultBytes,
      bytesLimit5: five.bytes,
      missed: q.expected.filter((e) => !top5.some((h) => isExpected(h, e))).map((e) => e.name),
    });
  }
  await client.close();

  const fileBytes = statSync(inventoryPath).size;
  const summary = {
    queries: rows.length,
    inventoryBytes: fileBytes,
    recallAt5: mean(rows.map((r) => r.recallAt5)),
    mrr: mean(rows.map((r) => r.reciprocalRank)),
    hitAt1: rows.filter((r) => r.firstRank === 1).length / rows.length,
    queriesWithNoExpectedInTop5: rows.filter((r) => r.foundAt5 === 0).length,
    meanLatencyMs: mean(rows.map((r) => r.latencyMs)),
    maxLatencyMs: Math.max(...rows.map((r) => r.latencyMs)),
    meanBytesLimit8: mean(rows.map((r) => r.bytesLimit8)),
    meanBytesLimit5: mean(rows.map((r) => r.bytesLimit5)),
  };
  summary.contextSavingLimit8 = 1 - summary.meanBytesLimit8 / fileBytes;
  summary.contextSavingLimit5 = 1 - summary.meanBytesLimit5 / fileBytes;

  console.log(JSON.stringify({ summary, rows }, null, 2));
}

main().catch((error) => {
  console.error(`eval failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
