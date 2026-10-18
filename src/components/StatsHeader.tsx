import { House, PlugZap } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import StatCardSkeleton from "@/components/StatCardSkeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { STAT_HEADLINE } from "@/lib/statCard";
import { useSummary } from "@/lib/useSummary";

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`;
}

const PLACEHOLDER = "\u2014";

// The grid card's tooltip: the net figure's meaning plus the
// renewables strip's. The color state thresholds are our own
// interpretation; Zonneplan publishes none.
const GRID_TOOLTIP =
  "Grid electricity today: imported minus exported; negative means net export. The live grid renewables share lives in the Live power card.";

// The home usage card's tooltip: the headline figure's battery
// accounting, including the always-present balance sub-line's rule.
// Solar that charged
// the battery counts as self-consumption today, but as home usage
// only on the day the battery discharges it.
const USAGE_TOOLTIP =
  "Home usage today: everything the household consumed - grid import plus solar used directly plus battery discharge, minus export. Energy that charged the battery today is not counted here; it counts on the day the battery discharges it. The first sub-line states the battery balance: today's net-stored energy is excluded once it is large enough to notice, otherwise the line reads the balance as included. The self-consumption share lives in the Solar today card.";

// The two headline metric cards: From the grid (net of import and
// export) and Home usage (household consumption). Both share one
// fixed composition so their height never changes during the day:
// the title and the big figure at the top, then exactly two
// sub-lines - the in/out split and the week/month figures for the
// grid card, the battery balance and the week/month figures for
// home usage - every line always present, a muted dash wherever a
// figure does not exist. The two groups spread across the fixed
// grid cell height, so no bottom gap opens up next to the taller
// visual cards. The live grid renewables share moved to the Live
// power card, the self-consumption share to the Solar today card.
// Rendered as a bare fragment: TodayPage lays the cards into one
// shared top-widget grid, so every widget shares one height.
function StatsHeader() {
  const { summary, status } = useSummary();

  // Grid net: import minus export; negative means net export.
  const netKwh = (range: { import_kwh: number; export_kwh: number }) =>
    range.import_kwh - range.export_kwh;

  const usageToday = summary?.today.total_usage_kwh ?? null;

  // Net energy the battery absorbed today: charged minus discharged.
  // Home usage excludes this share by definition, so the card states
  // it beneath the figure whenever it is large enough to notice.
  const batteryNetStored =
    summary === null
      ? null
      : (summary.today.battery_charged_kwh ?? 0) -
        (summary.today.battery_discharged_kwh ?? 0);

  // Both cards share one summary load, so their reveals share one
  // phase; the skeleton keeps the real card chrome with placeholder
  // lines in the metric composition.
  const loading = status === "loading";

  return (
    <>
      {/* From the grid: the household's grid figures. */}
      <SkeletonReveal loading={loading} skeleton={<StatCardSkeleton />}>
        <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
          {/* The whole card opens this week in the Usage tab. */}
          <StatCardLink
            to="/usage?period=week"
            label="From the grid: open this week in the Usage tab"
          />
          <div className="absolute right-3 top-3 z-20">
            <InfoTooltip text={GRID_TOOLTIP} />
          </div>
          <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
            {/* The title and the big figure anchor the top; the two
              fixed sub-lines spread to the bottom, so the card fills
              its grid cell without a bottom gap. */}
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
                <PlugZap className="size-5 shrink-0" aria-hidden="true" />
                From the grid
              </CardTitle>
              {/* The headline stays in the neutral foreground in every
                state: placeholder, net export and normal alike. */}
              <CardTitle className={STAT_HEADLINE}>
                {summary === null
                  ? PLACEHOLDER
                  : formatKwh(netKwh(summary.today))}
              </CardTitle>
            </div>
            <div className="flex flex-col gap-1">
              {/* The in/out split, always present: a muted dash per
                figure before the first data. */}
              <p className="text-xs text-muted-foreground tabular-nums">
                {summary === null
                  ? `${PLACEHOLDER} in, ${PLACEHOLDER} out`
                  : `${summary.today.import_kwh.toFixed(1)} kWh in, ${summary.today.export_kwh.toFixed(1)} kWh out`}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                This week{" "}
                {formatKwh(summary === null ? null : netKwh(summary.week))}{" "}
                &middot; This month{" "}
                {formatKwh(summary === null ? null : netKwh(summary.month))}
              </p>
            </div>
          </CardHeader>
        </Card>
      </SkeletonReveal>

      {/* Home usage: the household's consumption today. */}
      <SkeletonReveal loading={loading} skeleton={<StatCardSkeleton />}>
        <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
          {/* The whole card opens this week in the Usage tab. */}
          <StatCardLink
            to="/usage?period=week"
            label="Home usage: open this week in the Usage tab"
          />
          <div className="absolute right-3 top-3 z-20">
            <InfoTooltip text={USAGE_TOOLTIP} />
          </div>
          <CardHeader className="flex flex-1 flex-col items-stretch justify-between">
            {/* The title and the big figure anchor the top; the two
              fixed sub-lines spread to the bottom, so the card fills
              its grid cell without a bottom gap. */}
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
                <House className="size-5 shrink-0" aria-hidden="true" />
                Home usage
                {summary !== null && !summary.pv_available && (
                  <span
                    className="italic"
                    title="No PV entity found; home usage is grid import only"
                  >
                    {" "}
                    (excl. solar)
                  </span>
                )}
              </CardTitle>
              {/* The headline stays in the neutral foreground in every
                state: placeholder and normal alike. */}
              <CardTitle className={STAT_HEADLINE}>
                {formatKwh(usageToday)}
              </CardTitle>
            </div>
            <div className="flex flex-col gap-1">
              {/* The battery balance, always present: the exclusion
                whenever the net-stored figure is large enough to
                notice (the threshold is unchanged at 0.05 kWh), the
                neutral inclusion otherwise, a muted dash before the
                first data. */}
              <p className="text-xs text-muted-foreground tabular-nums">
                {batteryNetStored === null
                  ? PLACEHOLDER
                  : batteryNetStored >= 0.05
                    ? `Excludes ${batteryNetStored.toFixed(1)} kWh stored in the battery`
                    : "Battery balance included"}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                This week {formatKwh(summary?.week.total_usage_kwh ?? null)}{" "}
                &middot; This month{" "}
                {formatKwh(summary?.month.total_usage_kwh ?? null)}
              </p>
            </div>
          </CardHeader>
        </Card>
      </SkeletonReveal>
    </>
  );
}

export default StatsHeader;
