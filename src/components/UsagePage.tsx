import ApplianceUsageWidget from "@/components/ApplianceUsageWidget"
import PageLayout from "@/components/PageLayout"
import PeriodNavigator from "@/components/PeriodNavigator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ApplianceHour, ApplianceRange, ApplianceSummary } from "@/lib/api"
import { applianceColor } from "@/lib/applianceColors"
import { localHourOf } from "@/lib/time"
import { useAppliances } from "@/lib/useAppliances"
import { usePeriod } from "@/lib/usePeriod"
import { useSummary } from "@/lib/useSummary"

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

// Stacked bar chart of kWh per hour per appliance for today, built from
// plain divs: segment heights are percentages of the busiest hour.
function HourlyChart({ hourly }: { hourly: ApplianceHour[] }) {
  const byHour = hourSlots(hourly)
  const maxKwh = Math.max(0.001, ...[...byHour.values()].map((s) => s.totalKwh))
  const appliances = [...new Set(hourly.map((row) => row.appliance))]

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">Today per hour</p>
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

// Totals table: per appliance the kWh, cost and share of home usage, plus
// a "Total appliances" summary row.
function TotalsTable({
  data,
  homeKwh,
}: {
  data: ApplianceSummary
  homeKwh: number | null
}) {
  const shareOf = (kwh: number | null): string =>
    homeKwh !== null && kwh !== null && homeKwh > 0
      ? `${Math.round((kwh / homeKwh) * 100)}%`
      : "\u2014"
  const fmt = (value: number | null, digits: number): string =>
    value === null ? "\u2014" : value.toFixed(digits)

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">Totals</p>
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>Appliance</TableHead>
            <TableHead className="text-right">Energy</TableHead>
            <TableHead className="text-right">Cost</TableHead>
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
                {fmt(appliance.kwh, 2)} kWh
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {appliance.cost_eur === null
                  ? "\u2014"
                  : `\u20ac${fmt(appliance.cost_eur, 2)}`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {shareOf(appliance.kwh)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Total appliances</TableCell>
            <TableCell className="text-right tabular-nums">
              {fmt(data.totals.plug_kwh, 2)} kWh
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {`\u20ac${fmt(data.totals.plug_cost, 2)}`}
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

// The appliance usage view: the shared period navigator in the tab
// row, the full usage widget on top, today's hourly stacked chart and
// the totals table beneath. Home usage comes from the summary the
// dashboard already fetches (import + PV - export - net battery); the
// year range has no summary equivalent, so percentages read as
// unavailable there. The appliance API has no date parameter yet, so
// the fetch rides the period kind only (the navigator's day reads as
// the API's "today").
function UsagePage() {
  const { period } = usePeriod()
  const range: ApplianceRange = period.kind === "day" ? "today" : period.kind
  const { data, status } = useAppliances(range)
  const { summary } = useSummary()

  const homeUsageKwh =
    summary === null
      ? null
      : range === "today"
        ? summary.today.total_usage_kwh
        : range === "week"
          ? summary.week.total_usage_kwh
          : range === "month"
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
      subtitle="What your smart-plug appliances use"
      toolbar={<PeriodNavigator />}
    >
        {status === "loading" && (
          <div
            className="min-h-64 animate-pulse rounded-lg bg-muted"
            aria-hidden="true"
          />
        )}
        {status === "error" && (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            Could not load appliance data. Try again in a moment.
          </p>
        )}
        {status === "ok" && data !== null && (
          <>
            {data.appliances.length === 0 &&
            data.totals.plug_kwh === 0 &&
            data.hourly.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                No appliance data yet. The first energy deltas appear after
                the first completed appliance cycle{" \u2014 "}smart plugs
                report their energy once a run finishes.
              </p>
            ) : (
              <>
                <ApplianceUsageWidget
                  appliances={data.appliances}
                  plugKwh={plugKwh}
                  restOfHomeKwh={restOfHomeKwh}
                />
                {range === "today" && data.hourly.length > 0 && (
                  <HourlyChart hourly={data.hourly} />
                )}
                <TotalsTable data={data} homeKwh={
                  restOfHomeKwh !== null && plugKwh !== null
                    ? restOfHomeKwh + plugKwh
                    : null
                } />
              </>
            )}
          </>
        )}
    </PageLayout>
  )
}

export default UsagePage
