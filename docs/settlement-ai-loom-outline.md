# Settlement AI Workflow Loom Outline

## 1. Frame The Cut

- Start on `/context` or `/reports`.
- Explain that settlement is many problems, but this prototype focuses on deal interpretation plus confirmation-gated calculation.
- State the thesis: AI extracts ambiguity, humans confirm intent, deterministic code calculates payout.

## 2. Show The Old Failure

- Open a Vs settlement such as `/shows/show_0017/settle`.
- Point out that the old unsupported area is now the Deal Interpreter.
- Explain why this is the right surface: it is exactly where Mariana used to leave Greenroom for a spreadsheet.

## 3. Clean Vs Deal

- Use `show_0017`.
- Show interpreted terms, source snippets, no unnecessary confirmations, worksheet, and guarantee-vs-percentage winner.
- Emphasize that this is a normal 2am walkthrough state: fast, traceable, and not chat-like.

## 4. Coastal Spell Ambiguity

- Use `show_coastal_spell_dispute`.
- Show the extracted `$900 marketing recoup`.
- Show the locked worksheet and the confirmation question.
- Call out the `$720` payout impact and disputed recoup context.
- Explain that the system is intentionally refusing to create an authoritative payout until a human confirms the interpretation.

## 5. Ratchet And Walkout Edges

- Use `show_0038` for ratchet.
- Use `show_0258` for walkout.
- Show that the workflow captures terms, asks the right question, then unlocks deterministic calculation after confirmation.
- Position this as product trust: the prototype makes uncertainty visible.

## 6. Door Deal

- Use `show_0018`.
- Show the door-waterfall confirmation.
- Explain that simple confirmed door structures can calculate, but unknown waterfalls stay locked.

## 7. Existing Supported Deals

- Use `show_0446` for flat and `show_0163` for percentage of gross.
- Show that current supported settlement math still works, now with interpretation and source context above it.

## 8. Technical Close

- Mention that reviewer interactions are URL-scoped and do not write to SQLite.
- Mention source-hash caching.
- Mention optional server-side LLM when `OPENAI_API_KEY` exists and deterministic local fallback otherwise.
- Close with why final payout remains deterministic and auditable.
