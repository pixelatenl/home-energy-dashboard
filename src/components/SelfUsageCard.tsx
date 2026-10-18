import { Sun } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { Mode } from "@/lib/mode";
import type { Period } from "@/lib/period";
import { STAT_HEADLINE } from "@/lib/statCard";
import { useSolarProduction } from "@/lib/useSolarProduction";

function formatKwh(value: number): string {
  return `${value.toFixed(1)} kWh`;
}

function formatEur(value: number): string {
  return `€${value.toFixed(2)}`;
}

// The card's tooltip: what the share reads.
const SELF_USAGE_TOOLTIP =
  "The share of this period's solar production the home consumed on site instead of feeding it into the grid - the same figure the Solar today card shows for today. The avoided cost is what that self-consumed energy would have cost at the dynamic hourly import price.";

// The period summary's fourth card: the period's self usage, the
// share of its solar production consumed on site, from the
// period-aware solar production endpoint. Energy mode leads with
// the percentage and carries the avoided import cost beneath; cost
// mode leads with the avoided cost and carries the percentage
// beneath - the mode story of the other summary cards. The
// composition is fixed like theirs: title, headline, exactly two
// sub-lines, every figure honest to the endpoint's null rules (no
// share exists without production, no cost without price data).
// The first load shows the shared shape-matched skeleton
// cross-fading into the card.
function SelfUsageCard({ period, mode }: { period: Period; mode: Mode }) {
  const { data, status } = useSolarProduction({
    period: period.kind,
    date: period.date,
  });

  const loading = status === "loading" && data === null;
  const sharePct =
    data?.totals.selfConsumedShare == null
      ? null
      : Math.round(data.totals.selfConsumedShare * 100);
  const avoidedEur = data?.totals.selfConsumptionAvoidedCostEur ?? null;

  if (data === null) {
    return (
      <SkeletonReveal loading={loading} skeleton={<StatCardSkeleton />}>
        <p className="min-h-12 text-sm text-subtle-foreground">
          {status === "error"
            ? "Could not load the solar production data."
            : "No solar data for this period."}
        </p>
      </SkeletonReveal>
    );
  }

  const energyFirst = mode === "energy";

  return (
    <SkeletonReveal loading={false} skeleton={<StatCardSkeleton />}>
      <Card className="relative min-h-24">
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={SELF_USAGE_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-1.5 text-title-foreground">
              <Sun className="size-5 shrink-0" aria-hidden="true" />
              Self usage
            </CardTitle>
            {/* The headline follows the mode's primary dimension;
                a missing figure reads as the honest dash, never a
                fabricated zero. */}
            <CardTitle className={STAT_HEADLINE}>
              {energyFirst
                ? sharePct === null
                  ? "\u2014"
                  : `${sharePct}%`
                : avoidedEur === null
                  ? "\u2014"
                  : formatEur(avoidedEur)}
            </CardTitle>
          </div>
          <div className="flex flex-col gap-1">
            {/* Line 1: the volumes behind the share, or the honest
                absence when nothing was produced. */}
            <p className="text-xs text-muted-foreground tabular-nums">
              {sharePct === null
                ? "No solar production this period"
                : `${formatKwh(data.totals.selfConsumedKwh)} of ${formatKwh(data.totals.kwh)} produced`}
            </p>
            {/* Line 2: the mode's other dimension. */}
            <p className="text-xs text-muted-foreground tabular-nums">
              {energyFirst
                ? avoidedEur === null
                  ? "\u2014"
                  : `${formatEur(avoidedEur)} import cost avoided`
                : sharePct === null
                  ? "\u2014"
                  : `${sharePct}% of production`}
            </p>
          </div>
        </CardHeader>
      </Card>
    </SkeletonReveal>
  );
}

export default SelfUsageCard;
