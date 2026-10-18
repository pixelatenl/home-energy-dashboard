import { House, PlugZap } from "lucide-react"
import InfoTooltip from "@/components/InfoTooltip"
import StatCardLink from "@/components/StatCardLink"
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useSummary } from "@/lib/useSummary"

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(1)} kWh`
}

const PLACEHOLDER = "\u2014"

// The grid card's tooltip: the net figure's meaning plus the
// renewables strip's. The color state thresholds are our own
// interpretation; Zonneplan publishes none.
const GRID_TOOLTIP =
  "Grid electricity today: imported minus exported; negative means net export. The live grid renewables share lives in the Live power card."

// The home usage card's tooltip: the headline figure's battery
// accounting. Solar that charged
// the battery counts as self-consumption today, but as home usage
// only on the day the battery discharges it.
const USAGE_TOOLTIP =
  "Home usage today: everything the household consumed - grid import plus solar used directly plus battery discharge, minus export. Energy that charged the battery today is not counted here; it counts on the day the battery discharges it. The self-consumption share lives in the Solar today card."

// The two headline metric cards: From the grid (net of import and
// export, with the in/out split as its sub-caption - the live
// grid renewables share moved to the Live power card, the
// self-consumption share to the Solar today card) and Home usage
// (household consumption). Today's value is large, this week and
// this month smaller beneath. Missing data shows a muted dash. The
// battery and solar live in their own compact widgets beside these.
// Rendered as a bare fragment: TodayPage lays the cards into one
// shared top-widget grid, so every widget shares one height.
function StatsHeader() {
  const { summary, status } = useSummary()

  // Grid net: import minus export; negative means net export.
  const netKwh = (range: {
    import_kwh: number
    export_kwh: number
  }) => range.import_kwh - range.export_kwh

  const usageToday = summary?.today.total_usage_kwh ?? null

  // Net energy the battery absorbed today: charged minus discharged.
  // Home usage excludes this share by definition, so the card states
  // it beneath the figure whenever it is large enough to notice.
  const batteryNetStored =
    summary === null
      ? null
      : (summary.today.battery_charged_kwh ?? 0) -
        (summary.today.battery_discharged_kwh ?? 0)

  if (status === "loading") {
    return (
      <>
        {[0, 1].map((index) => (
          <div
            key={index}
            className="min-h-32 animate-pulse rounded-lg bg-muted"
            aria-hidden="true"
          />
        ))}
      </>
    )
  }

  return (
    <>
      {/* From the grid: the household's grid figures. */}
      <Card className="relative min-h-32 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens this week in the Usage tab. */}
        <StatCardLink
          to="/usage?period=week"
          label="From the grid: open this week in the Usage tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={GRID_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <PlugZap className="size-5 shrink-0" aria-hidden="true" />
            From the grid
          </CardTitle>
          <CardTitle
            className={`text-[2.5rem] tabular-nums ${
              summary === null ? "text-muted-foreground" : ""
            }`}
          >
            {summary === null
              ? PLACEHOLDER
              : formatKwh(netKwh(summary.today))}
          </CardTitle>
          {summary !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {summary.today.import_kwh.toFixed(1)} kWh in,{" "}
              {summary.today.export_kwh.toFixed(1)} kWh out
            </p>
          )}
          <p className="pb-2 text-xs text-muted-foreground tabular-nums">
            This week {summary === null ? PLACEHOLDER : formatKwh(netKwh(summary.week))}{" "}
            &middot; This month{" "}
            {summary === null ? PLACEHOLDER : formatKwh(netKwh(summary.month))}
          </p>
        </CardHeader>
      </Card>

      {/* Home usage: the household's consumption today. */}
      <Card className="relative min-h-32 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens this week in the Usage tab. */}
        <StatCardLink
          to="/usage?period=week"
          label="Home usage: open this week in the Usage tab"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={USAGE_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <House className="size-5 shrink-0" aria-hidden="true" />
            Home usage
            {summary !== null && !summary.pv_available && (
              <span
                className="italic"
                title="No PV entity found; home usage is grid import only"
              >
                {" "}(excl. solar)
              </span>
            )}
          </CardTitle>
          <CardTitle
            className={`text-[2.5rem] tabular-nums ${
              usageToday === null ? "text-muted-foreground" : ""
            }`}
          >
            {formatKwh(usageToday)}
          </CardTitle>
          {batteryNetStored !== null && batteryNetStored >= 0.05 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Excludes {batteryNetStored.toFixed(1)} kWh stored in the
              battery
            </p>
          )}
          <p className="pb-2 text-xs text-muted-foreground tabular-nums">
            This week{" "}
            {formatKwh(summary?.week.total_usage_kwh ?? null)} &middot; This
            month {formatKwh(summary?.month.total_usage_kwh ?? null)}
          </p>
        </CardHeader>
      </Card>
    </>
  )
}

export default StatsHeader
