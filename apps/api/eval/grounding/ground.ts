import type { Claim } from './extract-claims';
import type { InventoryIndex } from './inventory-index';
import { phraseMatches, techKey } from './normalize';
import { extractNumbers, isRoundingOfAny, numberKey } from './numbers';
import { detectTech } from './tech-vocabulary';

/**
 * number: figure not in the entry's inventory text. tech: technology not
 * attributed to that entry. entry: employer/project absent from the inventory.
 * title: role mismatch, or cert/award/volunteering/publication absent.
 * skill: skills-section item absent. judge: set later by the LLM judge only.
 */
export type FabricationType = 'number' | 'tech' | 'entry' | 'title' | 'skill' | 'judge';

export interface Flag {
  type: FabricationType;
  detail: string;
  /** Also fails the loose (whole-inventory) check, not just the strict (this-entry) check. */
  loose: boolean;
}

export interface ClaimGrounding {
  claimId: string;
  /** Strict: figures and technologies must be attributable to the claim's own entry. */
  strictFabricated: boolean;
  /** Loose: figures and technologies may come from anywhere in the inventory. */
  looseFabricated: boolean;
  flags: Flag[];
  /** Numbers that are a coarser rounding of an inventory number. Left to the judge. */
  derivedNumbers: string[];
}

// "Python 3.11", "Next.js 16": a version following a technology name is not a metric.
const VERSION_AFTER_TECH_RE = /([A-Za-z][A-Za-z.+#-]*)\s+v?(\d+(?:\.\d+)*)/g;

function withoutVersionNumbers(text: string, index: InventoryIndex): string {
  return text.replace(VERSION_AFTER_TECH_RE, (whole, name: string) =>
    index.vocabKeys.has(techKey(name)) ? name : whole,
  );
}

function checkNumbers(claim: Claim, index: InventoryIndex, flags: Flag[], derived: string[]): void {
  const entryPool = claim.entry?.numbers ?? index.globalNumbers;
  const scoped = claim.entry !== null;
  for (const token of extractNumbers(withoutVersionNumbers(claim.text, index))) {
    const key = numberKey(token.value);
    if (entryPool.has(key)) continue;
    if (scoped && index.globalNumbers.has(key)) {
      flags.push({
        type: 'number',
        detail: `${token.raw} is in the inventory but not in "${claim.entryLabel}"`,
        loose: false,
      });
      continue;
    }
    if (isRoundingOfAny(token.value, entryPool)) {
      derived.push(token.raw);
      continue;
    }
    flags.push({ type: 'number', detail: `${token.raw} not found in the inventory`, loose: true });
  }
}

function checkTech(claim: Claim, index: InventoryIndex, flags: Flag[]): void {
  const allowed = claim.entry?.techKeys ?? index.globalTechKeys;
  for (const key of detectTech(claim.text, index.vocab)) {
    if (allowed.has(key)) continue;
    const label = index.vocab.find((v) => v.key === key)?.label ?? key;
    const inventoryHasIt = index.globalTechKeys.has(key);
    flags.push({
      type: 'tech',
      detail: inventoryHasIt
        ? `${label} belongs to a different entry than "${claim.entryLabel}"`
        : `${label} is not in the inventory`,
      loose: !inventoryHasIt,
    });
  }
}

function checkStructure(claim: Claim, index: InventoryIndex, flags: Flag[]): void {
  switch (claim.kind) {
    case 'header':
      if (!claim.entry) {
        flags.push({ type: 'entry', detail: `"${claim.entryLabel}" not in inventory`, loose: true });
      } else if (claim.titleMatches === false) {
        flags.push({ type: 'title', detail: `role differs for "${claim.entryLabel}"`, loose: true });
      }
      return;
    case 'skill': {
      const known =
        index.skillKeys.has(techKey(claim.text)) ||
        index.skillItems.some((s) => phraseMatches(s, claim.text));
      if (!known) flags.push({ type: 'skill', detail: `skill "${claim.text}" not in inventory`, loose: true });
      return;
    }
    case 'title': {
      const pool: Record<string, string[]> = {
        certifications: index.certifications,
        awards: index.awards,
        volunteering: index.volunteering,
        publications: index.publications,
      };
      if (!(pool[claim.section] ?? []).some((t) => phraseMatches(t, claim.text))) {
        flags.push({
          type: 'title',
          detail: `${claim.section} item "${claim.text}" not in inventory`,
          loose: true,
        });
      }
      return;
    }
    default:
      return;
  }
}

/** Deterministic grounding of one claim against the inventory. No LLM involved. */
export function groundClaim(claim: Claim, index: InventoryIndex): ClaimGrounding {
  const flags: Flag[] = [];
  const derivedNumbers: string[] = [];

  if (claim.kind === 'bullet' || claim.kind === 'summary') {
    if (claim.kind === 'bullet' && !claim.entry) {
      // A bullet under a non-existent employer/project cannot be true of anything in the inventory.
      flags.push({
        type: 'entry',
        detail: `bullet attributed to "${claim.entryLabel}", which is not in the inventory`,
        loose: true,
      });
    } else {
      checkNumbers(claim, index, flags, derivedNumbers);
      checkTech(claim, index, flags);
    }
  } else {
    checkStructure(claim, index, flags);
  }

  return {
    claimId: claim.id,
    strictFabricated: flags.length > 0,
    looseFabricated: flags.some((f) => f.loose),
    flags,
    derivedNumbers,
  };
}
