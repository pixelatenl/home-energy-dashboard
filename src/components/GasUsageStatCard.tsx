import { useMemo } from "react";
import { Flame } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { Mode } from "@/lib/mode";
import { stepPeriod, type Period } from "@/lib/period";
import { STAT_HEADLINE } from "@/lib/statCard";
import { useHeatGas } from "@/lib/useHeatGas";
import { gasStatFigures, gasWindowEmpty } from "@/lib/usageGas";

// The card's corner tooltip, the hub stat cards' idiom: the figure's
// source plus both data caveats of the gas endpoint - the post-
// midnight half hour missing from day totals, and the last-known-
// price fallback for the cost.
const GAS_TOOLTIP =
  "Gas/heating: gas used for heating and hot water, from the gas counter via /api/heat/gas. Data caveats: the gas day totals miss roughly the first half hour after midnight, and the cost uses the last known gas price when the period\u2019s price rows are missing.";

// The Usage summary strip's Gas/heating stat card (docs/spec.md
// section 7.1), slotted after Saved and earned and before the Self
// usage aside. The data is the existing /api/heat/gas endpoint,
// fetched twice: once anchored on the navigator's period and date,
// once on the previous period's anchor (the same-length period
// immediately before, per the breakdown spec's previous-period
// definition). Each fetch fails soft on its own: a failed or empty
// window renders the card's honest error or empty state without
// touching the other cards, and vice versa. Mode-aware like the
// other stats: energy mode leads with the period's m3, cost mode
// with its cost (a dash on an unknown price, never 0); the detail
// line carries the vs-previous deltas of both metrics. The first
// load shows the shared shape-matched skeleton; refreshes and
// period switches keep the previous content and update in place.
function GasUsageStatCard({ period, mode }: { period: Period; mode: Mode }) {
  const previous = useMemo(() => stepPeriod(period, -1), [period]);
  const current = useHeatGas(period.kind, period.date);
  const prev = useHeatGas(previous.kind, previous.date);

  const loading = current.status === "loading" && current.data === null;
  const figures = gasStatFigures(current.data, prev.data, mode);

  return (
    <SkeletonReveal loading={loading} skeleton={<StatCardSkeleton />}>
      {current.data === null || gasWindowEmpty(current.data) ? (
        <p className="min-h-12 text-sm text-subtle-foreground">
          {current.status === "error"
            ? "Could not load gas data."
            : "No gas data for this period."}
        </p>
      ) : (
        <Card className="relative min-h-24">
          <div className="absolute right-3 top-3 z-20">
            <InfoTooltip text={GAS_TOOLTIP} />
          </div>
          <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-1.5 text-title-foreground">
                <Flame className="size-5 shrink-0" aria-hidden="true" />
                Gas/heating
              </CardTitle>
              <CardTitle className={STAT_HEADLINE}>{figures.headline}</CardTitle>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground tabular-nums">
                {figures.secondary}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                vs previous {figures.deltaM3} &middot; {figures.deltaCost}
              </p>
            </div>
          </CardHeader>
        </Card>
      )}
    </SkeletonReveal>
  );
}

export default GasUsageStatCard;
