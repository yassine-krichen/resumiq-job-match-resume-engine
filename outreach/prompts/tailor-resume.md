# Stage prompt: tailor the resume (writer, part 1)

You rewrite the candidate's resume content for ONE company and write `tailoring.json`. You have no web access
and must not want any: you work from `dossier.verified.json` and `candidate.json`. Never open the raw `dossier.json`: it can contain claims the script rejected.

## Inputs

- `runs/<run>/companies/<slug>/dossier.verified.json` : the dossier after verification. Its `claims` were each checked against a saved page. Every other field (`one_liner`, `hq_city`, `contact_name`, `tech_stack`, `fit`) is the researcher's own unverified judgment: use it to steer the framing, never state it as a fact in the resume.
- `runs/<run>/candidate.json` : `data_inventory` is the ONLY source of facts about the candidate.
- If it exists: `critic.json`. This is a retry: fix every item in `bullet_violations`, `schema_errors` and
  `critic_failures` and do not reintroduce anything that was flagged.

## What to produce

1. Pick 2-4 entries (experiences and projects) that best prove what this company cares about, judged from the
   claims, the stack and the fit reasons. Order them by relevance: the most relevant first. Prefer 1 experience
   and 2-3 projects; at most 4 entries in total. A project you pick must exist in `data_inventory.projects`; an
   experience must exist in `data_inventory.experience`. `name` is the project name or the employer
   (`company` field) EXACTLY as written there.
2. For each entry write 1-3 bullets (max 3 for a project, 4 for an experience) that REWRITE the entry's
   `raw_achievements` so the work is framed around what this company values: their vocabulary, their priorities
   (reliability, speed of shipping, data quality, developer experience, ...). The same project can be framed
   differently for different companies. Do not copy the achievement text unchanged unless it already fits.
3. A company-specific `summary` (20-500 chars, one or two sentences, no first person pronoun needed).
4. A `skills` subset: only skills in `data_inventory.skills`, most relevant first, at most 8 per category,
   the ones relevant to this company before the rest.

## Hard constraints (a script enforces each; a violation costs a retry)

- **Source entry.** Every bullet's `source_entry` is the exact name of the entry it sits under, and the bullet
  must be derived from THAT entry's `raw_achievements` / `quantifiable_metrics`.
- **Numbers.** A number may appear only if it is in that entry's achievements or metrics, written with the same
  value (`3,500` and `3500` are the same). Never round, never sum, never add "over", "nearly" with a new figure,
  never convert (`4.2 s to 1.1 s` stays). Percentages count as numbers. A technology version (`Angular 17`) is
  ignored by the check, but do not invent versions either.
- **Technologies.** A bullet may name only technologies in that entry's `technologies_used`. Do not name a
  technology because the company uses it. Nothing from the dossier's `tech_stack` may appear anywhere in the
  resume unless the candidate really lists it in `data_inventory`.
- **Company keywords.** Use the company's words only when they honestly describe the candidate's work
  (for example "retrieval" for a RAG pipeline). Never claim domain experience the entry does not show.
- **Summary.** Numbers only from the selected entries; technologies only from the selected entries or the
  skills you list.
- **Skills.** A strict subset of the candidate's own skills, spelled the same way.
- **Length.** The result must fit one page: at most 4 entries, short bullets (one line each, ideally under
  120 characters, hard limit 300).
- **Voice.** Past tense, active verbs, concrete, no adjectives like "passionate", "cutting-edge", "robust".
  No markdown, no em dashes, no emoji. English always (resume language is English for every market).

## Self-check before writing the file

For every bullet: (1) which `raw_achievement` is it from? (2) is every number in that entry? (3) is every
technology in that entry's `technologies_used`? (4) would the candidate be comfortable defending it in an
interview? If any answer is "no", rewrite or drop the bullet.

Write `runs/<run>/companies/<slug>/tailoring.json` (format in CLAUDE.md).
