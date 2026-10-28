import { Lamp } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import SectionHeader from "@/components/SectionHeader";
import SkeletonReveal from "@/components/SkeletonReveal";
import { Skeleton } from "@/components/ui/skeleton";
import { usageCategoryColor } from "@/lib/applianceColors";
import type { UsageBreakdown } from "@/lib/api";
import type { Mode } from "@/lib/mode";
import { formatMetric, smallMeasuredPlugs } from "@/lib/usageTreemap";

// The model bars' neutral: they are estimates, not categories.
const MODEL_BAR_COLOR = "#94a3b8";

// The unexplained bar: a striped fill, visually "unknown".
const UNEXPLAINED_FILL =
  "repeating-linear-gradient(45deg, #94a3b8 0 2px, transparent 2px 5px)";

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`;
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`;
}

interface RestOfHomeCardProps {
  data: UsageBreakdown | null;
  status: "loading" | "ok" | "error";
  mode: Mode;
}

// The Usage tab's right column, card 2 (docs/spec.md section 7): the
// remainder - the period's usage no category accounts for - split by
// the home model's per-day device estimates, plus the measured
// plugs too small for the treemap aggregated into one clearly
// tagged measured row that renders last, as the smallest item.
// Bar shares are against the remainder, not the period total (the
// Other appliances row's share is of the period); the header's
// share matches the treemap's remainder tile. Every modeled number
// carries the "model" label with its basis note, the Other
// appliances row carries the "measured" badge and a tooltip that
// enumerates its merged categories; the final modeled bar is the
// unexplained part. Cost mode costs every modeled figure flat at
// the window's average price; without price rows the cost figures
// read unavailable, never zero.
function RestOfHomeCard({ data, status, mode }: RestOfHomeCardProps) {
  // The whole section's loading reveal: the skeleton mirrors the
  // section header's two lines, the remainder stat line and the
  // model's bar rows, so the first load cross-fades in without a
  // shift. An error is not loading: the honest message fades in;
  // an empty period keeps its own honest state.
  const loading = status === "loading" && data === null;
  const skeleton = (
    <div className="flex min-w-0 flex-col" aria-busy="true">
      {/* The SectionHeader's geometry: the text-lg title at
          leading-snug (24.75 px) over the text-sm description
          (20 px), one gap-1 apart. */}
      <div className="grid auto-rows-min items-start gap-1">
        <Skeleton className="h-[24.75px] w-36" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="mt-2 flex flex-1 flex-col">
        {/* The remainder stat line, then the model's bar rows. */}
        <Skeleton className="h-5 w-48" />
        <div className="mt-4 space-y-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-4 w-full" />
      </div>
    </div>
  );

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      <div className="flex min-w-0 flex-col">
        <SectionHeader
          icon={Lamp}
          title="Rest of your home"
          description="The unmeasured background, plus small measured appliances; household consumption, grid export excluded"
        />
        <div className="mt-2 flex flex-1 flex-col">
          {data === null ? (
            <p className="min-h-24 text-sm text-subtle-foreground">
              {status === "error"
                ? "Could not load the usage breakdown."
                : "No usage data for this period."}
            </p>
          ) : (
            <RestOfHomeBody data={data} mode={mode} />
          )}
        </div>
      </div>
    </SkeletonReveal>
  );
}

function RestOfHomeBody({ data, mode }: { data: UsageBreakdown; mode: Mode }) {
  const remainder = data.split.remainder_kwh;
  const remainderCost = data.split.remainder_cost_eur;
  const total = data.total.kwh;
  const sharePct = total > 0 ? Math.round((remainder / total) * 100) : 0;
  const model = data.home_model;
  const avgPrice = data.avg_price_eur;
  const costUnavailable = mode === "cost" && remainderCost === null;

  // Shares are against the remainder; when the model over-explains a
  // low-usage period the denominator becomes the modeled sum so the
  // bars stay within 100 percent (section 7.2).
  const base = Math.max(remainder, model.modeled_kwh);
  const pct = (value: number) =>
    base > 0 ? Math.round((value / base) * 100) : 0;
  const value = (kwh: number): string =>
    mode === "energy"
      ? formatKwh(kwh)
      : avgPrice === null
        ? "\u2014"
        : formatEur(round2(kwh * avgPrice));

  const unexplained = model.unexplained_kwh;
  // The modeled figures costed flat at the window's average price;
  // the entries' costs plus the unexplained cost sum to the
  // remainder's cost exactly.
  const modeledCost =
    avgPrice === null ? null : round2(model.modeled_kwh * avgPrice);
  const unexplainedValue =
    mode === "energy"
      ? formatKwh(unexplained)
      : remainderCost === null || modeledCost === null
        ? "\u2014"
        : formatEur(round2(remainderCost - modeledCost));

  // The measured plugs under the treemap's tile floor, aggregated:
  // the same payload and the same floor buildTiles applies, so the
  // card picks up exactly what the treemap leaves out. The row is
  // omitted when nothing falls under the floor. It renders last, as
  // the card's smallest item; its tooltip enumerates the merged
  // categories with their kWh for the period.
  const smallPlugs = smallMeasuredPlugs(data, mode);
  // One decimal: the row's share of the period is small by
  // definition, an integer percent would almost always read 0.
  const smallPlugsPct = smallPlugs === null ? 0 : smallPlugs.share * 100;
  const smallPlugsTooltip =
    smallPlugs === null
      ? ""
      : smallPlugs.members
          .map((member) => `${member.label} ${member.kwh.toFixed(3)} kWh`)
          .join(", ");

  return (
    <>
      <p className="text-sm font-medium tabular-nums">
        {mode === "energy"
          ? formatKwh(remainder)
          : costUnavailable
            ? "\u2014"
            : formatEur(remainderCost)}{" "}
        &middot; {sharePct}% of the period
      </p>
      {costUnavailable && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          No price data for this period; cost figures are unavailable, not zero.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {model.entries.map((entry) => (
          <div key={entry.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="truncate">{entry.name}</span>
                <span
                  className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-chip-foreground"
                  title={
                    entry.derived
                      ? "Derived per day from this period's own hourly consumption"
                      : "Per-day home model estimate"
                  }
                >
                  {entry.derived ? "data" : "model"}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {value(entry.kwh)} &middot; {pct(entry.kwh)}%
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${pct(entry.kwh)}%`,
                  backgroundColor: MODEL_BAR_COLOR,
                }}
              />
            </div>
            <p className="mt-1 text-[10px] leading-tight text-subtle-foreground">
              {entry.basis}
            </p>
          </div>
        ))}
        {unexplained > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span>Unexplained</span>
                <span
                  className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-chip-foreground"
                  title="Remainder the model does not cover"
                >
                  model
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {unexplainedValue} &middot; {pct(unexplained)}%
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${pct(unexplained)}%`,
                  background: UNEXPLAINED_FILL,
                }}
              />
            </div>
          </div>
        )}
        {smallPlugs !== null && (
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span>Other appliances</span>
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
                  style={{ backgroundColor: usageCategoryColor("small_plugs") }}
                  title="Measured appliance usage below the treemap's tile floor"
                >
                  measured
                </span>
                <InfoTooltip text={smallPlugsTooltip} />
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMetric(smallPlugs.primary, mode)} &middot;{" "}
                {smallPlugsPct.toFixed(1)}% of the period
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.min(100, smallPlugsPct)}%`,
                  backgroundColor: usageCategoryColor("small_plugs"),
                }}
              />
            </div>
            <p className="mt-1 text-[10px] leading-tight text-subtle-foreground">
              Measured appliances too small for the treemap
            </p>
          </div>
        )}
      </div>
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        Other appliances is measured usage below the treemap's tile floor; every
        category is measured except the heat pump (Est.); the base load is
        data-derived, the other bars are home-model averages.
      </p>
    </>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default RestOfHomeCard;
