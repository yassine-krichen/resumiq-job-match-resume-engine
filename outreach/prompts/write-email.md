# Stage prompt: write the email and follow-up (writer, part 2)

Write `draft.json` for ONE company, after `tailoring.json`. Write in the dossier's `language` (`en` or `fr`).
You have no web access. A script checks every rule below; the reader is a busy engineer or founder who will
decide in five seconds whether this is a person or a template.

## Inputs

`dossier.verified.json` (never the raw `dossier.json`). Only its `claims` are verified: each quote was found in a saved page. `language` and `timezone` drive the template; `one_liner`, `hq_city`, `contact_name` and `tech_stack` are the researcher's unverified notes, so never state them as facts in the email, `tailoring.json` (the entries you
chose), `candidate.json` (`availability.lines`, `data_inventory`, `critic_rules`), `input.json` (the contact
name from the list, if any). On a retry also `critic.json`: fix every item.

## Structure of the body (one paragraph, about 5 sentences)

1. **Hook** (1 sentence): one verified claim from `claims` in `dossier.verified.json`, said in your words and specific enough that
   it could not be sent to another company. Set `hook_claim_id` to that claim's `id`. The hook must be true to
   its `quote`; do not stretch it. Choose `anchor_phrase`: a short phrase (3-8 words) that appears VERBATIM in
   your body (same spelling) and states the hook.
2. **Proof** (1-2 sentences): one project or experience from `tailoring.entries` that maps to the hook, with
   one concrete fact from it (a number or outcome that is in that entry's achievements/metrics). Put its exact
   name in `mentioned_projects`, and name it in the body. Do not claim the project is related to the company's
   product unless it honestly is.
3. **Availability** (1-2 sentences): copy these three lines from `availability.lines[<language>]` VERBATIM
   (letter for letter, you may only add punctuation around them): `hours_line`, `start_line`, and the
   `overlap` line for the company's region: `europe` if the timezone starts with `Europe/`, `us` if it is a
   US/Canada zone, otherwise `other`. The summer 2027 internship must be on the table: use or rephrase
   `ask_line` so the words "internship" and "summer 2027" (French: "stage" and "été 2027") appear.
4. **Call to action** (last sentence, ONE question): a short call. Set `cta` to that exact sentence and make it
   appear verbatim, once, in the body. It is the only question mark in the subject and body.

## Rules (hard)

- **Words**: body 50-120 words (French 55-130); follow-up 25-70 words. Count them.
- **Subject**: at most 60 characters, specific to the company (their launch, product or repo), no `!`, no
  ALL-CAPS word of 4+ letters (the company's own capitalised name is fine), no clickbait, no "Re:".
- **Numbers**: only values found in the hook quote, in a mentioned entry's achievements/metrics, or in the
  availability lines. No invented years, team sizes, percentages.
- **No links** except ones in `candidate.candidate.links`. Prefer none.
- **No placeholders** (`[Name]`, `{x}`, `<x>`), no markdown (`**`, backticks, bullets, headings), no em dash
  (`—`; use a comma or a period), no emoji, no exclamation marks.
- **Banned phrases** (also in `critic_rules`): EN "reaching out", "leverage", "I hope this finds you",
  "I am writing to", "passionate", "synergy", "touch base", "esteemed", "cutting-edge", and the "I hope you are
  well" family. FR "je me permets de vous contacter", "n'hésitez pas", "passionné", "j'espère que vous allez
  bien", "je vous écris", "dynamique". Follow-up also bans "just following up", "circling back", "bumping".
- **Company name** appears in the subject or the body.
- **Never mention** where the candidate lives as a selling point or an apology. The overlap line carries the
  practical information; the signature and resume show the rest.
- **Do not add a signature or sign-off block.** The sender appends the professional signature. End on the
  question. A greeting line is fine ("Hi Claire,") and counts in the words.

## Greeting

Use the name from `input.json` (it comes from the user's own list) if it looks like a person's first name or full
name, else a neutral opener ("Hello,"; French "Bonjour,"). Never "Dear Sir/Madam", never the company name as a
person.

## English style

Plain, direct, first person singular, contractions allowed but not slangy. One idea per sentence. Say what you
noticed and what you can do, not what you "would love". No flattery ("amazing", "love what you do").

## French guidance (when `language` is `fr`)

- Vouvoiement always: "vous", "votre". Greeting "Bonjour {Prénom}," or "Bonjour,"; no "Madame, Monsieur".
- Register: professionnel, chaleureux, direct; phrases courtes. Natural French, not translated English.
  Typography: a space before `?`, `;`, `:` ; apostrophes and accents correct (é, è, à, ç).
- Use the French availability lines from `availability.lines.fr` verbatim (they are already French).
- Say "stage d'été 2027" or "stage" for the internship, "temps partiel" and "à distance" for the part-time
  remote offer. Avoid anglicisms when a French word exists, but keep technology names as they are.
- The follow-up is also French. A French body inside an English draft (or the reverse) is rejected.
- The call to action is a polite question: "Auriez-vous le temps pour un court appel cette semaine ?"

## Follow-up (`follow_up_body`)

Sent 5 business days later in the same thread with no attachment. It adds ONE new angle that was not in the
first email: a second verified claim from `claims`, or a second fact from the same project, or a
concrete offer ("I can send a short demo of X"). It must not say it is a follow-up in the banned ways, must not
repeat the first email's sentences, has no question mark requirement (at most one), and no new numbers
except from entries or claims. 25-70 words.

If the follow-up states ANY fact about the company, it must rest on a verified claim: set `follow_up_claim_id`
to that claim's `id` (it may be the hook claim or a second one; a number may then come from that claim's
quote). A claim id that is not in `dossier.verified.json` is rejected. If the follow-up only talks about the
candidate's own work, set `follow_up_claim_id` to `null`.

## Output

Write `runs/<run>/companies/<slug>/draft.json` (format in CLAUDE.md) with `"generic": false`. Do not write
generic emails here: a company without a verified hook never reaches the writer.

## Self-check

Read your body aloud: could it be sent to a different company by swapping the name? If yes, the hook is too
vague. Count words. Confirm the three availability lines and the `cta` are verbatim in the body, and the
`anchor_phrase` too. Confirm exactly one `?` across subject and body.
