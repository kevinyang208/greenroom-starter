# Settlement AI Workflow: Deal Interpreter + Confirmation-Gated Calculator

## Status

This document is the source-of-truth PRD and build tracker for the settlement AI workflow prototype.

Implementation is complete for the MVP slice described here. The prototype now routes every settlement through a Deal Interpreter, keeps reviewer interactions stateless in the URL, and runs deterministic settlement math only when the interpreted terms are supported and confirmed.

Companion submission artifacts:

- Memo: `docs/settlement-ai-case-memo.md`
- Loom outline: `docs/settlement-ai-loom-outline.md`

## Product Thesis

Greenroom should not ask AI to calculate settlement payouts directly. Settlement is a money-moving workflow, so the final payable number must be deterministic, auditable, and reproducible.

The right role for AI is earlier in the workflow:

1. Read messy deal prose.
2. Draft structured deal terms.
3. Identify clauses that affect payout and cannot be safely inferred.
4. Ask Mariana to confirm only the ambiguous terms.
5. Pass confirmed structured terms to deterministic settlement math.

In short:

> AI extracts ambiguity. Humans confirm intent. Deterministic code calculates payout.

## Problem Evidence

### Current product dead end

On `/shows/[id]/settle`, unsupported deal types currently land on an amber card that says the in-app tool cannot settle the deal yet. The page can show raw inputs, but it does not help Mariana interpret the negotiated deal or replace her spreadsheet.

This is the area the new workflow should reuse. The dead-end unsupported card becomes the entry point for the Deal Interpreter.

### Deal prose is the source of truth

The database has structured fields like `deal_type`, `guarantee_amount`, `percentage`, `expense_cap`, and `bonuses_json`. Those fields are useful, but they are not sufficient. The field Mariana actually trusts is `deal_notes_freetext`.

The product needs to inspect both:

- Structured fields for existing machine-readable values.
- Deal prose for negotiated terms, exceptions, ambiguous clauses, and source language.

### Vs deals are not one thing

The current product treats `vs` as one unsupported type, but the data shows several flavors:

- standard guarantee vs percentage of net
- guarantee vs percentage of gross
- expense-capped Vs deals
- bonus-bearing Vs deals
- tier ratchets
- walkout pots
- recoup-bearing deals
- prose that conflicts with structured fields

The workflow should support all seeded deal families at the calculation layer once the payout-impacting assumptions are confirmed. It should still refuse to calculate when the user explicitly chooses "not sure / ask agent" or when a future formula has no deterministic implementation.

### Coastal Spell is the canonical ambiguity

Coastal Spell had language like:

```text
$5,000 vs 80% of net after expenses, whichever greater.
Expenses capped $2,500.
Marketing recoup of $900 against gross.
```

Two plausible reads existed:

- The $900 marketing recoup is inside the $2,500 expense cap.
- The $900 marketing recoup is in addition to the $2,500 expense cap.

That difference changed the artist payout by $720 because the disputed $900 affected an 80% artist share.

The product should detect this before settlement and ask:

```text
Is the $900 marketing recoup included inside the $2,500 expense cap, or deducted in addition to the cap?
```

### Status and sign-off can conflict

Some settlements have a disputed status while the sign-off text says something like "Looks good" or "OK. Good night." That likely means the tour manager accepted the settlement at the table, but the agent disputed it later.

The product should surface these contradictions instead of blindly trusting the status badge.

## Goals

- Replace the unsupported-deal dead end with an all-deal Deal Interpreter.
- Show Mariana how Greenroom interpreted each deal before showing settlement math.
- Ask for confirmations when payout-impacting terms are ambiguous.
- Let reviewers interact with confirmations without writing demo data to SQLite.
- Run deterministic math only after blocking confirmations are resolved.
- Keep the app runnable without an API key.
- Demonstrate optional LLM extraction without exposing API keys to the browser.

## Non-Goals

- Do not ask the LLM to return final artist payout.
- Do not build a payment or wire workflow.
- Do not build an agent portal.
- Do not implement every possible ratchet, walkout, and door formula as fully automatic.
- Do not require `OPENAI_API_KEY` for the reviewer to run the fork.
- Do not hide uncertainty just to produce a number.

## Core User Stories

### Mariana, lead booker

As Mariana, I can open any settlement and see how Greenroom interpreted the deal prose, so I do not have to manually translate the deal into a spreadsheet at 2am.

As Mariana, I can confirm ambiguous terms before calculation, so I can resolve unclear deal language while there is still time to ask the agent.

As Mariana, I can show the tour manager a line-by-line worksheet, so the settlement conversation is about review and sign-off rather than reconstructing math from memory.

### Diego, tour manager

As Diego, I can see the exact basis for the artist payout, so I can check the settlement quickly without reverse-engineering the venue's spreadsheet.

As Diego, I can see whether expenses, fees, recoups, and caps were applied before or after the artist percentage, so I know what I am signing.

### Sarah, agent

As Sarah, I can read the next-morning settlement statement and see assumptions, source snippets, and confirmed interpretations, so I do not have to email Mariana asking what a line item means.

As Sarah, I can trust that ambiguous recoup, ratchet, and walkout terms were flagged rather than silently assumed.

### Marcus, GM

As Marcus, I can see settlement risk flags before approving payout, so I am not signing off based on a screenshot and blind trust.

As Marcus, I can understand whether a disputed status means the whole settlement is disputed or whether a later agent review conflicted with tour-manager sign-off.

## New Workflow

### Step 1: Interpret Deal

The settlement page collects:

- deal structured fields
- `deal_notes_freetext`
- ticket sales
- expenses
- comps
- settlement status and sign-off text
- recoups

It passes those inputs to `draftStructuredDeal`.

The draft returns:

- normalized terms
- source snippets
- confidence
- risk flags
- confirmation questions
- readiness state

Readiness states:

- `ready_to_calculate`
- `needs_confirmation`
- `unsupported_formula`
- `risk_flagged`

### Step 2: Show Interpreted Terms

The page shows a Deal Interpreter card for every deal type.

Term examples:

- Deal type: Vs deal
- Guarantee: $5,000
- Artist share: 80%
- Basis: net after fees and expenses
- Expense cap: $2,500
- Hospitality cap: $500
- Bonus: +$1,000 over $25k gross
- Marketing recoup: $900

Each term should show where it came from when possible:

```text
Source: "$5,000 vs 80% of net after expenses"
```

### Step 3: Confirm Assumptions

If the draft has ambiguous terms, show a confirmation checklist before authoritative math appears.

Confirmation requirements:

- Use radio-card options, not free text.
- Show source text.
- Explain why the answer matters.
- Mark whether the question blocks calculation.
- Keep the answer in the URL query string for the demo.
- Refresh and recompute readiness without writing to the database.

Example confirmation:

```text
Marketing recoup treatment

Source: "Marketing recoup of $900 against gross"

Why it matters:
This changes whether the $900 is already part of the $2,500 expense cap
or deducted in addition to that cap. On this show, the payout impact is $720.

Options:
- Included inside expense cap
- Deducted in addition to expense cap
- Not sure / ask agent
```

### Step 4: Calculate Settlement

Once all blocking confirmations are resolved and the formula is supported, the deterministic calculator runs.

Worksheet requirements:

- Show gross box office.
- Show ticketing fees.
- Show expenses passed through.
- Show expense cap applied.
- Show venue-absorbed overage.
- Show recoup treatment.
- Show bonus treatment.
- Show net basis.
- Show percentage payout.
- For Vs deals, compare guarantee vs percentage side and highlight the winner.
- Show final artist payout only when it is authoritative.

### Step 5: Keep Risk Visible

Even after calculation, risk flags remain visible. Examples:

- Disputed recoup.
- Positive sign-off with disputed settlement status.
- Prose conflicts with structured values.
- Comps count toward gross.
- Formula is captured but not supported.

## UI Requirements

### Placement

Use the current unsupported settlement area as the new anchor.

Current:

```text
The in-app tool can't settle a vs deal yet.
Mariana would do this on a Google Sheet at 2am tonight.
```

New:

```text
Deal Interpreter
Greenroom interpreted the deal prose and found 2 terms to confirm before this settlement is ready.
```

The Deal Interpreter should appear on every settlement page, not only unsupported ones.

### Main Card Layout

Use three stacked sections:

1. `Interpreted deal terms`
2. `Confirm assumptions`
3. `Settlement worksheet`

Keep existing lifecycle, recoups, and sign-off sections below or near this workflow.

### Header Status Labels

Use short, scannable status labels:

- `Ready to calculate`
- `Needs 2 confirmations`
- `Unsupported formula captured`
- `Risk flagged after sign-off`
- `Calculation locked`

### Interpreted Terms UI

Requirements:

- Dense but readable.
- Use rows or compact term cards.
- Show term label, value, confidence/status, and source snippet.
- Do not make this feel like a chatbot transcript.

Example:

```text
Guarantee          $5,000          Confirmed from structured field
Artist share       80%             Source: "80% of net after expenses"
Expense cap        $2,500          Source: "expenses capped $2,500"
Marketing recoup   $900            Needs confirmation
```

### Confirmation UI

Requirements:

- Use radio-card choices.
- Show an apply action per question.
- Preserve answers in URL query params.
- After applying, refresh and recompute.
- Do not show an authoritative payout while blocking questions are unanswered.

### Worksheet UI

Requirements:

- If locked, show a non-authoritative preview only if clearly labeled.
- If ready, show final payout and line-by-line math.
- For Vs deals, show both sides:

```text
Guarantee side       $5,000
Percentage side      $12,285
Winner               Percentage side
```

### Visual Tone

The workflow should feel like Mariana's spreadsheet became trustworthy and collaborative. It should not feel like a generic chat assistant was inserted into settlement.

## Important UI States To Mock And Verify

### 1. Clean Vs Deal

Example: `show_0017`.

Expected behavior:

- Interpreter identifies a standard Vs net deal.
- No unnecessary confirmations.
- Worksheet appears.
- Guarantee vs percentage comparison is visible.
- Expense cap math is visible.

### 2. Coastal Spell Recoup Ambiguity

Example: `show_coastal_spell_dispute`.

Expected behavior:

- Interpreter extracts `$900 marketing recoup`.
- Confirmation asks whether recoup is inside or outside expense cap.
- Worksheet is locked until answered.
- UI shows the $720 impact.
- Disputed recoup is clearly visible.
- Existing sign-off and notes remain visible.

### 3. Ratchet Deal

Example: a Vs deal with `tier_ratchet` in `bonuses_json` or prose.

Expected behavior:

- Interpreter extracts tier language.
- Confirmation asks whether higher percentage applies to all net or only dollars above threshold.
- Calculation stays locked until confirmed, then calculates the ratcheted percentage side.

### 4. Walkout Pot Deal

Example: a deal note containing `walkout`.

Expected behavior:

- Interpreter extracts walkout language and threshold if present.
- UI asks how threshold/breakeven is defined.
- Calculation stays locked until confirmed, then adds the walkout pot as a separate worksheet line.

### 5. Door Deal

Example: any `door` deal.

Expected behavior:

- Interpreter extracts door split or available waterfall terms.
- Confirmation asks what comes off before split:
  - fees
  - expenses
  - house nut
  - support payout
- Calculation only runs for simple confirmed door structures.

### 6. Existing Flat And Percent Gross Deals

Expected behavior:

- Existing settlement math still works.
- Interpreter appears above the worksheet.
- Prose-only bonuses ask for confirmation before an authoritative payout is shown.

## Deal-Type Requirements

### Flat

Calculate when:

- guarantee is known
- no blocking bonus ambiguity exists

Flag when:

- prose mentions bonus terms missing from `bonuses_json`
- sign-off and status conflict

### Percentage Of Gross

Calculate when:

- percentage is known
- basis is clearly gross

Support/flag when:

- comps count toward gross and are included in the deterministic gross basis
- prose says gross but structured basis differs
- bonus terms are ambiguous

### Percentage Of Net

Calculate when:

- percentage is known
- net basis is clear
- expense cap and pass-through expenses are clear

Confirm when:

- net could mean after fees only vs after fees and expenses
- recoups affect net
- expenses are capped but categories are unclear

### Vs Deal

Calculate when:

- guarantee is known
- percentage is known
- basis is gross or net
- expense/fee treatment is clear
- ratchet, walkout, recoup, and prose-only bonus assumptions are confirmed

Show:

- guarantee side
- percentage side
- winner
- expense cap treatment

### Door Deal

Calculate only for simple confirmed door formulas.

Confirm when:

- split is unclear
- fees/expenses/house nut ordering is unclear
- support payout or promoter split appears

### Ratchets

Extract:

- threshold
- base percentage
- higher percentage
- whether threshold appears attendance-based, capacity-based, gross-based, or net-based

Confirm:

- higher percentage applies to all basis or marginal dollars only
- threshold basis

Default behavior:

- Do not silently calculate if confirmation is missing.

### Walkout Pots

Extract:

- threshold language
- breakeven language
- stack/additive language
- percentage of upside

Confirm:

- threshold definition
- whether it stacks on top of the Vs calculation
- whether threshold is gross, net, guarantee plus expenses, or house nut

Default behavior:

- Do not silently calculate if confirmation is missing.

### Recoups

Extract:

- category
- label
- amount
- status
- source language

Confirm when ambiguous:

- inside expense cap vs outside expense cap
- deducted before artist percentage vs after artist percentage
- included in expenses vs separate deduction

Always flag:

- disputed recoups
- withdrawn recoups
- recoup category/status mismatch

## Technical Design

### Stateless Demo State

The reviewer-facing fork should not write confirmation data into SQLite. A reviewer should be able to click through scenarios locally without leaving the repo database in a changed state.

Implementation:

- Generate the interpretation draft on the server for each settlement request.
- Store demo confirmation answers in URL query params like `confirm:recoup-cap-treatment=inside_expense_cap`.
- Parse those query params back into `ConfirmationAnswer[]`.
- Recompute readiness and calculation from the current URL state.
- Provide a `Reset demo` link that clears query params.

This sacrifices durable persistence for review friendliness. In production, these answers should become persisted audit artifacts.

### Extraction Flow

Function:

```text
draftStructuredDeal(input) -> StructuredDealDraft
```

Input:

- deal
- ticket sales
- expenses
- comps
- recoups
- settlement
- venue capacity

Output:

- terms
- source snippets
- confirmation questions
- risks
- readiness
- extractor mode

Extractor mode:

- `llm`
- `local_fallback`

### Optional LLM Path

If `OPENAI_API_KEY` exists:

- call server-side extractor
- never expose the key to browser code
- LLM returns structured terms and confirmation questions
- LLM must not return final payout

If no key exists:

- use deterministic fallback
- cover seeded demo patterns
- mark uncertain terms for confirmation

### Source Hash

Create a source hash from:

- deal notes
- structured deal fields
- bonuses JSON
- recoups JSON
- comp count/gross flags
- settlement status/sign-off

The source hash is shown for traceability. The MVP no longer caches drafts in SQLite because the reviewer demo should avoid writes.

### Confirmation Answers

Confirmation answers are represented by:

- question id
- selected option value
- selected option label

When a question is answered:

- update the URL query string
- recompute readiness and calculation

### Calculation Flow

Function:

```text
calculateConfirmedSettlement(draft, answers, financialInputs) -> SettlementCalculationResult
```

Rules:

- consume normalized confirmed terms only
- never parse raw prose inside calculation
- block authoritative payout if blocking confirmations are unanswered
- return locked state with reasons when not calculable

## Suggested Type Shape

```ts
type SettlementReadiness =
  | "ready_to_calculate"
  | "needs_confirmation"
  | "unsupported_formula"
  | "risk_flagged";

type ExtractorMode = "llm" | "local_fallback";

type StructuredDealDraft = {
  dealType: string;
  readiness: SettlementReadiness;
  extractorMode: ExtractorMode;
  terms: DraftTerm[];
  confirmationQuestions: ConfirmationQuestion[];
  risks: DealRisk[];
};

type DraftTerm = {
  id: string;
  label: string;
  value: string;
  normalizedValue?: string | number | boolean;
  status: "confirmed" | "needs_confirmation" | "inferred" | "unsupported";
  sourceText?: string;
};

type ConfirmationQuestion = {
  id: string;
  field: string;
  severity: "blocking" | "review";
  question: string;
  whyItMatters: string;
  sourceText?: string;
  payoutImpactCents?: number;
  options: ConfirmationOption[];
};

type ConfirmationOption = {
  value: string;
  label: string;
  description?: string;
};

type DealRisk = {
  id: string;
  severity: "info" | "warning" | "blocking";
  label: string;
  detail: string;
};
```

## Work Tracker

### Planning

- [x] Capture product thesis.
- [x] Define all-deal workflow.
- [x] Define confirmation-gated calculation model.
- [x] Define UI states and requirements.
- [x] Define stateless reviewer interaction requirements.
- [x] Review this document with user.

### Stateless Demo State

- [x] Remove runtime SQLite writes for interpretation and confirmations.
- [x] Generate interpretation drafts on request.
- [x] Parse confirmation answers from URL query params.
- [x] Preserve prior answers when applying another confirmation.
- [x] Add reset link to clear demo state.

### Extraction

- [x] Add shared types.
- [x] Add source hash helper.
- [x] Add deterministic fallback extractor.
- [x] Add optional server-side LLM extractor.
- [x] Ensure app works without `OPENAI_API_KEY`.
- [x] Ensure LLM never produces final payout.

### Calculation

- [x] Add confirmation-gated calculator.
- [x] Support flat.
- [x] Support percentage of gross.
- [x] Support percentage of net when confirmed.
- [x] Support standard Vs net/gross.
- [x] Support simple confirmed door deals.
- [x] Support simple bonuses.
- [x] Support confirmed recoup treatments.
- [x] Support confirmed ratchets and walkout pots.
- [x] Include comp tickets that count toward gross in deterministic gross.
- [x] Ask a blocking confirmation for prose-only bonus language.

### UI

- [x] Replace unsupported card with Deal Interpreter card.
- [x] Show interpreter on all settlement pages.
- [x] Add interpreted terms section.
- [x] Add confirmation checklist section.
- [x] Add locked worksheet state.
- [x] Add ready worksheet state.
- [x] Add Vs guarantee-vs-percentage comparison.
- [x] Keep lifecycle, recoups, and sign-off sections.
- [x] Make Coastal Spell ambiguity obvious.

### Validation

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Verify clean Vs deal.
- [x] Verify Coastal Spell blocks until recoup treatment is answered.
- [x] Verify answer unlocks via URL state without a database write.
- [x] Verify ratchet confirmation.
- [x] Verify ratchet calculation after confirmation.
- [x] Verify walkout calculation after confirmation.
- [x] Verify door confirmation.
- [x] Verify no seeded settlement remains unsupported after explicit confirmations.
- [x] Verify flat and percent gross pages still work.
- [x] Verify no API key is required.

### Case Study Deliverables

- [x] Update memo with slice and trade-offs.
- [x] Add Loom walkthrough outline.
- [x] Mention optional LLM path and local fallback.
- [x] Explain why deterministic calculation preserves trust.

## Implementation Notes

- Reviewer interactions are stateless. Confirmation answers live in URL query params and are not written to SQLite.
- `draftStructuredDeal` runs on request and uses the local fallback unless a server-side `OPENAI_API_KEY` is available.
- The LLM path only returns structured terms, questions, risks, and readiness. It never returns the payable artist total.
- `calculateConfirmedSettlement` consumes interpreted terms plus URL-supplied answers. It locks missing confirmations and only falls back to captured-but-unsupported when a future formula is outside the deterministic engine.
- The fallback extractor covers seeded demo patterns for flat, percentage of gross, percentage of net, Vs net/gross, door, recoups, ratchets, walkout pots, bonuses, comp gross treatment, and status/sign-off mismatch.
- Route checks covered `show_0017`, `show_coastal_spell_dispute`, `show_0038`, `show_0258`, `show_0018`, `show_0446`, and `show_0163`.

## Acceptance Criteria

- The planning doc exists and can guide implementation without more product decisions.
- The implementation does not write reviewer interaction data into SQLite.
- Reviewers can understand why the prototype interprets all deals but calculates only safe/confirmed deals.
- Coastal Spell is clearly represented as the canonical recoup ambiguity.
- The current unsupported-card area is explicitly identified as the UI anchor for the new workflow.
