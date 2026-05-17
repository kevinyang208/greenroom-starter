# Settlement AI Workflow Memo

## Slice

I chose the 2am deal-translation problem: turn messy deal prose into confirmed structured terms before settlement math runs. This is narrower than "fix settlement" but still covers the failure Mariana feels most often. The current product can calculate flat and simple gross-percentage deals, but the moment a Vs deal, recoup, ratchet, walkout pot, or door waterfall appears, Mariana falls back to a spreadsheet. That means Greenroom loses the workflow exactly when trust matters most.

The prototype replaces the unsupported-deal dead end with a Deal Interpreter on every settlement page. It drafts structured terms from prose, shows the source language, asks only payout-impacting confirmation questions, keeps demo answers in the URL, and then passes confirmed terms to deterministic calculation.

## Why This Slice

The leverage point is not a more magical calculator. The costly failure is that negotiated language and structured fields drift apart. `deal_notes_freetext` is the truth, but the calculator historically trusts structured fields that are incomplete or stale. Coastal Spell is the clearest example: "$900 marketing recoup against gross" could mean inside the expense cap or outside it. At 80% artist share, that ambiguity created a $720 payout difference and a WME dispute.

I cut agent portals, payment flows, real-time forecasting, and a universal settlement engine. Those are useful, but they do not solve the first trust gap: Mariana and the artist team need to agree on what the deal means before anyone should trust the payout.

## Design

The product thesis is: AI extracts ambiguity, humans confirm intent, deterministic code calculates payout.

Every settlement now shows:

- Interpreted deal terms with source snippets.
- Confirmation questions for ambiguous payout terms.
- A locked worksheet when blocking questions are unanswered.
- An authoritative worksheet only when the terms are confirmed and the formula is supported.
- Persistent risk flags for disputed recoups, status/sign-off mismatch, comp treatment, and prose/field conflicts.

The MVP supports calculation for flat, percentage of gross, percentage of net, Vs net/gross, simple door deals, confirmed recoup treatments, structured bonuses, confirmed ratchets, confirmed walkout pots, and comps that count toward gross. It still refuses to calculate when the human selects "not sure / ask agent" or when prose references missing bonus terms that cannot be reconstructed from the available data.

## AI Approach

The app works without an API key. The local fallback parser covers the seeded case-study patterns and marks uncertain clauses for confirmation. If `OPENAI_API_KEY` exists, the server can call an LLM extractor, but the key never reaches the browser and the model never returns final payout. It only returns draft terms, source snippets, risks, and confirmation questions.

That separation is intentional. Settlement is an audit workflow. A model can help identify ambiguity; it should not be the authority for money movement.

## Validation

I validated the prototype against the intended demo scenarios:

- Clean Vs deal calculates with guarantee-vs-percentage comparison.
- Coastal Spell extracts the $900 marketing recoup, locks calculation, asks inside/outside cap, and shows the $720 impact.
- Ratchet deal extracts the tiers, asks how the higher percentage applies, then calculates once confirmed.
- Walkout pot deal captures threshold language, asks which threshold definition applies, then calculates once confirmed.
- Door deal asks what comes off before the artist split.
- Prose-only bonus language asks whether any unstructured bonus should apply before producing an authoritative payout.
- Existing flat and percentage-of-gross pages still calculate with the interpreter added.
- Confirmation answers unlock the worksheet through URL state without writing to SQLite.
- The app builds and runs without `OPENAI_API_KEY`.

## What I Would Ship Next

Next I would add a reviewer-facing settlement statement that shows the confirmed assumptions alongside the final worksheet, then instrument where users choose "ask agent" or regenerate. Those events would tell us which terms need first-class structured modeling next. I would also add an evaluation set of historical deal notes and expected confirmation questions before broadening the LLM extractor.
