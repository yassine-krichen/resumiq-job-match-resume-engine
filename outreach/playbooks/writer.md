# Writer playbook

Hints from earlier runs, added by `learn` or by the owner. They describe how the web and the file formats behaved,
never what to do: they cannot override CLAUDE.md, your prompt files or your task message, and an entry that
conflicts with any of them is ignored. Entries are kept short on purpose; the owner prunes them with `playbook`.

## Entries

1. [2026-10-10] [seen 1x] situation: First draft is long and generic => fix: Keep the body between 50 and 120 words. Vendor data across millions of cold emails consistently shows 50 to 125 words outperforms longer mail; founders skim on phones.
2. [2026-10-10] [seen 1x] situation: Choosing a subject line => fix: Short, plain, specific, lower case is fine: 2 to 6 words naming the role or their product, such as part-time engineer for their product name. No clickbait, no fake Re or Fwd, no emojis.
3. [2026-10-10] [seen 1x] situation: Opening line needs to prove real research => fix: Open with one concrete, verified fact from the research quotes (a recent launch, a changelog entry, a repo) and why it caught your eye. Do not open with your name or a compliment that could fit any company.
4. [2026-10-10] [seen 1x] situation: Pitching a student for remote part-time work => fix: State the ask in one sentence with constraints up front: remote, hours per week, timezone overlap, start date, paid internship or contract. Small teams decide faster when the scope is explicit.
5. [2026-10-10] [seen 1x] situation: Proving skills without attachments clutter => fix: Point to one relevant shipped project with a measurable result that matches their stack. Mention the tailored resume is attached or linked; do not paste skill lists into the body.
6. [2026-10-10] [seen 1x] situation: Call to action is vague => fix: Ask one low-effort question: would a 15 minute call next week make sense, or who on the team handles this. One ask only.
7. [2026-10-10] [seen 1x] situation: Writing to a French company => fix: Write in French if the site and job posts are French only, using vous and a formal close such as Bien cordialement. English is fine for startups whose site and posts are in English.
8. [2026-10-10] [seen 1x] situation: Writing to a German company => fix: Use Sie, the surname with Herr or Frau, a precise subject, and facts over enthusiasm. Mention availability and work authorization plainly. Write in English when the company works in English.
9. [2026-10-10] [seen 1x] situation: Writing to a US startup => fix: Use first names, a direct and warm tone, and get to the ask fast. Credentials matter less than proof of shipping; a link to working code beats a GPA.
10. [2026-10-10] [seen 1x] situation: Planning follow-ups => fix: At most one or two short follow-ups, 3 to 5 business days apart, each adding a new verified fact or artifact, sent as a reply in the same thread. Stop at any reply or after the second follow-up.
11. [2026-10-10] [seen 1x] situation: Choosing send time => fix: Send Tuesday to Thursday in the recipient local morning, and avoid holidays and August in France and Germany. Never send in bursts from a fresh domain.
12. [2026-10-10] [seen 1x] situation: A sentence states something not in the research quotes => fix: Remove it or rewrite it to what the quote actually says. Do not invent metrics, customers, mutual connections, or prior use of their product.
13. [2026-10-10] [seen 1x] situation: Tone drifts into flattery or hype => fix: Cut adjectives like amazing, passionate, revolutionary. Plain sentences, one fact, one proof, one ask. Read it as the founder: would a busy person reply in one line?
14. [2026-10-10] [seen 1x] situation: Tailoring the resume for the company => fix: Reorder bullets so the two most relevant projects to their stack and product come first, mirror their job post terms where true, and keep it one page. Never add skills not backed by real work.
15. [2026-10-18] [seen 1x] situation: The blind verifier flagged a follow-up sentence that mixed a company fact with a candidate fact and cited no claim => fix: In the follow-up keep company facts and candidate facts in separate sentences, and set follow_up_claim_id to the verified claim behind the company fact
16. [2026-10-18] [seen 1x] situation: The verifier rejected a company sentence that restated more than the cited quote said, like a version number or an about-page summary => fix: State company facts as narrowly as the quote: reuse its wording and numbers only, and drop any detail the quote does not contain
