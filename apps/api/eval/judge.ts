import type { AISelection } from '@resumiq/ai-bridge';
import { extractJSON } from '@resumiq/ai-bridge';
import { z } from 'zod';

import { EVAL_CONFIG } from './config';
import type { JudgeResult } from './eval.types';
import { isNarrative } from './grounding/extract-claims';
import type { Claim } from './grounding/extract-claims';
import type { InventoryIndex } from './grounding/inventory-index';
import { extractClaims } from './grounding/extract-claims';

export class JudgeValidationError extends Error {
  constructor(
    message: string,
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'JudgeValidationError';
  }
}

const JudgeResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(['supported', 'partial', 'unsupported']),
      issue: z.string().default(''),
    }),
  ),
});

// Deliberately worded differently from the generator's and critique's prompts.
const JUDGE_SYSTEM = `\
You are a meticulous fact-checker. You receive resume lines and a source-of-truth record
of one person's real career history. Decide, line by line, whether each line states anything
that the record does not support.

A line is checked only against the evidence block named in its "evidence" field.

Verdicts:
- "supported": every factual assertion (figures, technologies, scope, ownership, outcomes) is in the
  evidence, allowing rewording, reordering, shortening, and combining facts from the same evidence block.
- "partial": the core is supported, but a detail is stretched: a rounded or derived figure that is
  consistent with the evidence, a mildly stronger verb, or a technology only implied by the evidence.
- "unsupported": at least one concrete assertion is absent from or contradicted by the evidence: an
  invented or altered figure, a technology the evidence never mentions, a claimed outcome, scope,
  team size, or leadership role the evidence does not state, or content taken from a different block.

Do not judge writing quality or style. Judge only whether the content is true to the evidence.
Reply with ONLY a JSON object: {"verdicts":[{"id":"<line id>","verdict":"supported|partial|unsupported","issue":"<10 words max naming the unsupported part, or empty>"}]}
Return exactly one verdict per line id, no extras.`;

/** Compact view of the whole inventory, used only to check the summary line. */
function inventoryDigest(index: InventoryIndex): unknown {
  return {
    summaries: index.db.summaries,
    education: index.db.education.map((e) => ({
      institution: e.institution,
      degree: e.degree_type,
      major: e.major,
      honors: e.honors,
      gpa: e.gpa,
    })),
    experience: index.db.experience.map((e) => ({
      company: e.company,
      role: e.role,
      technologies_used: e.technologies_used,
      quantifiable_metrics: e.quantifiable_metrics,
    })),
    projects: index.db.projects.map((p) => ({
      name: p.name,
      technologies_used: p.technologies_used,
    })),
    skills: {
      programming_languages: index.db.skills.programming_languages,
      frameworks_and_libraries: index.db.skills.frameworks_and_libraries,
      infrastructure_and_tools: index.db.skills.infrastructure_and_tools,
      databases: index.db.skills.databases,
    },
    certifications: index.db.certifications.map((c) => c.name),
    awards: index.db.awards_and_honors.map((a) => a.title),
  };
}

export interface JudgeRequest {
  user: string;
  claimIds: string[];
}

/**
 * Builds the judge input for one resume. Arm identity, reasoning, and scores are
 * never included. Lines attributed to entries that do not exist are skipped here
 * because the deterministic check has already marked them fabricated.
 */
export function buildJudgeRequest(selection: AISelection, index: InventoryIndex): JudgeRequest {
  const claims = extractClaims(selection, index).filter(
    (c: Claim) => isNarrative(c) && (c.kind === 'summary' || c.entry !== null),
  );
  const evidence: Record<string, unknown> = {};
  const lines = claims.map((c) => {
    let evidenceId = 'inventory_digest';
    if (c.entry) {
      evidenceId = `${c.entry.type}_${c.entry.index}`;
      evidence[evidenceId] = c.entry.json;
    } else {
      evidence[evidenceId] = inventoryDigest(index);
    }
    return { id: c.id, evidence: evidenceId, text: c.text };
  });
  const user = `\
<evidence>
${JSON.stringify(evidence, null, 1)}
</evidence>

<resume_lines>
${JSON.stringify(lines, null, 1)}
</resume_lines>`;
  return { user, claimIds: claims.map((c) => c.id) };
}

function parseJudge(text: string, expectedIds: string[]): JudgeResult | string {
  let parsed: unknown;
  try {
    parsed = extractJSON<unknown>(text);
  } catch (err) {
    return (err as Error).message.slice(0, 300);
  }
  const result = JudgeResponseSchema.safeParse(parsed);
  if (!result.success) return result.error.message.slice(0, 300);
  const got = new Set(result.data.verdicts.map((v) => v.id));
  const missing = expectedIds.filter((id) => !got.has(id));
  if (missing.length > 0) return `missing verdicts for ids: ${missing.join(', ')}`;
  return { verdicts: result.data.verdicts.filter((v) => expectedIds.includes(v.id)) };
}

const MAX_RATE_LIMIT_WAITS = 6;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** freellmapi says when a rate-limited route frees up ("Soonest reset ~38s" / "~2m"). */
function resetDelayMs(body: string): number {
  const m = body.match(/Soonest reset ~(\d+)(s|m)/);
  if (!m) return 30_000;
  return (Number(m[1]) * (m[2] === 'm' ? 60 : 1) + 3) * 1000;
}

async function callJudge(user: string): Promise<string> {
  for (let wait = 0; ; wait++) {
    const out = await callJudgeOnce(user);
    if (typeof out === 'string') return out;
    // A pinned judge model has a single route, so a 429 means "wait for the reset", not "retry now".
    if (wait >= MAX_RATE_LIMIT_WAITS) throw new Error(`Freellmapi HTTP 429: ${out.body.slice(0, 200)}`);
    await sleep(Math.min(resetDelayMs(out.body), 150_000));
  }
}

async function callJudgeOnce(user: string): Promise<string | { body: string }> {
  const baseUrl = process.env.FREELLMAPI_BASE_URL ?? 'https://freellmapi-19vj.onrender.com/v1';
  const apiKey = process.env.FREELLMAPI_API_KEY;
  if (!apiKey) throw new Error('FREELLMAPI_API_KEY is not set');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: EVAL_CONFIG.judgeModel,
      temperature: EVAL_CONFIG.judgeTemperature,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status === 429) return { body: await res.text().catch(() => '') };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Freellmapi HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

/** One judge call per resume, with a single repair retry (mirrors generateJSON's contract). */
export async function judgeSelection(
  selection: AISelection,
  index: InventoryIndex,
): Promise<JudgeResult> {
  const { user, claimIds } = buildJudgeRequest(selection, index);
  if (claimIds.length === 0) return { verdicts: [], judgeModel: EVAL_CONFIG.judgeModel };

  const first = await callJudge(user);
  const firstParsed = parseJudge(first, claimIds);
  if (typeof firstParsed !== 'string') return { ...firstParsed, judgeModel: EVAL_CONFIG.judgeModel };

  const repair = `${user}\n\nYour previous reply was invalid: ${firstParsed}\nReply again with ONLY the corrected JSON object.`;
  const second = await callJudge(repair);
  const secondParsed = parseJudge(second, claimIds);
  if (typeof secondParsed !== 'string') return { ...secondParsed, judgeModel: EVAL_CONFIG.judgeModel };
  throw new JudgeValidationError(`judge output invalid after repair: ${secondParsed}`, second.slice(0, 600));
}
