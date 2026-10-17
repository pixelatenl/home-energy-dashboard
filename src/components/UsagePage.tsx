import { useMemo } from "react"
import ApplianceUsageWidget from "@/components/ApplianceUsageWidget"
import ModeToggle from "@/components/ModeToggle"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import RestOfHomeCard from "@/components/RestOfHomeCard"
import UsageSummaryCard from "@/components/UsageSummaryCard"
import UsageTreemap from "@/components/UsageTreemap"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ApplianceHour, ApplianceSummary } from "@/lib/api"
import { applianceColor } from "@/lib/applianceColors"
import { useMode, type Mode } from "@/lib/mode"
import { periodHasData, periodLabel } from "@/lib/period"
import { localHourOf } from "@/lib/time"
import { useAppliances } from "@/lib/useAppliances"
import { usePeriod } from "@/lib/usePeriod"
import { useSummary } from "@/lib/useSummary"
import { useUsageBreakdown } from "@/lib/useUsageBreakdown"

interface HourSlot {
  totalKwh: number
  parts: { appliance: string; kwh: number }[]
}

// Groups the hourly rows into local-hour slots 0-23.
function hourSlots(hourly: ApplianceHour[]): Map<number, HourSlot> {
  const byHour = new Map<number, HourSlot>()
  for (const row of hourly) {
    const slot = localHourOf(row.hour)
    const entry = byHour.get(slot) ?? { totalKwh: 0, parts: [] }
    entry.parts.push({ appliance: row.appliance, kwh: row.kwh })
    entry.totalKwh += row.kwh
    byHour.set(slot, entry)
  }
  return byHour
}

// Stacked bar chart of kWh per hour per appliance for a day window,
// built from plain divs: segment heights are percentages of the
// busiest hour.
function HourlyChart({
  hourly,
  title,
}: {
  hourly: ApplianceHour[]
  title: string
}) {
  const byHour = hourSlots(hourly)
  const maxKwh = Math.max(0.001, ...[...byHour.values()].map((s) => s.totalKwh))
  const appliances = [...new Set(hourly.map((row) => row.appliance))]

  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 flex h-40 items-end gap-1" role="img" aria-label="Hourly appliance energy stacked per hour">
        {Array.from({ length: 24 }, (_, hour) => {
          const slot = byHour.get(hour)
          return (
            <div
              key={hour}
              className="flex h-full flex-1 flex-col justify-end"
              title={
                slot
                  ? `${String(hour).padStart(2, "0")}:00 \u2014 ${slot.parts
                      .map(
                        (part) =>
                          `${part.appliance} ${part.kwh.toFixed(2)} kWh`
                      )
                      .join(", ")}`
                  : undefined
              }
            >
              {slot?.parts.map((part) => (
                <div
                  key={part.appliance}
                  className="w-full rounded-sm"
                  style={{
                    height: `${(part.kwh / maxKwh) * 100}%`,
                    minHeight: part.kwh > 0 ? 2 : 0,
                    backgroundColor: applianceColor(part.appliance),
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>00</span>
        {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
          <span key={hour}>{String(hour).padStart(2, "0")}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {appliances.map((appliance) => (
          <span key={appliance} className="flex items-center gap-1.5">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: applianceColor(appliance), opacity: 0.8 }}
              aria-hidden="true"
            />
            {appliance}
          </span>
        ))}
      </div>
    </div>
  )
}

// Totals table: per appliance the kWh, cost and share of home usage,
// plus a "Total appliances" summary row. The Energy/Cost mode decides
// which metric leads; the other follows.
function TotalsTable({
  data,
  homeKwh,
  mode,
}: {
  data: ApplianceSummary
  homeKwh: number | null
  mode: Mode
}) {
  const energyFirst = mode === "energy"
  const shareOf = (kwh: number | null): string =>
    homeKwh !== null && kwh !== null && homeKwh > 0
      ? `${Math.round((kwh / homeKwh) * 100)}%`
      : "\u2014"
  const fmt = (value: number | null, digits: number): string =>
    value === null ? "\u2014" : value.toFixed(digits)
  const energyCell = (kwh: number | null): string => `${fmt(kwh, 2)} kWh`
  const costCell = (cost: number | null): string =>
    cost === null ? "\u2014" : `\u20ac${fmt(cost, 2)}`

  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <p className="text-sm font-medium">Totals</p>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Appliance</TableHead>
            <TableHead className="text-right">
              {energyFirst ? "Energy" : "Cost"}
            </TableHead>
            <TableHead className="text-right">
              {energyFirst ? "Cost" : "Energy"}
            </TableHead>
            <TableHead className="text-right">Share of home</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.appliances.map((appliance) => (
            <TableRow key={appliance.appliance}>
              <TableCell className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: applianceColor(appliance.appliance) }}
                  aria-hidden="true"
                />
                {appliance.appliance}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {energyFirst
                  ? energyCell(appliance.kwh)
                  : costCell(appliance.cost_eur)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {energyFirst
                  ? costCell(appliance.cost_eur)
                  : energyCell(appliance.kwh)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {shareOf(appliance.kwh)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Total appliances</TableCell>
            <TableCell className="text-right tabular-nums">
              {energyFirst
                ? energyCell(data.totals.plug_kwh)
                : costCell(data.totals.plug_cost)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {energyFirst
                ? costCell(data.totals.plug_cost)
                : energyCell(data.totals.plug_kwh)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {shareOf(data.totals.plug_kwh)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

// First day with smart plug data in the database; periods ending
// before it show the empty state instead of empty charts.
const PLUG_DATA_START = "2026-10-11"

// The usage view: the category treemap as the left panel with the
// future insights panel as the right placeholder, then the smart plug
// appliance widget, the day's hourly stacked chart and the totals
// table beneath. Fetches are anchored to the navigator's concrete
// period window; the hourly chart exists only for day periods. The
// Energy/Cost mode swaps the primary and secondary metric everywhere
// on the tab. Home usage comes from the summary the dashboard already
// fetches (import + PV - export - net battery) and only matches the
// current period, so the share column reads as unavailable on past
// periods and on the year granularity.
function UsagePage() {
  const { period, isCurrent } = usePeriod()
  const { mode } = useMode()
  const anchor = useMemo(
    () => ({ period: period.kind, date: period.date }),
    [period.kind, period.date]
  )
  const { data, status } = useAppliances(
    period.kind === "day" ? "today" : period.kind,
    anchor
  )
  const breakdown = useUsageBreakdown(anchor)
  const { summary } = useSummary()
  const hasData = periodHasData(period, PLUG_DATA_START)

  const homeUsageKwh =
    summary === null || !isCurrent
      ? null
      : period.kind === "day"
        ? summary.today.total_usage_kwh
        : period.kind === "week"
          ? summary.week.total_usage_kwh
          : period.kind === "month"
            ? summary.month.total_usage_kwh
            : null
  const plugKwh = data?.totals.plug_kwh ?? null
  const restOfHomeKwh =
    homeUsageKwh === null || plugKwh === null
      ? null
      : Math.max(0, homeUsageKwh - plugKwh)

  return (
    <PageLayout
      title="Usage"
      subtitle="Where the household's energy goes"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <PeriodNavigator />
          <ModeToggle />
        </div>
      }
    >
      {/* The tab's two-column grid: the left column stacks the period
          summary above the Usage breakdown panel, the right column
          holds the Rest of your home card alone. On narrow screens
          the single-column order is summary, treemap, Rest of your
          home. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <UsageSummaryCard
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
            period={period}
          />
          <UsageTreemap
            data={breakdown.data}
            status={breakdown.status}
            mode={mode}
            period={period}
            hasData={periodHasData(period)}
          />
        </div>
        <RestOfHomeCard
          data={breakdown.data}
          status={breakdown.status}
          mode={mode}
        />
      </div>
      {!hasData ? (
        <p className="rounded-xl border bg-card p-4 shadow-card text-sm text-muted-foreground">
          No smart plug data for this period.
        </p>
      ) : (
        <>
          {status === "loading" && (
            <div
              className="min-h-64 animate-pulse rounded-lg bg-muted"
              aria-hidden="true"
            />
          )}
          {status === "error" && (
            <p className="rounded-xl border bg-card p-4 shadow-card text-sm text-muted-foreground">
              Could not load appliance data. Try again in a moment.
            </p>
          )}
          {status === "ok" && data !== null && (
            <>
              {data.appliances.length === 0 &&
              data.totals.plug_kwh === 0 &&
              data.hourly.length === 0 ? (
                <p className="rounded-xl border bg-card p-4 shadow-card text-sm text-muted-foreground">
                  No appliance data yet. The first energy deltas appear
                  after the first completed appliance cycle
                  {" \u2014 "}smart plugs report their energy once a run
                  finishes.
                </p>
              ) : (
                <>
                  <ApplianceUsageWidget
                    appliances={data.appliances}
                    plugKwh={plugKwh}
                    restOfHomeKwh={restOfHomeKwh}
                    mode={mode}
                  />
                  {period.kind === "day" && data.hourly.length > 0 && (
                    <HourlyChart
                      hourly={data.hourly}
                      title={
                        isCurrent
                          ? "Today per hour"
                          : `${periodLabel(period)} per hour`
                      }
                    />
                  )}
                  {isCurrent && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                        so far
                      </span>
                      This period is still in progress
                    </p>
                  )}
                  <TotalsTable
                    data={data}
                    mode={mode}
                    homeKwh={
                      restOfHomeKwh !== null && plugKwh !== null
                        ? restOfHomeKwh + plugKwh
                        : null
                    }
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </PageLayout>
  )
}

export default UsagePage
