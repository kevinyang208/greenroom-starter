import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  AlertTriangle,
  Mail,
  Pencil,
  XCircle,
  Wallet,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { getShowById } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { StatusBadge, DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import {
  formatMoney,
  formatShowDateFull,
} from "@/lib/format";
import type { Settlement, Recoup } from "@/db/schema";
import { Logomark } from "@/components/brand/logo";
import {
  calculateConfirmedSettlement,
  draftStructuredDeal,
  missingBlockingQuestions,
  type ConfirmationAnswer,
  type ConfirmationQuestion,
  type ConfirmedSettlementCalculation,
  type DealRisk,
  type DraftTerm,
  type StructuredDealDraft,
} from "@/lib/dealInterpreter";

const RECOUP_LABELS: Record<Recoup["category"], string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

export default async function SettlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, deal, ticketSales, expenses, settlement, recoups } =
    data;

  if (!deal) {
    return (
      <div className="px-12 py-10 max-w-4xl">
        <BackLink showId={show.id} />
        <div className="text-[13px] text-ink-400">
          No deal entered for this show. Settlement can&apos;t run yet.
        </div>
      </div>
    );
  }

  const interpreterInput = {
    deal,
    ticketSales,
    expenses,
    comps: data.comps,
    recoups,
    settlement,
    venueCapacity: data.venue?.capacity ?? undefined,
  };
  const interpretationDraft = await draftStructuredDeal(interpreterInput);
  const confirmationAnswers = confirmationAnswersFromSearchParams(
    interpretationDraft,
    query,
  );
  const confirmationCalculation = calculateConfirmedSettlement(
    interpreterInput,
    interpretationDraft,
    confirmationAnswers,
  );

  const disputedRecoups = recoups.filter((r) => r.status === "disputed");
  const isDisputed = settlement?.status === "disputed" || settlement?.status === "revised" || !!settlement?.disputedAt;
  const disputedRecoupValue = disputedRecoups.reduce((s, r) => s + r.amount, 0);

  return (
    <div className={`px-12 py-10 max-w-7xl ${isDisputed ? "bg-gradient-to-b from-rose-50/30 via-canvas to-canvas" : ""}`}>
      <BackLink showId={show.id} />

      <div className="mb-20">
        <div className="flex items-center gap-1.5 mb-4">
          <StatusBadge status={show.status} />
          <DealTypeBadge type={deal.dealType} />
          {settlement?.status === "disputed" && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 ring-inset bg-rose-50 text-rose-800 ring-rose-200/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
              </span>
              Disputed
            </span>
          )}
          {settlement?.status === "voided" && (
            <PlainBadge variant="default">Voided</PlainBadge>
          )}
        </div>
        <h1 className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]" style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}>
          Settlement · {artist?.name}
        </h1>
        <div className="text-[14px] text-ink-400 mt-3">
          {formatShowDateFull(show.date)}
        </div>
      </div>

      {/* Disputed callout */}
      {isDisputed && disputedRecoupValue > 0 && (
        <div className="mb-8 rounded-lg border border-rose-200/60 bg-rose-50/40 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-rose-800">
              {disputedRecoups.length} recoup{disputedRecoups.length === 1 ? "" : "s"} in dispute · {formatMoney(disputedRecoupValue)} contested
            </div>
            <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
              The artist team has flagged recoup line items. This settlement cannot be finalized until the dispute is resolved.
            </p>
          </div>
        </div>
      )}

      {settlement && (
        <LifecycleBar settlement={settlement} disputedRecoups={disputedRecoups.length} />
      )}

      <div className="space-y-6 mt-6">
        <DealInterpreter
          showId={show.id}
          draft={interpretationDraft}
          answers={confirmationAnswers}
          calculation={confirmationCalculation}
          existingSettlement={settlement}
        />

        {recoups.length > 0 && <RecoupsSection recoups={recoups} />}

        {settlement && (settlement.signoffText || settlement.notes) && (
          <SignoffSection settlement={settlement} />
        )}
      </div>

      <div className="mt-16 pt-10 border-t border-ink-200/60">
        <div className="flex gap-4 items-start max-w-3xl">
          <Logomark size={40} className="shrink-0" />
          <div>
            <h2 className="font-display text-[20px] font-medium text-ink-900 mb-2" style={{ letterSpacing: "-0.02em" }}>
              You&apos;re looking at the seam this case study is about.
            </h2>
            <p className="text-[13px] text-ink-500 leading-relaxed">
              Greenroom&apos;s in-app settlement tool was built early in the
              company&apos;s history, when most deals were flat guarantees.
              About 18% of customers actively use it; the other 82% — including
              most of the larger venues — default to spreadsheets. The CEO has
              flagged this as the company&apos;s biggest craft gap.{" "}
              <Link
                href="/context"
                className="text-brand-700 font-medium hover:text-brand-800 hover:underline inline-flex items-center gap-0.5"
              >
                Where to start <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackLink({ showId }: { showId: string }) {
  return (
    <Link
      href={`/shows/${showId}`}
      className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to show
    </Link>
  );
}

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  timestamp?: Date | null;
};

function LifecycleBar({
  settlement,
  disputedRecoups,
}: {
  settlement: Settlement;
  disputedRecoups: number;
}) {
  if (settlement.status === "voided") {
    return (
      <div className="rounded-lg border border-ink-200/80 bg-white px-5 py-4 flex items-center gap-3">
        <XCircle className="h-4 w-4 text-ink-400" />
        <div>
          <div className="text-[13px] font-medium text-ink-900">
            Settlement voided
          </div>
          <div className="text-[11.5px] text-ink-400 mt-0.5">
            The show was cancelled or the settlement was scrapped.
          </div>
        </div>
      </div>
    );
  }

  const stages: Stage[] = [
    {
      key: "draft",
      label: "Drafted",
      icon: Pencil,
      timestamp: settlement.draftedAt,
    },
    {
      key: "submitted",
      label: "Submitted",
      icon: Mail,
      timestamp: settlement.submittedAt,
    },
    {
      key: "review",
      label: "Reviewed",
      icon: TrendingUp,
      timestamp: settlement.reviewStartedAt,
    },
    {
      key: "signed",
      label: settlement.disputedAt ? "Finalized" : "Signed",
      icon: Check,
      timestamp: settlement.finalizedAt ?? settlement.signedAt,
    },
    {
      key: "paid",
      label: "Paid",
      icon: Wallet,
      timestamp: settlement.paidAt,
    },
  ];

  const currentIndex = (() => {
    switch (settlement.status) {
      case "draft":
        return 0;
      case "submitted":
        return 1;
      case "in_review":
        return 2;
      case "disputed":
      case "signed":
      case "revised":
      case "finalized":
        return 3;
      case "paid":
        return 4;
      default:
        return 0;
    }
  })();

  const isDisputed =
    settlement.status === "disputed" ||
    settlement.status === "revised" ||
    !!settlement.disputedAt;

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow text-[10px] text-ink-400">
            Settlement lifecycle
          </div>
          {isDisputed && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
              <AlertTriangle className="h-3 w-3" />
              {settlement.status === "disputed"
                ? "In dispute"
                : settlement.status === "revised"
                  ? "Revision sent"
                  : "Resolved after dispute"}
              {disputedRecoups > 0 && (
                <span className="text-rose-600">
                  · {disputedRecoups} disputed recoup
                  {disputedRecoups === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-1 relative">
          <div className="absolute top-3.5 left-[10%] right-[10%] h-px bg-ink-200/60" />

          {stages.map((stage, i) => {
            const isComplete = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = i > currentIndex;
            const Icon = stage.icon;

            const stageDot = (() => {
              if (isComplete) {
                return "bg-brand-700 ring-brand-700 text-white";
              }
              if (isCurrent) {
                return isDisputed
                  ? "bg-rose-50 ring-rose-500 text-rose-700"
                  : "bg-brand-50 ring-brand-700 text-brand-700";
              }
              return "bg-white ring-ink-200/80 text-ink-300";
            })();

            return (
              <div
                key={stage.key}
                className="flex flex-col items-center text-center"
              >
                <div
                  className={`relative z-10 w-7 h-7 rounded-full ring-2 flex items-center justify-center ${stageDot}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div
                  className={`mt-2.5 text-[11px] font-medium leading-tight ${
                    isFuture ? "text-ink-300" : "text-ink-900"
                  }`}
                >
                  {stage.label}
                </div>
                <div className="text-[10px] text-ink-400 mt-0.5 font-mono tabular leading-tight min-h-[12px]">
                  {stage.timestamp
                    ? new Date(stage.timestamp).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : ""}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DealInterpreter({
  showId,
  draft,
  answers,
  calculation,
  existingSettlement,
}: {
  showId: string;
  draft: StructuredDealDraft;
  answers: ConfirmationAnswer[];
  calculation: ConfirmedSettlementCalculation;
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
}) {
  const missing = missingBlockingQuestions(draft, answers);
  const answerMap = new Map(answers.map((a) => [a.questionId, a]));
  const status = interpreterStatus(draft, calculation, missing.length);

  return (
    <>
      <Card accent={status.accent}>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Deal Interpreter</CardTitle>
              <PlainBadge variant={status.badge}>{status.label}</PlainBadge>
            </div>
            <CardDescription>
              Greenroom interpreted the deal prose, checks what needs
              confirmation, and only calculates from confirmed terms.
            </CardDescription>
          </div>
          <Link
            href={`/shows/${showId}/settle`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200/80 bg-white px-3 py-2 text-[12px] font-medium text-ink-700 hover:bg-ink-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset demo
          </Link>
        </CardHeader>
        <CardContent className="space-y-7">
          <InterpreterSummary
            draft={draft}
            calculation={calculation}
            existingSettlement={existingSettlement}
          />

          <section>
            <SectionTitle
              title="Interpreted deal terms"
              description={`${draft.extractorMode === "llm" ? "LLM" : "Local fallback"} extraction · source hash ${draft.sourceHash.slice(0, 8)}`}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {draft.terms.map((term) => (
                <TermRow key={term.id} term={term} />
              ))}
            </div>
          </section>

          {draft.confirmationQuestions.length > 0 && (
            <section>
              <SectionTitle
                title="Confirm assumptions"
                description="Only payout-impacting ambiguity is asked here. Answers stay in the URL for this demo; no database writes."
              />
              <div className="space-y-3">
                {draft.confirmationQuestions.map((question) => (
                  <ConfirmationQuestionCard
                    key={question.id}
                    showId={showId}
                    question={question}
                    answer={answerMap.get(question.id)}
                    answers={answers}
                  />
                ))}
              </div>
            </section>
          )}

          {draft.risks.length > 0 && (
            <section>
              <SectionTitle
                title="Risk flags"
                description="These stay visible even when the worksheet can calculate."
              />
              <div className="space-y-2">
                {draft.risks.map((risk) => (
                  <RiskRow key={risk.id} risk={risk} />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle
              title="Settlement worksheet"
              description="Deterministic math from confirmed structured terms only."
            />
            <Worksheet calculation={calculation} />
          </section>
        </CardContent>
      </Card>

      {calculation.status === "ready" &&
        calculation.bonusesNotTriggered.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Bonuses not triggered</CardTitle>
              <CardDescription>
                Structured bonuses captured by the interpreter that did not
                hit. Shown for transparency.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-ink-100/80">
              {calculation.bonusesNotTriggered.map((b, i) => (
                <div
                  key={i}
                  className="py-3 flex items-baseline justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink-600">{b.label}</div>
                    <div className="text-[11.5px] text-ink-400 mt-0.5">
                      {b.reason}
                    </div>
                  </div>
                  <div className="text-[12.5px] text-ink-300 font-mono tabular line-through">
                    {formatMoney(b.amount)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
      )}
    </>
  );
}

function InterpreterSummary({
  draft,
  calculation,
  existingSettlement,
}: {
  draft: StructuredDealDraft;
  calculation: ConfirmedSettlementCalculation;
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
}) {
  if (calculation.status !== "ready") {
    return (
      <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-5 flex gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
        <div>
          <div className="text-[13px] font-semibold text-amber-900">
            Calculation locked
          </div>
          <p className="text-[12.5px] text-ink-700 mt-1 leading-relaxed">
            {calculation.reason}
          </p>
          <p className="text-[11.5px] text-ink-500 mt-2">
            The final artist payout is hidden until the workflow can produce
            an auditable number.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center rounded-lg bg-gradient-paper ring-1 ring-brand-200/60 p-6">
      <div>
        <div className="eyebrow text-[10px] text-brand-700 mb-2">
          Authoritative payout
        </div>
        <div
          className="text-[56px] font-mono tabular font-bold text-ink-900 leading-none"
          style={{ letterSpacing: "-0.03em" }}
        >
          {formatMoney(calculation.totalToArtist)}
        </div>
        <div className="text-[12px] text-ink-500 mt-2 font-mono">
          {calculation.finalFormula}
        </div>
        {existingSettlement?.totalToArtist != null &&
          existingSettlement.totalToArtist !== calculation.totalToArtist && (
            <div className="text-[12px] text-ink-400 mt-2">
              Logged settlement:{" "}
              <span className="font-mono tabular text-ink-700">
                {formatMoney(existingSettlement.totalToArtist)}
              </span>
            </div>
          )}
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <PlainBadge variant={draft.risks.length > 0 ? "amber" : "brand"}>
          {draft.risks.length > 0 ? "Calculated with flags" : "Ready to calculate"}
        </PlainBadge>
        {existingSettlement?.status && (
          <PlainBadge variant={existingSettlement.status === "disputed" ? "rose" : "default"}>
            Existing status: {existingSettlement.status.replace(/_/g, " ")}
          </PlainBadge>
        )}
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <div className="text-[13px] font-semibold text-ink-900">{title}</div>
      <div className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
        {description}
      </div>
    </div>
  );
}

function TermRow({ term }: { term: DraftTerm }) {
  const badge = termStatusBadge(term.status);
  return (
    <div className="rounded-lg border border-ink-200/70 bg-canvas-soft px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.08em]">
            {term.label}
          </div>
          <div className="text-[13.5px] font-medium text-ink-900 mt-1">
            {term.value}
          </div>
        </div>
        <PlainBadge variant={badge.variant}>{badge.label}</PlainBadge>
      </div>
      {term.sourceText && (
        <div className="text-[11.5px] text-ink-500 mt-2 leading-snug">
          Source: &ldquo;{term.sourceText}&rdquo;
        </div>
      )}
    </div>
  );
}

function ConfirmationQuestionCard({
  showId,
  question,
  answer,
  answers,
}: {
  showId: string;
  question: ConfirmationQuestion;
  answer?: ConfirmationAnswer;
  answers: ConfirmationAnswer[];
}) {
  const isAnswered = !!answer && answer.selectedValue !== "ask_agent";
  return (
    <form
      action={`/shows/${showId}/settle`}
      method="get"
      className={`rounded-lg border p-4 ${
        isAnswered
          ? "border-brand-200/70 bg-brand-50/20"
          : "border-amber-200/70 bg-amber-50/30"
      }`}
    >
      {answers
        .filter((savedAnswer) => savedAnswer.questionId !== question.id)
        .map((savedAnswer) => (
          <input
            key={savedAnswer.questionId}
            type="hidden"
            name={`confirm:${savedAnswer.questionId}`}
            value={savedAnswer.selectedValue}
          />
        ))}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-ink-900">
              {question.question}
            </div>
            <PlainBadge variant={question.severity === "blocking" ? "amber" : "default"}>
              {question.severity === "blocking" ? "Blocks calculation" : "Review"}
            </PlainBadge>
          </div>
          {question.sourceText && (
            <div className="text-[11.5px] text-ink-500 mt-1.5 leading-snug">
              Source: &ldquo;{question.sourceText}&rdquo;
            </div>
          )}
          <div className="text-[12px] text-ink-600 mt-2 leading-relaxed">
            {question.whyItMatters}
          </div>
          {question.payoutImpactCents != null && question.payoutImpactCents > 0 && (
            <div className="text-[12px] text-amber-800 mt-2 font-medium">
              Estimated payout impact: {formatMoney(question.payoutImpactCents / 100)}
            </div>
          )}
          {answer && (
            <div className="text-[11.5px] text-brand-800 mt-2">
              Selected answer: {answer.selectedLabel}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
        {question.options.map((option) => (
          <label
            key={option.value}
            className={`rounded-lg border bg-white px-3 py-3 cursor-pointer transition-colors ${
              answer?.selectedValue === option.value
                ? "border-brand-500 ring-1 ring-brand-500"
                : "border-ink-200/80 hover:border-ink-300"
            }`}
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                name={`confirm:${question.id}`}
                value={option.value}
                defaultChecked={answer?.selectedValue === option.value}
                required
                className="mt-0.5"
              />
              <div>
                <div className="text-[12.5px] font-medium text-ink-900 leading-tight">
                  {option.label}
                </div>
                {option.description && (
                  <div className="text-[11.5px] text-ink-500 mt-1 leading-snug">
                    {option.description}
                  </div>
                )}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-2 text-[12px] font-medium text-white hover:bg-ink-800"
        >
          <Check className="h-3.5 w-3.5" />
          Apply confirmation
        </button>
      </div>
    </form>
  );
}

function confirmationAnswersFromSearchParams(
  draft: StructuredDealDraft,
  query: Record<string, string | string[] | undefined>,
): ConfirmationAnswer[] {
  return draft.confirmationQuestions.flatMap((question) => {
    const rawValue = query[`confirm:${question.id}`];
    const selectedValue = Array.isArray(rawValue)
      ? rawValue.at(-1)
      : rawValue;
    const option = question.options.find((o) => o.value === selectedValue);

    if (!selectedValue || !option) return [];

    return [
      {
        questionId: question.id,
        selectedValue,
        selectedLabel: option.label,
      },
    ];
  });
}

function RiskRow({ risk }: { risk: DealRisk }) {
  const variant =
    risk.severity === "blocking"
      ? "rose"
      : risk.severity === "warning"
        ? "amber"
        : "default";
  return (
    <div className="rounded-lg border border-ink-200/70 bg-white px-4 py-3 flex items-start gap-3">
      <AlertTriangle
        className={`h-4 w-4 mt-0.5 ${
          risk.severity === "blocking"
            ? "text-rose-700"
            : risk.severity === "warning"
              ? "text-amber-700"
              : "text-ink-400"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-medium text-ink-900">
            {risk.label}
          </div>
          <PlainBadge variant={variant}>{risk.severity}</PlainBadge>
        </div>
        <div className="text-[12px] text-ink-600 mt-1 leading-relaxed">
          {risk.detail}
        </div>
      </div>
    </div>
  );
}

function Worksheet({
  calculation,
}: {
  calculation: ConfirmedSettlementCalculation;
}) {
  if (calculation.status === "locked") {
    return (
      <div className="rounded-lg border border-amber-200/70 bg-amber-50/30 p-5">
        <div className="text-[13px] font-semibold text-amber-900">
          Worksheet locked
        </div>
        <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">
          {calculation.reason}
        </p>
      </div>
    );
  }

  if (calculation.status === "unsupported") {
    return (
      <div className="rounded-lg border border-ink-200/70 bg-canvas-soft p-5">
        <div className="text-[13px] font-semibold text-ink-900">
          Formula captured, not auto-calculated
        </div>
        <p className="text-[12px] text-ink-600 mt-1 leading-relaxed">
          {calculation.reason}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-200/70 bg-white overflow-hidden">
      {calculation.comparison && (
        <div className="grid grid-cols-3 gap-px bg-ink-100/80 border-b border-ink-100/80">
          <ComparisonCell
            label="Guarantee side"
            value={calculation.comparison.guarantee}
            active={calculation.comparison.winner === "guarantee"}
          />
          <ComparisonCell
            label="Percentage side"
            value={calculation.comparison.percentagePayout}
            active={calculation.comparison.winner === "percentage"}
          />
          <div className="bg-brand-50 px-4 py-3">
            <div className="eyebrow text-[9px] text-brand-800">Winner</div>
            <div className="text-[14px] font-semibold text-brand-900 mt-1 capitalize">
              {calculation.comparison.winner} side
            </div>
          </div>
        </div>
      )}
      <div className="divide-y divide-ink-100/80 px-5 py-3">
        {calculation.steps.map((step, i) => (
          <Row
            key={`${step.label}-${i}`}
            label={step.label}
            value={formatMoney(step.value)}
            note={step.note}
          />
        ))}
        <div className="flex items-baseline justify-between py-3 font-semibold">
          <span className="text-[13px] text-ink-900">Total to artist</span>
          <span className="text-[18px] font-mono tabular text-ink-900">
            {formatMoney(calculation.totalToArtist)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ComparisonCell({
  label,
  value,
  active,
}: {
  label: string;
  value: number;
  active: boolean;
}) {
  return (
    <div className={`px-4 py-3 ${active ? "bg-brand-50" : "bg-white"}`}>
      <div className={`eyebrow text-[9px] ${active ? "text-brand-800" : "text-ink-400"}`}>
        {label}
      </div>
      <div className="text-[17px] font-mono tabular font-semibold text-ink-900 mt-1">
        {formatMoney(value)}
      </div>
    </div>
  );
}

function interpreterStatus(
  draft: StructuredDealDraft,
  calculation: ConfirmedSettlementCalculation,
  missingCount: number,
): {
  label: string;
  badge: "default" | "amber" | "brand" | "rose" | "sky";
  accent: "brand" | "amber" | "rose" | "sky";
} {
  if (missingCount > 0 || calculation.status === "locked") {
    return {
      label: `Needs ${Math.max(missingCount, 1)} confirmation${Math.max(missingCount, 1) === 1 ? "" : "s"}`,
      badge: "amber",
      accent: "amber",
    };
  }
  if (calculation.status === "unsupported") {
    return {
      label: "Unsupported formula captured",
      badge: "default",
      accent: "sky",
    };
  }
  if (draft.risks.length > 0) {
    return {
      label: "Risk flagged after sign-off",
      badge: "amber",
      accent: "amber",
    };
  }
  return {
    label: "Ready to calculate",
    badge: "brand",
    accent: "brand",
  };
}

function termStatusBadge(status: DraftTerm["status"]): {
  label: string;
  variant: "default" | "amber" | "brand" | "rose" | "sky";
} {
  const map: Record<
    DraftTerm["status"],
    { label: string; variant: "default" | "amber" | "brand" | "rose" | "sky" }
  > = {
    confirmed: { label: "Confirmed", variant: "brand" },
    inferred: { label: "Inferred", variant: "sky" },
    needs_confirmation: { label: "Needs confirmation", variant: "amber" },
    unsupported: { label: "Captured", variant: "default" },
  };
  return map[status];
}

function RecoupsSection({ recoups }: { recoups: Recoup[] }) {
  const total = recoups.reduce((s, r) => s + r.amount, 0);
  const disputedTotal = recoups
    .filter((r) => r.status === "disputed")
    .reduce((s, r) => s + r.amount, 0);
  const hasDisputed = disputedTotal > 0;

  return (
    <Card accent={hasDisputed ? "rose" : undefined}>
      <CardHeader>
        <div>
          <CardTitle>Recoups</CardTitle>
          <CardDescription>
            Venue costs taken off the top before artist payment. Often the
            disputed line items in a settlement.
          </CardDescription>
        </div>
        <PlainBadge variant={hasDisputed ? "rose" : "default"}>
          {formatMoney(total)} total
        </PlainBadge>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80">
        {recoups.map((r) => (
          <div
            key={r.id}
            className="py-3.5 grid grid-cols-[1fr_auto_auto] items-center gap-3"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-ink-900 leading-tight">
                {r.label}
              </div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">
                {RECOUP_LABELS[r.category]}
              </div>
            </div>
            <div>
              {r.status === "disputed" ? (
                <PlainBadge variant="rose">Disputed</PlainBadge>
              ) : r.status === "withdrawn" ? (
                <PlainBadge variant="default">Withdrawn</PlainBadge>
              ) : (
                <PlainBadge variant="brand">Agreed</PlainBadge>
              )}
            </div>
            <div className="text-[13.5px] font-mono tabular text-ink-900 text-right min-w-[80px]">
              {formatMoney(r.amount)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SignoffSection({ settlement }: { settlement: Settlement }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-off & notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {settlement.signoffText && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              From the artist team
            </div>
            <div className="text-[13px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              &ldquo;{settlement.signoffText}&rdquo;
            </div>
          </div>
        )}
        {settlement.notes && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Mariana&apos;s settlement notes
            </div>
            <div className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              {settlement.notes}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <div>
        <div className="text-[13px] text-ink-600">{label}</div>
        {note && (
          <div className="text-[11.5px] text-ink-400 mt-0.5 max-w-md leading-snug">
            {note}
          </div>
        )}
      </div>
      <div className="text-[13.5px] text-ink-900 font-mono tabular">
        {value}
      </div>
    </div>
  );
}
