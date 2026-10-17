import { Lamp } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { UsageBreakdown } from "@/lib/api"
import type { Mode } from "@/lib/mode"

// The model bars' neutral: they are estimates, not categories.
const MODEL_BAR_COLOR = "#94a3b8"

// The unexplained bar: a striped fill, visually "unknown".
const UNEXPLAINED_FILL =
  "repeating-linear-gradient(45deg, #94a3b8 0 2px, transparent 2px 5px)"

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `€${value.toFixed(2)}`
}

interface RestOfHomeCardProps {
  data: UsageBreakdown | null
  status: "loading" | "ok" | "error"
  mode: Mode
}

// The Usage tab's right column, card 2 (docs/spec.md section 7): the
// remainder - the period's usage no category accounts for - split by
// the home model's per-day device estimates. Bar shares are against
// the remainder, not the period total; the header's share matches the
// treemap's remainder tile. Every modeled number carries the "model"
// label with its basis note; the final bar is the unexplained part.
// Cost mode costs every modeled figure flat at the window's average
// price; without price rows the cost figures read unavailable, never
// zero.
function RestOfHomeCard({ data, status, mode }: RestOfHomeCardProps) {
  return (
    <Card className="flex flex-col">
      <PanelHeader
        icon={Lamp}
        title="Rest of your home"
        description="Per-day model averages of the unmeasured background; household consumption, grid export excluded"
      />
      <CardContent className="flex flex-1 flex-col">
        {data === null ? (
          <p className="min-h-24 text-sm text-muted-foreground">
            {status === "error"
              ? "Could not load the usage breakdown."
              : "No usage data for this period."}
          </p>
        ) : (
          <RestOfHomeBody data={data} mode={mode} />
        )}
      </CardContent>
    </Card>
  )
}

function RestOfHomeBody({
  data,
  mode,
}: {
  data: UsageBreakdown
  mode: Mode
}) {
  const remainder = data.split.remainder_kwh
  const remainderCost = data.split.remainder_cost_eur
  const total = data.total.kwh
  const sharePct = total > 0 ? Math.round((remainder / total) * 100) : 0
  const model = data.home_model
  const avgPrice = data.avg_price_eur
  const costUnavailable = mode === "cost" && remainderCost === null

  // Shares are against the remainder; when the model over-explains a
  // low-usage period the denominator becomes the modeled sum so the
  // bars stay within 100 percent (section 7.2).
  const base = Math.max(remainder, model.modeled_kwh)
  const pct = (value: number) =>
    base > 0 ? Math.round((value / base) * 100) : 0
  const value = (kwh: number): string =>
    mode === "energy"
      ? formatKwh(kwh)
      : avgPrice === null
        ? "\u2014"
        : formatEur(round2(kwh * avgPrice))

  const unexplained = model.unexplained_kwh
  // The modeled figures costed flat at the window's average price;
  // the entries' costs plus the unexplained cost sum to the
  // remainder's cost exactly.
  const modeledCost =
    avgPrice === null ? null : round2(model.modeled_kwh * avgPrice)
  const unexplainedValue =
    mode === "energy"
      ? formatKwh(unexplained)
      : remainderCost === null || modeledCost === null
        ? "\u2014"
        : formatEur(round2(remainderCost - modeledCost))

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
          No price data for this period; cost figures are unavailable,
          not zero.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {model.entries.map((entry) => (
          <div key={entry.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="truncate">{entry.name}</span>
                <span
                  className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
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
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
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
                  className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
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
                style={{ width: `${pct(unexplained)}%`, background: UNEXPLAINED_FILL }}
              />
            </div>
          </div>
        )}
      </div>
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        Every category is measured except the heat pump (Est.); the
        base load is data-derived, the other bars are home-model
        averages.
      </p>
    </>
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export default RestOfHomeCard
