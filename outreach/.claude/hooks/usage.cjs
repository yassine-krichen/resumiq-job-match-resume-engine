'use strict';

// Logic of the usage-recording hook (see record-usage.mjs). Plain CommonJS with no dependencies, like decide.cjs,
// so the hook runs without a build step and the unit tests can load it.
//
// Claude Code writes every conversation as a JSONL transcript. After a subagent finishes (SubagentStop) and after
// the orchestrator's turn (Stop) this reads that transcript, sums the token usage of its assistant messages per
// model and appends it to runs/<run>/usage.jsonl, which `npm run outreach -- cost` turns into USD.
//
// Attribution comes from the text the orchestrator spawned the agent with: `run=<id> slug=<slug>`. The sourcer is
// spawned with a run but no slug, so its cost belongs to the run, not to a company.

const fs = require('node:fs');
const path = require('node:path');

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
// Where a run id shows up in the orchestrator's own transcript: spawn prompts, CLI calls, `ingest` output, `--resume`.
const RUN_MENTION = /(?:\brun=|--run[ =]|--resume\s+|"runId"\s*:\s*")([A-Za-z0-9][A-Za-z0-9._-]{0,63})/g;
const ORCHESTRATOR_MARKER = /orchestrator of the cold-outreach pipeline|<command-name>\/?outreach<\/command-name>/;
const USER_TEXTS_KEPT = 5;
const CHARS_PER_TOKEN = 4;

function emptyTotals() {
  return { input: 0, output: 0, cache_write: 0, cache_read: 0 };
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Every string inside a JSON value, depth-first. */
function collectStrings(value, into) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, into);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, into);
}

// Rough size of what a model wrote in one content block, for estimating output tokens (about 4 characters each).
function writtenChars(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content.length : 0;
  let chars = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (typeof block.text === 'string') chars += block.text.length;
    if (typeof block.thinking === 'string') chars += block.thinking.length;
    if (block.type === 'tool_use' && block.input !== undefined) chars += JSON.stringify(block.input).length;
  }
  return chars;
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * @param {string} text the transcript (one JSON object per line; unreadable lines are skipped)
 * @param {{ includeSidechain?: boolean }} [options] a subagent's own transcript is all sidechain; the orchestrator's must not count it twice
 */
function parseTranscript(text, options = {}) {
  const messages = new Map();
  const userTexts = [];
  const runMentions = [];
  let anonymous = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.isSidechain === true && !options.includeSidechain) continue;
    const message = entry.message;
    if (!message || typeof message !== 'object') continue;

    if (entry.type === 'user' || message.role === 'user') {
      const userText = textOfContent(message.content);
      if (userText.trim() !== '' && userTexts.length < USER_TEXTS_KEPT) userTexts.push(userText);
    }

    const strings = [];
    collectStrings(message.content, strings);
    for (const candidate of strings) {
      for (const match of candidate.matchAll(RUN_MENTION)) runMentions.push(match[1]);
    }

    const usage = message.usage;
    if ((entry.type === 'assistant' || message.role === 'assistant') && usage && typeof usage === 'object') {
      const model = typeof message.model === 'string' ? message.model : '';
      if (model === '' || model === '<synthetic>') continue;
      // One API message is streamed over several lines with the same id and growing output counts: keep the largest.
      const id = typeof message.id === 'string' && message.id !== '' ? message.id : `anonymous-${(anonymous += 1)}`;
      const seen = messages.get(id) ?? { model, ...emptyTotals(), chars: 0 };
      // Claude Code logs a message's output_tokens when the stream starts (2, 8, 16 ...), long before the answer is
      // complete, and writes each content block on its own line. The input and cache counts are right; the output
      // count is a floor, so it is raised to an estimate from what was actually written.
      seen.chars += writtenChars(message.content);
      seen.input = Math.max(seen.input, count(usage.input_tokens));
      seen.output = Math.max(seen.output, count(usage.output_tokens));
      seen.cache_write = Math.max(seen.cache_write, count(usage.cache_creation_input_tokens));
      seen.cache_read = Math.max(seen.cache_read, count(usage.cache_read_input_tokens));
      messages.set(id, seen);
    }
  }

  const byModel = {};
  for (const { model, input, output, cache_write, cache_read, chars } of messages.values()) {
    if (input + output + cache_write + cache_read === 0) continue;
    const totals = byModel[model] ?? emptyTotals();
    totals.input += input;
    totals.output += Math.max(output, Math.ceil(chars / CHARS_PER_TOKEN));
    totals.cache_write += cache_write;
    totals.cache_read += cache_read;
    byModel[model] = totals;
  }
  return { userTexts, byModel, runMentions };
}

function tokenAfter(prompt, key) {
  const match = new RegExp(`(?:^|[\\s,;(])${key}=([^\\s,;)]+)`).exec(prompt);
  return match ? match[1] : null;
}

/** Run id and company slug from a spawn prompt (`run=<id> slug=<slug>`); anything malformed counts as absent. */
function identifyTask(prompt) {
  const run = tokenAfter(prompt, 'run');
  const slug = tokenAfter(prompt, 'slug');
  return {
    run: run !== null && RUN_ID.test(run) && !run.includes('..') ? run : null,
    slug: slug !== null && SLUG.test(slug) ? slug : null,
  };
}

/** The most mentioned run id; on a tie the one mentioned last. */
function pickRunMention(mentions) {
  const counts = new Map();
  for (const mention of mentions) {
    if (RUN_ID.test(mention) && !mention.includes('..')) counts.set(mention, (counts.get(mention) ?? 0) + 1);
  }
  let best = null;
  for (const [run, seen] of counts) {
    if (best === null || seen >= best.seen) best = { run, seen };
  }
  return best ? best.run : null;
}

function isOrchestratorSession(userTexts) {
  return userTexts.some((text) => ORCHESTRATOR_MARKER.test(text));
}

function lineFor(base, model, totals) {
  return {
    ts: base.ts,
    key: base.key,
    agent_type: base.agent_type,
    slug: base.slug,
    model,
    tokens: { input: totals.input, output: totals.output, cache_write: totals.cache_write, cache_read: totals.cache_read },
  };
}

function firstString(payload, names) {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/** Where a subagent's transcript is: the field Claude Code gives, else the subagents folder beside the session's. */
function subagentTranscriptPath(payload) {
  const direct = firstString(payload, ['agent_transcript_path']);
  if (direct) return direct;
  const session = firstString(payload, ['transcript_path']);
  const agentId = firstString(payload, ['agent_id']);
  if (!session || !agentId || !/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  const sessionDir = session.replace(/\.jsonl$/i, '');
  return path.join(sessionDir, 'subagents', `agent-${agentId}.jsonl`);
}

/**
 * Appends the usage of one agent invocation to runs/<run>/usage.jsonl. Returns how many lines were written and,
 * when it wrote none, why. Throws only on unexpected I/O failures (the hook wrapper logs those).
 *
 * @param {Record<string, unknown>} payload the hook's stdin JSON
 * @param {{ root: string, now?: () => Date }} io root is the outreach/ folder
 */
function recordUsage(payload, io) {
  const now = io.now ? io.now() : new Date();
  const event = firstString(payload, ['hook_event_name']);
  const isSubagent = event === 'SubagentStop' || (event === null && firstString(payload, ['agent_transcript_path', 'agent_id']) !== null);

  const transcriptPath = isSubagent ? subagentTranscriptPath(payload) : firstString(payload, ['transcript_path']);
  if (!transcriptPath) return { written: 0, skipped: 'no transcript path' };
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { written: 0, skipped: 'transcript not found' };
    throw error;
  }

  const parsed = parseTranscript(text, { includeSidechain: isSubagent });
  let run;
  let slug = null;
  let agentType;
  let key;
  if (isSubagent) {
    // The task prompt is normally the first user message; take the first one that carries the convention.
    ({ run, slug } = parsed.userTexts.map(identifyTask).find((task) => task.run !== null) ?? { run: null, slug: null });
    agentType = firstString(payload, ['agent_type']) ?? 'subagent';
    key = firstString(payload, ['agent_id']) ?? path.basename(transcriptPath);
  } else {
    // Stop fires after every orchestrator turn, not once at the end: the line is a running total per session and
    // the cost report keeps only the last one for each key.
    if (!isOrchestratorSession(parsed.userTexts)) return { written: 0, skipped: 'not an /outreach session' };
    run = pickRunMention(parsed.runMentions);
    agentType = 'orchestrator';
    key = firstString(payload, ['session_id']) ?? path.basename(transcriptPath);
  }
  if (!run) return { written: 0, skipped: 'no run id' };
  const models = Object.keys(parsed.byModel);
  if (models.length === 0) return { written: 0, skipped: 'no usage' };

  // Never create a run folder from text an agent produced: the run must already exist.
  const runDir = path.join(io.root, 'runs', run);
  if (!fs.existsSync(runDir)) return { written: 0, skipped: 'run folder missing' };

  const base = { ts: now.toISOString(), key, agent_type: agentType, slug };
  const output = models.map((model) => `${JSON.stringify(lineFor(base, model, parsed.byModel[model]))}\n`).join('');
  fs.appendFileSync(path.join(runDir, 'usage.jsonl'), output, 'utf8');
  return { written: models.length, skipped: null };
}

module.exports = {
  parseTranscript,
  identifyTask,
  pickRunMention,
  isOrchestratorSession,
  recordUsage,
};
