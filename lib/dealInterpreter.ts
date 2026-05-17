import { createHash } from "crypto";
import type {
  Bonus,
  Comp,
  Deal,
  Expense,
  Recoup,
  Settlement,
  TicketSale,
} from "@/db/schema";
import { parseBonuses } from "@/lib/dealMath";

export type SettlementReadiness =
  | "ready_to_calculate"
  | "needs_confirmation"
  | "unsupported_formula"
  | "risk_flagged";

export type ExtractorMode = "llm" | "local_fallback";

export type DraftTermStatus =
  | "confirmed"
  | "needs_confirmation"
  | "inferred"
  | "unsupported";

export type DraftTerm = {
  id: string;
  label: string;
  value: string;
  normalizedValue?: string | number | boolean;
  status: DraftTermStatus;
  sourceText?: string;
};

export type ConfirmationOption = {
  value: string;
  label: string;
  description?: string;
};

export type ConfirmationQuestion = {
  id: string;
  field: string;
  severity: "blocking" | "review";
  question: string;
  whyItMatters: string;
  sourceText?: string;
  payoutImpactCents?: number;
  options: ConfirmationOption[];
};

export type DealRisk = {
  id: string;
  severity: "info" | "warning" | "blocking";
  label: string;
  detail: string;
};

export type StructuredDealDraft = {
  dealType: Deal["dealType"];
  readiness: SettlementReadiness;
  extractorMode: ExtractorMode;
  sourceHash: string;
  terms: DraftTerm[];
  confirmationQuestions: ConfirmationQuestion[];
  risks: DealRisk[];
  features: {
    hasRatchet: boolean;
    hasWalkout: boolean;
    hasRecoupAmbiguity: boolean;
    hasDoorWaterfall: boolean;
    basis: "gross" | "net" | "door" | "flat" | "unknown";
  };
};

export type ConfirmationAnswer = {
  questionId: string;
  selectedValue: string;
  selectedLabel: string;
};

export type FinancialInputs = {
  grossBoxOffice: number;
  ticketGross: number;
  totalFees: number;
  ticketCount: number;
  compGrossValue: number;
  passedThroughExpenses: number;
  absorbedExpenses: number;
  compTicketsCountingTowardGross: number;
};

export type ConfirmedSettlementCalculation =
  | {
      status: "ready";
      readiness: "ready_to_calculate" | "risk_flagged";
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      expenseCapApplied: number;
      totalToArtist: number;
      finalFormula: string;
      steps: { label: string; value: number; note?: string }[];
      comparison?: {
        guarantee: number;
        percentagePayout: number;
        winner: "guarantee" | "percentage";
      };
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
    }
  | {
      status: "locked";
      readiness: "needs_confirmation";
      reason: string;
      missingQuestionIds: string[];
    }
  | {
      status: "unsupported";
      readiness: "unsupported_formula" | "risk_flagged";
      reason: string;
    };

export interface DealInterpreterInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  comps: Comp[];
  recoups: Recoup[];
  settlement: Settlement | null;
  venueCapacity?: number;
}

export function calculateFinancialInputs(
  input: Pick<DealInterpreterInput, "ticketSales" | "expenses" | "comps">,
): FinancialInputs {
  const ticketGross = input.ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const grossCountingComps = input.comps.filter((c) => c.countsTowardGross);
  const compGrossValue = grossCountingComps.reduce(
    (sum, c) => sum + c.count * c.faceValue,
    0,
  );

  return {
    grossBoxOffice: ticketGross + compGrossValue,
    ticketGross,
    totalFees: input.ticketSales.reduce((sum, t) => sum + t.fees, 0),
    ticketCount: input.ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0),
    compGrossValue,
    passedThroughExpenses: input.expenses
      .filter((e) => !e.absorbedByVenue)
      .reduce((sum, e) => sum + e.amount, 0),
    absorbedExpenses: input.expenses
      .filter((e) => e.absorbedByVenue)
      .reduce((sum, e) => sum + e.amount, 0),
    compTicketsCountingTowardGross: grossCountingComps.reduce(
      (sum, c) => sum + c.count,
      0,
    ),
  };
}

export function buildSourceHash(input: DealInterpreterInput): string {
  const stable = JSON.stringify({
    deal: {
      id: input.deal.id,
      dealType: input.deal.dealType,
      guaranteeAmount: input.deal.guaranteeAmount,
      percentage: input.deal.percentage,
      percentageBasis: input.deal.percentageBasis,
      expenseCap: input.deal.expenseCap,
      hospitalityCap: input.deal.hospitalityCap,
      bonusesJson: input.deal.bonusesJson,
      dealNotesFreetext: input.deal.dealNotesFreetext,
    },
    recoups: input.recoups,
    comps: input.comps.map((c) => ({
      category: c.category,
      count: c.count,
      faceValue: c.faceValue,
      countsTowardGross: c.countsTowardGross,
      notes: c.notes,
    })),
    settlement: {
      status: input.settlement?.status,
      signoffText: input.settlement?.signoffText,
      notes: input.settlement?.notes,
    },
  });
  return createHash("sha256").update(stable).digest("hex");
}

export async function draftStructuredDeal(
  input: DealInterpreterInput,
): Promise<StructuredDealDraft> {
  const fallback = draftStructuredDealLocally(input);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const llmDraft = await draftStructuredDealWithLlm(input, fallback);
    return llmDraft ?? fallback;
  } catch {
    return fallback;
  }
}

export function draftStructuredDealLocally(
  input: DealInterpreterInput,
): StructuredDealDraft {
  const { deal, recoups, settlement } = input;
  const notes = deal.dealNotesFreetext ?? "";
  const lower = notes.toLowerCase();
  const bonuses = parseBonuses(deal);
  const financials = calculateFinancialInputs(input);
  const sourceHash = buildSourceHash(input);

  const hasRatchet =
    lower.includes("ratchet") ||
    lower.includes("tiered") ||
    bonuses.some((b) => b.type === "tier_ratchet");
  const hasWalkout = lower.includes("walkout");
  const noteMentionsRecoup = lower.includes("recoup");
  const hasProseOnlyBonus = !deal.bonusesJson && /(\+\$|bonus|sellout|over \$|\bgross >)/i.test(notes);
  const recoupTotal = recoups.reduce((sum, r) => sum + r.amount, 0);
  const hasRecoupAmbiguity = noteMentionsRecoup || recoups.some((r) => r.status === "disputed");
  const hasDoorWaterfall = deal.dealType === "door";
  const basis = inferBasis(deal, lower);

  const terms: DraftTerm[] = [
    {
      id: "deal-type",
      label: "Deal type",
      value: friendlyDealType(deal.dealType),
      normalizedValue: deal.dealType,
      status: deal.dealNotesFreetext ? "inferred" : "confirmed",
      sourceText: findSnippet(notes, deal.dealType === "vs" ? "vs" : deal.dealType),
    },
  ];

  if (deal.guaranteeAmount != null) {
    terms.push({
      id: "guarantee",
      label: "Guarantee",
      value: money(deal.guaranteeAmount),
      normalizedValue: deal.guaranteeAmount,
      status: "confirmed",
      sourceText: findMoneySnippet(notes, deal.guaranteeAmount),
    });
  }

  if (deal.percentage != null) {
    terms.push({
      id: "artist-share",
      label: "Artist share",
      value: `${Math.round(deal.percentage * 100)}%`,
      normalizedValue: deal.percentage,
      status: "confirmed",
      sourceText: findPercentSnippet(notes, deal.percentage),
    });
  }

  terms.push({
    id: "basis",
    label: "Basis",
    value: basisLabel(basis),
    normalizedValue: basis,
    status: basis === "unknown" ? "needs_confirmation" : "inferred",
    sourceText:
      basis === "gross"
        ? findSnippet(notes, "gross")
        : basis === "net"
          ? findSnippet(notes, "net")
          : basis === "door"
            ? findSnippet(notes, "door")
            : undefined,
  });

  if (deal.expenseCap != null) {
    terms.push({
      id: "expense-cap",
      label: "Expense cap",
      value: money(deal.expenseCap),
      normalizedValue: deal.expenseCap,
      status: "confirmed",
      sourceText: findMoneySnippet(notes, deal.expenseCap) ?? findSnippet(notes, "expenses"),
    });
  }

  if (deal.hospitalityCap != null) {
    terms.push({
      id: "hospitality-cap",
      label: "Hospitality cap",
      value: money(deal.hospitalityCap),
      normalizedValue: deal.hospitalityCap,
      status: "confirmed",
      sourceText: findSnippet(notes, "hosp") ?? findSnippet(notes, "hospitality"),
    });
  }

  for (const bonus of bonuses) {
    terms.push({
      id: `bonus-${terms.length}`,
      label: bonusLabel(bonus),
      value: bonusTermValue(bonus),
      status: bonus.type === "tier_ratchet" ? "needs_confirmation" : "confirmed",
      sourceText: bonus.label,
    });
  }

  if (hasWalkout) {
    terms.push({
      id: "walkout-pot",
      label: "Walkout pot",
      value: findSnippet(notes, "walkout") ?? "Walkout language found",
      status: "needs_confirmation",
      sourceText: findSnippet(notes, "walkout"),
    });
  }

  if (hasProseOnlyBonus) {
    terms.push({
      id: "prose-only-bonus",
      label: "Performance bonus",
      value: findSnippet(notes, "bonus") ?? "Bonus language found in notes",
      status: "needs_confirmation",
      sourceText: findSnippet(notes, "bonus") ?? findSnippet(notes, "sellout"),
    });
  }

  for (const recoup of recoups) {
    terms.push({
      id: `recoup-${recoup.id}`,
      label: `${titleCase(recoup.category.replace(/_/g, " "))} recoup`,
      value: `${money(recoup.amount)} · ${recoup.status}`,
      normalizedValue: recoup.amount,
      status:
        recoup.status === "disputed" || noteMentionsRecoup
          ? "needs_confirmation"
          : "confirmed",
      sourceText: findSnippet(notes, "recoup") ?? recoup.label,
    });
  }

  const questions: ConfirmationQuestion[] = [];

  if (hasRecoupAmbiguity && recoupTotal > 0) {
    const pct = deal.percentage ?? 1;
    questions.push({
      id: "recoup-cap-treatment",
      field: "recoups.capTreatment",
      severity: "blocking",
      question: `How should the ${money(recoupTotal)} recoup be treated?`,
      sourceText: findSnippet(notes, "recoup") ?? recoups.map((r) => r.label).join(", "),
      whyItMatters:
        "This changes whether the recoup is already inside the expense cap or deducted in addition to capped expenses.",
      payoutImpactCents: Math.round(recoupTotal * pct * 100),
      options: [
        {
          value: "inside_expense_cap",
          label: "Included inside expense cap",
          description: "The recoup counts toward the capped expense bucket.",
        },
        {
          value: "outside_expense_cap",
          label: "Deducted in addition to expense cap",
          description: "The recoup is a separate deduction before the artist percentage.",
        },
        {
          value: "ask_agent",
          label: "Not sure / ask agent",
          description: "Keep the settlement locked until this is clarified in writing.",
        },
      ],
    });
  }

  if (hasRatchet) {
    questions.push({
      id: "ratchet-application",
      field: "ratchets.applicationMode",
      severity: "blocking",
      question: "How does the ratchet percentage apply?",
      sourceText: findSnippet(notes, "ratchet") ?? findSnippet(notes, "tiered"),
      whyItMatters:
        "Ratchets can apply the higher percentage to the whole settlement basis or only to dollars above the threshold.",
      options: [
        {
          value: "whole_basis",
          label: "Higher % applies to whole basis",
          description: "Once threshold is hit, recalculate the full basis at the higher percentage.",
        },
        {
          value: "marginal_only",
          label: "Higher % applies only above threshold",
          description: "Base percentage applies below threshold; higher percentage applies only above it.",
        },
        {
          value: "ask_agent",
          label: "Not sure / ask agent",
          description: "Keep the settlement locked until confirmed.",
        },
      ],
    });
  }

  if (hasWalkout) {
    questions.push({
      id: "walkout-threshold",
      field: "walkout.thresholdDefinition",
      severity: "blocking",
      question: "What defines the walkout pot threshold?",
      sourceText: findSnippet(notes, "walkout"),
      whyItMatters:
        "Walkout pots can be based on gross, net, guarantee plus expenses, or a negotiated house nut.",
      options: [
        {
          value: "gross_threshold",
          label: "Gross threshold",
          description: "The pot starts after a stated gross box office number.",
        },
        {
          value: "breakeven_nut",
          label: "Guarantee plus expenses / house nut",
          description: "The pot starts after the venue clears the agreed nut.",
        },
        {
          value: "ask_agent",
          label: "Not sure / ask agent",
          description: "Keep the settlement locked until confirmed.",
        },
      ],
    });
  }

  if (hasDoorWaterfall) {
    questions.push({
      id: "door-waterfall",
      field: "door.waterfall",
      severity: "blocking",
      question: "What comes off the door before the artist gets paid?",
      sourceText: findSnippet(notes, "Door deal") ?? notes,
      whyItMatters:
        "Door deals vary on whether fees, capped expenses, house nut, and support payouts come out before the artist split.",
      options: [
        {
          value: "gross_minus_fees_and_capped_expenses",
          label: "Fees + capped expenses",
          description: "Artist gets ticket revenue after fees and capped expenses.",
        },
        {
          value: "gross_minus_capped_expenses",
          label: "Capped expenses only",
          description: "Artist gets ticket revenue after capped expenses; fees are not deducted.",
        },
        {
          value: "ask_agent",
          label: "Not sure / ask agent",
          description: "Keep the settlement locked until confirmed.",
        },
      ],
    });
  }

  if (hasProseOnlyBonus) {
    questions.push({
      id: "prose-only-bonus-treatment",
      field: "bonuses.proseOnlyTreatment",
      severity: "blocking",
      question: "Do any prose-only performance bonuses need to be applied?",
      sourceText: findSnippet(notes, "bonus") ?? findSnippet(notes, "sellout"),
      whyItMatters:
        "The notes mention bonus language, but no structured amount or threshold exists for deterministic calculation.",
      options: [
        {
          value: "none_triggered",
          label: "No triggered bonus",
          description: "Proceed with no additional bonus payout for this settlement.",
        },
        {
          value: "ask_agent",
          label: "Not sure / ask agent",
          description: "Keep the settlement locked until the bonus memo is confirmed.",
        },
      ],
    });
  }

  const risks: DealRisk[] = [];

  for (const recoup of recoups) {
    if (recoup.status === "disputed") {
      risks.push({
        id: `disputed-recoup-${recoup.id}`,
        severity: "blocking",
        label: "Disputed recoup",
        detail: `${recoup.label} is marked disputed at ${money(recoup.amount)}.`,
      });
    } else if (recoup.status === "withdrawn") {
      risks.push({
        id: `withdrawn-recoup-${recoup.id}`,
        severity: "warning",
        label: "Withdrawn recoup",
        detail: `${recoup.label} was withdrawn and should not affect payout.`,
      });
    }
  }

  if (financials.compTicketsCountingTowardGross > 0) {
    risks.push({
      id: "comps-count-toward-gross",
      severity: "warning",
      label: "Comps count toward gross",
      detail: `${financials.compTicketsCountingTowardGross} comp tickets are marked as counting toward gross.`,
    });
  }

  if (
    settlement?.status === "disputed" &&
    settlement.signoffText &&
    /looks good|ok|sign off|wire|👍/i.test(settlement.signoffText)
  ) {
    risks.push({
      id: "disputed-with-positive-signoff",
      severity: "warning",
      label: "Disputed after positive sign-off",
      detail:
        "The settlement status is disputed, but the artist-team sign-off text reads positive. This likely changed after the 2am walkthrough.",
    });
  }

  if (deal.dealType !== "vs" && /\bvs\b|versus/i.test(notes)) {
    risks.push({
      id: "structured-prose-conflict",
      severity: "warning",
      label: "Structured type conflicts with prose",
      detail: `Structured deal type is ${friendlyDealType(deal.dealType)}, but the note contains Vs language.`,
    });
  }

  if (hasProseOnlyBonus) {
    risks.push({
      id: "prose-only-bonus",
      severity: "warning",
      label: "Bonus only appears in prose",
      detail:
        "The notes mention bonus language, but no structured bonus is present for deterministic evaluation.",
    });
  }

  const readiness = computeDraftReadiness({
    questions,
    risks,
  });

  return {
    dealType: deal.dealType,
    readiness,
    extractorMode: "local_fallback",
    sourceHash,
    terms,
    confirmationQuestions: questions,
    risks,
    features: {
      hasRatchet,
      hasWalkout,
      hasRecoupAmbiguity,
      hasDoorWaterfall,
      basis,
    },
  };
}

export function calculateConfirmedSettlement(
  input: DealInterpreterInput,
  draft: StructuredDealDraft,
  answers: ConfirmationAnswer[],
): ConfirmedSettlementCalculation {
  const missing = missingBlockingQuestions(draft, answers);
  if (missing.length > 0) {
    return {
      status: "locked",
      readiness: "needs_confirmation",
      reason: `${missing.length} confirmation${missing.length === 1 ? "" : "s"} required before this payout is authoritative.`,
      missingQuestionIds: missing,
    };
  }

  const answerMap = new Map(answers.map((a) => [a.questionId, a.selectedValue]));
  const { deal, recoups, venueCapacity } = input;
  const financials = calculateFinancialInputs(input);
  const parsedBonuses = parseBonuses(deal);
  const simpleBonuses = parsedBonuses.filter(
    (bonus) => bonus.type !== "tier_ratchet" && !isWalkoutBonus(bonus),
  );
  const bonuses = evaluateSimpleBonuses(simpleBonuses, {
    gross: financials.grossBoxOffice,
    tickets: financials.ticketCount,
    capacity: venueCapacity,
  });
  const recoupTreatment = answerMap.get("recoup-cap-treatment");
  const activeRecoupTotal = recoups
    .filter((r) => r.status !== "withdrawn")
    .reduce((sum, r) => sum + r.amount, 0);

  const expenseDeduction = computeExpenseDeduction({
    deal,
    passedThroughExpenses: financials.passedThroughExpenses,
    activeRecoupTotal,
    recoupTreatment,
  });
  const recoupDeduction =
    recoupTreatment === "outside_expense_cap" ? activeRecoupTotal : 0;
  const netAfterFees = financials.grossBoxOffice - financials.totalFees;
  const netAfterExpenses = netAfterFees - expenseDeduction - recoupDeduction;
  const readiness = draft.risks.length > 0 ? "risk_flagged" : "ready_to_calculate";

  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return unsupported("Flat deal is missing a guarantee amount.");
    }
    const totalToArtist = deal.guaranteeAmount + bonuses.totalApplied;
    return readyResult({
      readiness,
      financials,
      expenseDeduction: 0,
      totalExpenses: financials.passedThroughExpenses,
      totalToArtist,
      finalFormula: "flat guarantee + triggered bonuses",
      steps: [
        { label: "Flat guarantee", value: deal.guaranteeAmount },
        ...bonusSteps(bonuses.applied),
      ],
      bonuses,
    });
  }

  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return unsupported("Percentage-of-gross deal is missing a percentage.");
    }
    const percentage = calculatePercentagePayout({
      deal,
      basis: financials.grossBoxOffice,
      basisKind: "gross",
      financials,
      venueCapacity,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!percentage.supported) return unsupported(percentage.reason);
    const walkout = calculateWalkoutPot({
      deal,
      financials,
      expenseDeduction,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!walkout.supported) return unsupported(walkout.reason);
    const totalToArtist = percentage.payout + walkout.amount + bonuses.totalApplied;
    return readyResult({
      readiness,
      financials,
      expenseDeduction: 0,
      totalExpenses: financials.passedThroughExpenses,
      totalToArtist,
      finalFormula: `${percentage.formula}${walkout.amount > 0 ? " + walkout" : ""} + triggered bonuses`,
      steps: [
        { label: "Gross box office", value: financials.grossBoxOffice },
        ...compGrossSteps(financials),
        ...percentage.steps,
        ...walkout.steps,
        ...bonusSteps(bonuses.applied),
      ],
      bonuses,
    });
  }

  if (deal.dealType === "percentage_of_net") {
    if (deal.percentage == null) {
      return unsupported("Percentage-of-net deal is missing a percentage.");
    }
    const percentage = calculatePercentagePayout({
      deal,
      basis: netAfterExpenses,
      basisKind: "net",
      financials,
      venueCapacity,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!percentage.supported) return unsupported(percentage.reason);
    const walkout = calculateWalkoutPot({
      deal,
      financials,
      expenseDeduction,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!walkout.supported) return unsupported(walkout.reason);
    const totalToArtist = percentage.payout + walkout.amount + bonuses.totalApplied;
    return readyResult({
      readiness,
      financials,
      expenseDeduction,
      totalExpenses: financials.passedThroughExpenses,
      totalToArtist,
      finalFormula: `${percentage.formula}${walkout.amount > 0 ? " + walkout" : ""} + triggered bonuses`,
      steps: netSteps({
        financials,
        deal,
        expenseDeduction,
        recoupDeduction,
        netAfterExpenses,
        payout: percentage.payout,
        percentage: deal.percentage,
        bonuses,
        percentageSteps: percentage.steps,
      }).concat(walkout.steps),
      bonuses,
    });
  }

  if (deal.dealType === "vs") {
    if (deal.guaranteeAmount == null || deal.percentage == null) {
      return unsupported("Vs deal is missing a guarantee or percentage.");
    }
    const basis =
      draft.features.basis === "gross"
        ? financials.grossBoxOffice
        : netAfterExpenses;
    const percentage = calculatePercentagePayout({
      deal,
      basis,
      basisKind: draft.features.basis === "gross" ? "gross" : "net",
      financials,
      venueCapacity,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!percentage.supported) return unsupported(percentage.reason);
    const walkout = calculateWalkoutPot({
      deal,
      financials,
      expenseDeduction,
      answerMap,
      bonuses: parsedBonuses,
    });
    if (!walkout.supported) return unsupported(walkout.reason);
    const percentagePayout = percentage.payout;
    const winner =
      deal.guaranteeAmount >= percentagePayout ? "guarantee" : "percentage";
    const basePayout = Math.max(deal.guaranteeAmount, percentagePayout);
    const totalToArtist = basePayout + walkout.amount + bonuses.totalApplied;
    return readyResult({
      readiness,
      financials,
      expenseDeduction,
      totalExpenses: financials.passedThroughExpenses,
      totalToArtist,
      finalFormula: `max(guarantee, ${percentage.formula})${walkout.amount > 0 ? " + walkout" : ""} + triggered bonuses`,
      steps: [
        ...(draft.features.basis === "gross"
            ? [
                {
                  label: "Gross basis",
                  value: financials.grossBoxOffice,
                  note: "Deal notes indicate gross basis with no expense deductions.",
                },
                ...compGrossSteps(financials),
              ]
            : netSteps({
              financials,
              deal,
              expenseDeduction,
              recoupDeduction,
              netAfterExpenses,
              payout: percentagePayout,
              percentage: deal.percentage,
              bonuses: { applied: [], notTriggered: [], totalApplied: 0 },
              percentageSteps: percentage.steps,
            })),
        {
          label: "Guarantee side",
          value: deal.guaranteeAmount,
          note: winner === "guarantee" ? "Winner" : undefined,
        },
        {
          label: percentage.label,
          value: percentagePayout,
          note: winner === "percentage" ? "Winner" : undefined,
        },
        ...walkout.steps,
        ...bonusSteps(bonuses.applied),
      ],
      comparison: {
        guarantee: deal.guaranteeAmount,
        percentagePayout,
        winner,
      },
      bonuses,
    });
  }

  if (deal.dealType === "door") {
    const waterfall = answerMap.get("door-waterfall");
    if (waterfall === "ask_agent" || !waterfall) {
      return {
        status: "locked",
        readiness: "needs_confirmation",
        reason: "Door waterfall needs confirmation before payout is authoritative.",
        missingQuestionIds: ["door-waterfall"],
      };
    }
    const basis =
      waterfall === "gross_minus_fees_and_capped_expenses"
        ? netAfterFees - expenseDeduction
        : financials.grossBoxOffice - expenseDeduction;
    const totalToArtist = Math.max(0, basis + bonuses.totalApplied);
    return readyResult({
      readiness,
      financials,
      expenseDeduction,
      totalExpenses: financials.passedThroughExpenses,
      totalToArtist,
      finalFormula:
        waterfall === "gross_minus_fees_and_capped_expenses"
          ? "door gross - fees - capped expenses"
          : "door gross - capped expenses",
      steps: [
        { label: "Gross box office", value: financials.grossBoxOffice },
        ...compGrossSteps(financials),
        ...(waterfall === "gross_minus_fees_and_capped_expenses"
          ? [{ label: "Ticketing fees", value: -financials.totalFees }]
          : []),
        {
          label: "Capped expenses",
          value: -expenseDeduction,
          note: capNote(deal, financials.passedThroughExpenses, expenseDeduction),
        },
        { label: "Door payout", value: totalToArtist },
      ],
      bonuses,
    });
  }

  return unsupported("This deal type is not supported by the deterministic calculator.");
}

export function missingBlockingQuestions(
  draft: StructuredDealDraft,
  answers: ConfirmationAnswer[],
): string[] {
  const answered = new Set(
    answers
      .filter((a) => a.selectedValue !== "ask_agent")
      .map((a) => a.questionId),
  );
  return draft.confirmationQuestions
    .filter((q) => q.severity === "blocking" && !answered.has(q.id))
    .map((q) => q.id);
}

function computeDraftReadiness({
  questions,
  risks,
}: {
  questions: ConfirmationQuestion[];
  risks: DealRisk[];
}): SettlementReadiness {
  if (questions.some((q) => q.severity === "blocking")) {
    return "needs_confirmation";
  }
  if (risks.length > 0) return "risk_flagged";
  return "ready_to_calculate";
}

async function draftStructuredDealWithLlm(
  input: DealInterpreterInput,
  fallback: StructuredDealDraft,
): Promise<StructuredDealDraft | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.2",
      input: [
        {
          role: "system",
          content:
            "Extract settlement deal terms as JSON. Do not calculate final payout. Preserve uncertainty as confirmation questions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            deal: input.deal,
            recoups: input.recoups,
            comps: input.comps,
            settlement: input.settlement,
            fallback,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "structured_deal_draft",
          schema: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    }),
  });

  if (!response.ok) return null;
  const json = await response.json();
  const text = extractResponseText(json);
  if (!text) return null;

  const parsed = JSON.parse(text) as Partial<StructuredDealDraft>;
  return {
    ...fallback,
    ...parsed,
    extractorMode: "llm",
    sourceHash: fallback.sourceHash,
    terms: Array.isArray(parsed.terms) ? parsed.terms : fallback.terms,
    confirmationQuestions: Array.isArray(parsed.confirmationQuestions)
      ? parsed.confirmationQuestions
      : fallback.confirmationQuestions,
    risks: Array.isArray(parsed.risks) ? parsed.risks : fallback.risks,
    features: {
      ...fallback.features,
      ...(parsed.features ?? {}),
    },
  };
}

function extractResponseText(json: unknown): string | null {
  if (
    typeof json === "object" &&
    json &&
    "output_text" in json &&
    typeof json.output_text === "string"
  ) {
    return json.output_text;
  }
  if (typeof json !== "object" || !json || !("output" in json)) return null;
  const output = (json as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (typeof item !== "object" || !item || !("content" in item)) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
    }
  }
  return null;
}

function readyResult({
  readiness,
  financials,
  expenseDeduction,
  totalExpenses,
  totalToArtist,
  finalFormula,
  steps,
  comparison,
  bonuses,
}: {
  readiness: "ready_to_calculate" | "risk_flagged";
  financials: FinancialInputs;
  expenseDeduction: number;
  totalExpenses: number;
  totalToArtist: number;
  finalFormula: string;
  steps: { label: string; value: number; note?: string }[];
  comparison?: {
    guarantee: number;
    percentagePayout: number;
    winner: "guarantee" | "percentage";
  };
  bonuses: ReturnType<typeof evaluateSimpleBonuses>;
}): Extract<ConfirmedSettlementCalculation, { status: "ready" }> {
  return {
    status: "ready",
    readiness,
    grossBoxOffice: financials.grossBoxOffice,
    netBoxOffice: financials.grossBoxOffice - financials.totalFees,
    totalExpenses,
    expenseCapApplied: expenseDeduction,
    totalToArtist: roundMoney(totalToArtist),
    finalFormula,
    steps: steps.map((s) => ({ ...s, value: roundMoney(s.value) })),
    comparison: comparison
      ? {
          ...comparison,
          guarantee: roundMoney(comparison.guarantee),
          percentagePayout: roundMoney(comparison.percentagePayout),
        }
      : undefined,
    bonusesApplied: bonuses.applied,
    bonusesNotTriggered: bonuses.notTriggered,
  };
}

function unsupported(
  reason: string,
): Extract<ConfirmedSettlementCalculation, { status: "unsupported" }> {
  return { status: "unsupported", readiness: "unsupported_formula", reason };
}

function computeExpenseDeduction({
  deal,
  passedThroughExpenses,
  activeRecoupTotal,
  recoupTreatment,
}: {
  deal: Deal;
  passedThroughExpenses: number;
  activeRecoupTotal: number;
  recoupTreatment?: string;
}) {
  if (deal.dealType === "flat" || deal.dealType === "percentage_of_gross") {
    return 0;
  }

  if (recoupTreatment === "inside_expense_cap") {
    return Math.min(
      deal.expenseCap ?? passedThroughExpenses + activeRecoupTotal,
      passedThroughExpenses + activeRecoupTotal,
    );
  }

  if (recoupTreatment === "outside_expense_cap" && deal.expenseCap != null) {
    return Math.min(deal.expenseCap, passedThroughExpenses);
  }

  return Math.min(deal.expenseCap ?? passedThroughExpenses, passedThroughExpenses);
}

function netSteps({
  financials,
  deal,
  expenseDeduction,
  recoupDeduction,
  netAfterExpenses,
  payout,
  percentage,
  bonuses,
  percentageSteps,
}: {
  financials: FinancialInputs;
  deal: Deal;
  expenseDeduction: number;
  recoupDeduction: number;
  netAfterExpenses: number;
  payout: number;
  percentage: number;
  bonuses: ReturnType<typeof evaluateSimpleBonuses>;
  percentageSteps?: { label: string; value: number; note?: string }[];
}) {
  return [
    { label: "Gross box office", value: financials.grossBoxOffice },
    ...(financials.compGrossValue > 0
      ? [
          {
            label: "Comp value counted toward gross",
            value: financials.compGrossValue,
            note: `${financials.compTicketsCountingTowardGross} comp tickets count toward gross for settlement.`,
          },
        ]
      : []),
    { label: "Ticketing fees", value: -financials.totalFees },
    {
      label: "Capped expenses",
      value: -expenseDeduction,
      note: capNote(deal, financials.passedThroughExpenses, expenseDeduction),
    },
    ...(recoupDeduction > 0
      ? [
          {
            label: "Recoup outside expense cap",
            value: -recoupDeduction,
            note: "Confirmed as an additional deduction before artist percentage.",
          },
        ]
      : []),
    { label: "Net basis", value: netAfterExpenses },
    ...(percentageSteps ?? [
      {
        label: `Artist share (${Math.round(percentage * 100)}%)`,
        value: payout,
      },
    ]),
    ...bonusSteps(bonuses.applied),
  ];
}

function capNote(deal: Deal, passedThroughExpenses: number, deduction: number) {
  if (deal.expenseCap == null) return "No expense cap stored.";
  if (deduction < passedThroughExpenses) {
    return `${money(passedThroughExpenses - deduction)} absorbed by venue because of the ${money(deal.expenseCap)} cap.`;
  }
  if (deduction > passedThroughExpenses) {
    return "Confirmed recoup is included inside the capped expense bucket.";
  }
  return `Capped at ${money(deal.expenseCap)}.`;
}

function compGrossSteps(financials: FinancialInputs) {
  if (financials.compGrossValue <= 0) return [];
  return [
    {
      label: "Comp value counted toward gross",
      value: financials.compGrossValue,
      note: `${financials.compTicketsCountingTowardGross} comp tickets count toward gross for settlement.`,
    },
  ];
}

function calculatePercentagePayout({
  deal,
  basis,
  basisKind,
  financials,
  venueCapacity,
  answerMap,
  bonuses,
}: {
  deal: Deal;
  basis: number;
  basisKind: "gross" | "net";
  financials: FinancialInputs;
  venueCapacity?: number;
  answerMap: Map<string, string>;
  bonuses: Bonus[];
}):
  | {
      supported: true;
      payout: number;
      label: string;
      formula: string;
      steps: { label: string; value: number; note?: string }[];
    }
  | { supported: false; reason: string } {
  const ratchet = bonuses.find(
    (bonus): bonus is Extract<Bonus, { type: "tier_ratchet" }> =>
      bonus.type === "tier_ratchet",
  );

  if (!ratchet) {
    if (deal.percentage == null) {
      return { supported: false, reason: "Percentage deal is missing a percentage." };
    }
    const payout = basis * deal.percentage;
    const pct = Math.round(deal.percentage * 100);
    return {
      supported: true,
      payout,
      label: `Percentage side (${pct}%)`,
      formula: `${basisKind} × ${pct}%`,
      steps: [{ label: `Artist share (${pct}%)`, value: payout }],
    };
  }

  const mode = answerMap.get("ratchet-application");
  if (mode === "ask_agent" || !mode) {
    return {
      supported: false,
      reason: "Ratchet application needs confirmation before payout is authoritative.",
    };
  }

  const sorted = [...ratchet.tiers].sort((a, b) => a.from - b.from);
  const baseTier = sorted[0];
  const upperTier = sorted[sorted.length - 1];
  const threshold = baseTier.to ?? upperTier.from;

  if (threshold == null) {
    return {
      supported: false,
      reason: "Ratchet threshold is missing.",
    };
  }

  const thresholdBasis = ratchetThresholdBasis({
    threshold,
    basis,
    financials,
    venueCapacity,
  });

  if (!thresholdBasis.supported) return thresholdBasis;

  const basePct = baseTier.percentage;
  const upperPct = upperTier.percentage;
  const baseLabel = Math.round(basePct * 100);
  const upperLabel = Math.round(upperPct * 100);

  if (!thresholdBasis.triggered) {
    const payout = basis * basePct;
    return {
      supported: true,
      payout,
      label: `Percentage side (${baseLabel}% base ratchet)`,
      formula: `${basisKind} × ${baseLabel}%`,
      steps: [
        {
          label: `Base ratchet share (${baseLabel}%)`,
          value: payout,
          note: `Ratchet not triggered: ${thresholdBasis.reason}.`,
        },
      ],
    };
  }

  if (mode === "whole_basis") {
    const payout = basis * upperPct;
    return {
      supported: true,
      payout,
      label: `Percentage side (${upperLabel}% ratchet)`,
      formula: `${basisKind} × ${upperLabel}%`,
      steps: [
        {
          label: `Ratchet share (${upperLabel}% whole basis)`,
          value: payout,
          note: `Ratchet triggered: ${thresholdBasis.reason}.`,
        },
      ],
    };
  }

  const basePortion = Math.min(basis, thresholdBasis.amount);
  const upperPortion = Math.max(0, basis - thresholdBasis.amount);
  const basePayout = basePortion * basePct;
  const upperPayout = upperPortion * upperPct;

  return {
    supported: true,
    payout: basePayout + upperPayout,
    label: `Percentage side (${baseLabel}%/${upperLabel}% marginal ratchet)`,
    formula: `${baseLabel}% below threshold + ${upperLabel}% above threshold`,
    steps: [
      {
        label: `Base tier (${baseLabel}%)`,
        value: basePayout,
        note: `${money(basePortion)} below ratchet threshold.`,
      },
      {
        label: `Ratchet tier (${upperLabel}%)`,
        value: upperPayout,
        note: `${money(upperPortion)} above ratchet threshold.`,
      },
    ],
  };
}

function ratchetThresholdBasis({
  threshold,
  basis,
  financials,
  venueCapacity,
}: {
  threshold: number;
  basis: number;
  financials: FinancialInputs;
  venueCapacity?: number;
}):
  | { supported: true; amount: number; triggered: boolean; reason: string }
  | { supported: false; reason: string } {
  if (threshold <= 1) {
    if (!venueCapacity) {
      return {
        supported: false,
        reason: "Ratchet threshold is capacity-based, but venue capacity is missing.",
      };
    }

    const thresholdTickets = Math.ceil(venueCapacity * threshold);
    const triggered = financials.ticketCount >= thresholdTickets;
    const proportionalBasis =
      financials.ticketCount > 0
        ? basis * Math.min(1, thresholdTickets / financials.ticketCount)
        : basis;

    return {
      supported: true,
      amount: proportionalBasis,
      triggered,
      reason: `${financials.ticketCount} tickets sold vs ${thresholdTickets} threshold`,
    };
  }

  return {
    supported: true,
    amount: threshold,
    triggered: basis >= threshold,
    reason: `${money(basis)} basis vs ${money(threshold)} threshold`,
  };
}

function calculateWalkoutPot({
  deal,
  financials,
  expenseDeduction,
  answerMap,
  bonuses,
}: {
  deal: Deal;
  financials: FinancialInputs;
  expenseDeduction: number;
  answerMap: Map<string, string>;
  bonuses: Bonus[];
}):
  | {
      supported: true;
      amount: number;
      steps: { label: string; value: number; note?: string }[];
    }
  | { supported: false; reason: string } {
  const walkoutBonus = bonuses.find(isWalkoutBonus);
  if (!walkoutBonus) return { supported: true, amount: 0, steps: [] };

  const thresholdMode = answerMap.get("walkout-threshold");
  if (thresholdMode === "ask_agent" || !thresholdMode) {
    return {
      supported: false,
      reason: "Walkout threshold needs confirmation before payout is authoritative.",
    };
  }

  const threshold =
    thresholdMode === "breakeven_nut"
      ? (deal.guaranteeAmount ?? 0) + expenseDeduction
      : walkoutBonus.threshold;
  const amount = Math.max(0, financials.grossBoxOffice - threshold);

  return {
    supported: true,
    amount,
    steps: [
      {
        label: "Walkout pot",
        value: amount,
        note:
          amount > 0
            ? thresholdMode === "breakeven_nut"
              ? `100% of gross above guarantee plus capped expenses (${money(threshold)}).`
              : `100% of gross above structured threshold (${money(threshold)}).`
            : `Gross did not clear the walkout threshold (${money(threshold)}).`,
      },
    ],
  };
}

function isWalkoutBonus(
  bonus: Bonus,
): bonus is Extract<Bonus, { type: "gross_threshold" }> {
  return bonus.type === "gross_threshold" && /walkout/i.test(bonus.label);
}

function evaluateSimpleBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} >= ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold`
              : "Capacity unknown",
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} >= ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else {
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Bonus type requires a confirmed deterministic rule.",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((sum, b) => sum + b.amount, 0),
  };
}

function bonusSteps(bonuses: { label: string; amount: number; reason: string }[]) {
  return bonuses.map((b) => ({
    label: b.label,
    value: b.amount,
    note: b.reason,
  }));
}

function inferBasis(deal: Deal, lowerNotes: string): StructuredDealDraft["features"]["basis"] {
  if (deal.dealType === "flat") return "flat";
  if (deal.dealType === "door") return "door";
  if (deal.percentageBasis) return deal.percentageBasis;
  if (/% of net|of net|after expenses|after fees|\bnet\b/.test(lowerNotes)) {
    return "net";
  }
  if (/% of gross|of gross|gross \(no expense/.test(lowerNotes)) {
    return "gross";
  }
  return "unknown";
}

function friendlyDealType(type: Deal["dealType"]) {
  const labels: Record<Deal["dealType"], string> = {
    flat: "Flat guarantee",
    percentage_of_gross: "Percentage of gross",
    percentage_of_net: "Percentage of net",
    vs: "Vs deal",
    door: "Door deal",
  };
  return labels[type];
}

function basisLabel(basis: StructuredDealDraft["features"]["basis"]) {
  const labels: Record<StructuredDealDraft["features"]["basis"], string> = {
    gross: "Gross box office",
    net: "Net after fees and capped expenses",
    door: "Door receipts waterfall",
    flat: "Flat guarantee",
    unknown: "Needs confirmation",
  };
  return labels[basis];
}

function bonusLabel(bonus: Bonus) {
  const labels: Record<Bonus["type"], string> = {
    gross_threshold: "Gross bonus",
    sellout: "Sellout bonus",
    attendance_threshold: "Attendance bonus",
    tier_ratchet: "Ratchet",
  };
  return labels[bonus.type];
}

function bonusTermValue(bonus: Bonus) {
  if (bonus.type === "tier_ratchet") return bonus.label;
  return `${money(bonus.amount)} · ${bonus.label}`;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

function findSnippet(notes: string, needle?: string) {
  if (!needle || !notes) return undefined;
  const index = notes.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return undefined;
  const start = Math.max(0, notes.lastIndexOf(".", index - 1) + 1);
  const nextPeriod = notes.indexOf(".", index);
  const end = nextPeriod >= 0 ? nextPeriod + 1 : notes.length;
  return notes.slice(start, end).trim();
}

function findPercentSnippet(notes: string, percentage: number) {
  const pct = Math.round(percentage * 100);
  return findSnippet(notes, `${pct}%`) ?? findSnippet(notes, `${pct}/`);
}

function findMoneySnippet(notes: string, amount: number) {
  const rounded = Math.round(amount);
  const withComma = rounded.toLocaleString("en-US");
  return findSnippet(notes, `$${withComma}`) ?? findSnippet(notes, String(rounded));
}

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
