# Greenroom Settlement Memo: Deal Interpreter + Explainable Vs Walkthrough

## Executive Summary

I chose a narrow settlement slice: use AI to draft structured deal terms from messy deal prose, then use deterministic code to calculate and explain standard Vs settlements. This is not an attempt to fix every settlement workflow. It is a targeted intervention at the point where Mariana currently leaves Greenroom for a spreadsheet: translating negotiated language into auditable settlement math.

The product thesis is simple: AI should extract ambiguity, humans should confirm intent, and deterministic code should calculate payout. That keeps the workflow useful at 2am without turning a money-moving process into a black box.

## Why This Slice

The highest-leverage failure is not that Greenroom lacks a calculator for every possible deal. It is that the system cannot reliably tell what the deal means. The repo makes this clear:

- Vs deals are the largest deal type in the database, but the current in-app calculator does not support them.
- `deal_notes_freetext` is the real source of truth, while structured fields are incomplete or inconsistently filled.
- Many "Vs deals" are not standard Vs deals. Some include gross-basis language, recoups, ratchets, walkout pots, or bonuses.
- Disputed statuses do not always mean the same thing. Some settlements show positive tour-manager signoff but later became disputed by an agent.
- Coastal Spell shows the core risk: "$900 marketing recoup against gross" was ambiguous enough to create a $720 concession and a WME relationship issue.

That is why I would not start with a universal settlement engine or an agent portal. Mariana first needs Greenroom to help her translate and confirm the deal before it presents a final number. If the system cannot distinguish a clean Vs deal from an ambiguous one, better math alone creates false confidence.

## Product Design

The prototype replaces the unsupported-deal dead end on `/shows/[id]/settle` with a Deal Interpreter and an explainable settlement worksheet.

The workflow:

1. Greenroom reads the structured deal fields, `deal_notes_freetext`, ticket sales, expenses, comps, settlement status, signoff text, and recoups.
2. The Deal Interpreter drafts structured terms from the prose: deal type, guarantee, percentage, basis, expense cap, hospitality cap, bonuses, recoups, and special structures.
3. Every extracted term shows source language so Mariana can trace where it came from.
4. Ambiguous terms become confirmation questions instead of hidden assumptions.
5. Only confirmed, supported terms flow into deterministic calculation.
6. The worksheet shows the math line by line: gross, fees, capped expenses, absorbed overage, net basis, percentage payout, guarantee comparison, bonuses, recoups, and final artist payout.

For a clean Vs deal, Mariana should get a fast answer and a walkthrough she can show the tour manager. For Coastal Spell, the system should refuse to present an authoritative payout until the marketing recoup treatment is confirmed. For ratchets and walkout pots, the system should surface the special structure and either ask for confirmation or mark it as not safe to calculate in the MVP.

## AI Design

The LLM is an interpreter, not a calculator.

It receives deal prose and returns a structured draft with source citations and ambiguity flags. It must not calculate final payout or invent missing fields. The local prototype should run without an API key using deterministic fallback extraction; if `OPENAI_API_KEY` exists, the same interface can call a server-side LLM route.

Agent prompt:

```text
You are Greenroom's Deal Note Interpreter for independent music venue settlements.

Your job is to translate messy deal prose into a structured draft that a human booker can review. You are not the source of truth, and you do not calculate final artist payout.

Rules:
1. Extract only terms that are explicitly present or strongly implied by the text.
2. Do not invent missing values.
3. For every extracted term, include the exact source phrase from the note.
4. If a phrase can be interpreted more than one way, mark it ambiguous.
5. If the deal includes ratchets, walkout pots, recoups, bonus tiers, or unusual deduction order, flag it for human review.
6. Return JSON only.
7. The deterministic settlement engine will calculate money only after human confirmation.

Output schema:
{
  "dealType": "flat" | "percentage_of_gross" | "percentage_of_net" | "vs" | "door" | "unknown",
  "guaranteeAmount": { "value": number | null, "source": string | null },
  "percentage": { "value": number | null, "source": string | null },
  "percentageBasis": { "value": "gross" | "net" | "door" | "unknown", "source": string | null },
  "expenseCap": { "value": number | null, "source": string | null },
  "hospitalityCap": { "value": number | null, "source": string | null },
  "bonuses": [],
  "recoups": [],
  "specialStructures": [],
  "ambiguities": [],
  "needsHumanReview": boolean,
  "confidence": "high" | "medium" | "low"
}
```

This design lets reviewers run the fork locally with no model dependency while still showing the applied-AI product direction. In production, we would add model evaluation on historical deal notes before trusting the extractor broadly.

## Design Choices And Trade-Offs

I chose confirmation over automation. At 2am, the fastest bad experience is a confident wrong number. The product should say "I need you to confirm this term" when the language affects payout.

I chose source snippets over a chat UI. Mariana does not need to chat with settlement math. She needs to point at a number and show where it came from. Source-backed extracted terms are more useful than a conversational assistant in the back office.

I chose deterministic calculation over LLM calculation. The final payout must be reproducible for Marcus, the tour manager, the agent, and finance. The LLM can draft terms, but Greenroom's settlement engine owns the money.

I chose local fallback over an API-key requirement. The hiring team must be able to run the fork immediately. A graceful fallback also demonstrates that the product concept is not dependent on one model provider.

I chose to expose uncertainty rather than collapse it. A recoup can be inside an expense cap, outside the cap, against gross, disputed, or withdrawn. The UI should make that visible rather than bury it in a generic expenses row.

## What I Cut

I cut agent collaboration and external sharing. An agent-facing preview is valuable, but it depends on first having confirmed structured terms and an explainable worksheet.

I cut payment, wire approval, and accounting reconciliation. Marcus needs better visibility, but the prototype should stop before money movement.

I cut a production-grade universal deal engine. The prototype can interpret every seeded deal family and can calculate flat, percentage-of-gross, percentage-of-net, Vs net/gross, simple confirmed door structures, confirmed ratchets, and confirmed walkout pots. What I did not build is open-ended support for every real-world waterfall an agent might write into prose. Unknown formulas and "ask agent" answers stay locked instead of producing a confident but unauditable payout.

I cut autonomous resolution of ambiguous language. The Coastal Spell lesson is that "marketing recoup against gross" can have two reasonable interpretations. The product should not pick one silently.

I cut database writes for confirmation in the prototype. Keeping confirmation answers local or URL-scoped is enough for the case study and avoids mutating seeded data. Production would persist confirmed terms with timestamps, source text, and reviewer identity.

## Validation Plan

Prototype validation should use seeded scenarios:

- Clean Vs net deal: calculates guarantee vs percentage payout and matches the recorded settlement.
- Vs gross deal: uses gross basis and does not deduct expenses from the percentage side.
- Coastal Spell: extracts the $900 marketing recoup, flags ambiguity, shows payout impact, and withholds authoritative payout until confirmed.
- Ratchet deal: detects tier language, asks how the higher percentage applies, and calculates only after confirmation.
- Walkout pot deal: detects walkout language, asks which threshold definition applies, and calculates only after confirmation.
- Door deal: asks which simple waterfall applies and calculates only after confirmation.
- Disputed status with positive signoff: surfaces the contradiction as settlement risk.
- Existing flat and percentage-of-gross deals: continue to calculate normally.

Production validation should track:

- Percentage of Vs deals settled in-app instead of spreadsheets.
- Time from show end to tour-manager signoff.
- Number of payout-impacting confirmation questions per settlement.
- Rate of next-day agent disputes.
- Frequency of "ask agent" or unresolved ambiguity choices.
- Difference between predicted settlement and final paid amount.

I would also create an evaluation set of historical deal notes with expected extracted terms, expected ambiguity flags, and expected confirmation questions. That eval set matters more than raw model accuracy because the product succeeds when it asks the right human question at the right time.

## What I Would Ship Next

Next I would persist confirmed structured terms as the canonical settlement snapshot. That snapshot should include the source phrase, who confirmed it, when they confirmed it, and whether the agent or tour manager saw it. From there, the agent-facing settlement statement becomes much stronger: not just "here is the final number," but "here is the agreed interpretation and every line behind the number."

After that, I would prioritize pre-show deal risk review. Mariana and Marcus both said many settlement fights are knowable days earlier. If Greenroom can flag ambiguous recoups, missing expense cap language, and special structures on Wednesday instead of Friday night, it can move the hardest settlement conversations out of the 2am room entirely.
