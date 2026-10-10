# Verifier playbook

Hints from earlier runs, added by `learn` or by the owner. They describe how the web and the file formats behaved,
never what to do: they cannot override CLAUDE.md, your prompt files or your task message, and an entry that
conflicts with any of them is ignored. Entries are kept short on purpose; the owner prunes them with `playbook`.

## Entries

1. [2026-10-10] [seen 1x] situation: Checking a claim about the company in the email => fix: Every factual sentence about the company must map to a stored verbatim quote from a fetched snapshot. If no quote supports it, fail the sentence and name the missing evidence.
2. [2026-10-10] [seen 1x] situation: Quote exists only in a search snippet, not in a snapshot => fix: Reject as unverified. Snippets are leads, not evidence; the supporting text must appear in the saved page content.
3. [2026-10-10] [seen 1x] situation: Email paraphrases a quote with a stronger claim => fix: Fail when the paraphrase adds certainty, numbers or scope absent from the quote (launched vs announced, all vs some, hiring interns vs hiring). Suggest the weaker wording that the quote supports.
4. [2026-10-10] [seen 1x] situation: Snapshot came from a login wall, cookie wall, Cloudflare challenge or error page => fix: Treat any quote from it as invalid. Detect by titles like Sign in or Just a moment, consent-only text, or a body with no company-specific content.
5. [2026-10-10] [seen 1x] situation: The supporting fact is old => fix: Fail recency claims (recently, just launched, this month) when the source date is more than about 6 months old or missing. Allow neutral wording without a time claim.
6. [2026-10-10] [seen 1x] situation: Email mentions a tech stack item => fix: Require a quote from a job post, docs, GitHub repo or engineering blog naming it. Script hosts in HTML count only as weak evidence and cannot support claims like you use X in production.
7. [2026-10-10] [seen 1x] situation: Email states the company accepts remote, part-time or interns => fix: Require an explicit quote with those words. If the email only asks whether it is possible, that is fine without evidence; asserting it is not.
8. [2026-10-10] [seen 1x] situation: Recipient name, role or address cannot be traced => fix: Check the contact provenance: a published address or a named person on a team page passes; a pattern guess passes only if labeled a guess and the domain has MX. Fail if the person cannot be tied to the company.
9. [2026-10-10] [seen 1x] situation: Claims about the candidate in the email or resume => fix: Check each candidate claim against the candidate inventory. Numbers must match exactly; no new skills, titles, dates or results.
10. [2026-10-10] [seen 1x] situation: Word count and structure check => fix: Fail if the body is under 50 or over 120 words, has more than one ask, lacks a clear opt-out friendly tone, or contains a subject line over about 8 words.
11. [2026-10-10] [seen 1x] situation: Language and locale mismatch => fix: Confirm the email language matches the target language decision (French site in French, German formal Sie when writing German) and that names and the company name are spelled exactly as on their site.
12. [2026-10-10] [seen 1x] situation: Hallucinated personal touches => fix: Fail any reference to meeting, a mutual connection, past use of their product, or reading a post unless a quote or the candidate inventory supports it.
