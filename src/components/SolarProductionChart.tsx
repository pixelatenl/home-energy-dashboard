import { useState } from "react"
import { Sun, Sunrise, Sunset } from "lucide-react"
import PanelHeader from "@/components/PanelHeader"
import { Card, CardContent } from "@/components/ui/card"
import type { SolarProductionData, WeatherHour } from "@/lib/api"
import type { Mode } from "@/lib/mode"
import {
  DEFAULT_DATA_START,
  periodHasData,
  periodLabel,
  periodStart,
  type Period,
} from "@/lib/period"
import {
  exportPricingLabel,
  intervalPriceOf,
  solarSlotLabel,
  solarSlots,
  solarSplitOf,
  type DaylightWindow,
  type SolarSlot,
} from "@/lib/solarChart"
import { dateKeyPlus, localHourOf } from "@/lib/time"

// The chart's geometry, the per-slot chart's idiom: the viewBox height
// equals the rendered height (h-56 = 224px), so one viewBox unit is
// one pixel vertically and the HTML y-axis labels sit exactly on the
// gridlines. Only the x axis stretches with the width.
const WIDTH = 960
const HEIGHT = 224
const TOP = 10
const BASE = HEIGHT - 6
const GRID_LINES = 3
const UNKNOWN_HEIGHT = 12

// A nice step for the y axis: 1, 2, 2.5 or 5 times a power of ten.
function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))))
  const factor = raw / power
  const nice = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10
  return nice * power
}

// A bar with rounded top corners only (the per-slot chart's path).
function barPath(
  x: number,
  width: number,
  top: number,
  base: number,
  radius: number
): string {
  const r = Math.min(radius, width / 2, base - top)
  return `M ${x} ${base} V ${top + r} A ${r} ${r} 0 0 1 ${x + r} ${top} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${top + r} V ${base} Z`
}

function formatKwh(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} kWh`
}

// Money with the usage pages' sign convention: negative amounts
// read "−€0.09" (the Unicode minus), never clamped to zero -
// negative return prices genuinely cost money.
function formatEur(value: number): string {
  return `${value < 0 ? "−" : ""}€${Math.abs(value).toFixed(2)}`
}

interface SolarProductionChartProps {
  data: SolarProductionData | null
  status: "loading" | "ok" | "error"
  mode: Mode
  period: Period
  isCurrent: boolean
  forecast: WeatherHour[] | null
  // The day view's sunrise-to-sunset axis window (local hours,
  // inclusive); null keeps the full 24-hour day axis.
  dayWindow?: DaylightWindow | null
}

// The Solar Production chart, the page's first content block: PV
// production per hour (day and week periods, bars for a day and a
// production curve for a week) or per day (month and year, daily
// bars), on a full-period axis. The day view's axis narrows to the
// sunrise-to-sunset daylight window (the same clip as the 5-day
// forecast's hourly chart, the seasonal defaults approximating past
// days), falling back to the full 24 hours only while the window
// fetch fails. Energy mode reads kWh; Cost mode
// switches the primary axis to the avoided cost (bottom-up per
// interval) - intervals without a known price get a hatched marker,
// are excluded from the total and never render 0. Tooltips always
// carry kWh, the interval price and the avoided cost together; in
// cost mode they also carry the disposition split and the raw
// export counter's kWh with its earnings at the hour's return
// price. On the current day in energy mode the hourly forecast
// rides as a dashed overlay curve on the same axis; in cost mode
// the overlay is omitted (the forecast is a kWh figure, and pricing
// it would invent an hourly price the payload does not carry).
function SolarProductionChart({
  data,
  status,
  mode,
  period,
  isCurrent,
  forecast,
  dayWindow = null,
}: SolarProductionChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const hourly = period.kind === "day" || period.kind === "week"
  const curve = hourly && period.kind === "week"
  const dayStart =
    period.kind === "day" && dayWindow !== null ? dayWindow.startHour : 0
  const slots = data
    ? solarSlots(data.series, period, period.kind === "day" ? dayWindow : null)
    : []
  const slotCount = Math.max(1, slots.length)
  const slotWidth = WIDTH / slotCount

  // The mode's primary value per slot: kWh in energy mode, the
  // avoided cost in cost mode. An unrecorded slot (no production,
  // e.g. night hours) reads 0 in both modes; a recorded slot whose
  // price is unknown reads null in cost mode - hatched, excluded
  // from the total, never 0.
  const slotValue = (slot: SolarSlot): number | null => {
    if (mode === "energy") {
      return slot.kwh
    }
    if (slot.point === null) {
      return 0
    }
    return slot.point.avoidedCostEur
  }

  const knownMax = Math.max(
    ...slots.map((slot) => slotValue(slot) ?? 0),
    0.001
  )
  const step = niceStep(knownMax / GRID_LINES)
  const axisMax = step * GRID_LINES
  const valueY = (value: number): number =>
    BASE - Math.min(value / axisMax, 1) * (BASE - TOP)

  // The day view's now marker: the current local hour, on the current
  // day period only, and only while it falls inside the axis - on a
  // daylight window that means while the sun is up.
  const nowHour =
    isCurrent && hourly && period.kind === "day" && data !== null
      ? // eslint-disable-next-line react/purity
        localHourOf(new Date().toISOString())
      : null
  const nowVisible =
    nowHour !== null && nowHour >= dayStart && nowHour < dayStart + slotCount

  // The dashed forecast overlay, on the current day in energy mode:
// one point per forecast hour, on the same kWh axis and shifted
  // into the day's axis window.
  const forecastPoints =
    mode === "energy" && period.kind === "day" && forecast
      ? forecast
          .map((hour) => {
            const index = Number(hour.hour.slice(11, 13)) - dayStart
            if (index < 0 || index >= slotCount) {
              return null
            }
            return `${(index + 0.5) * slotWidth},${valueY(hour.estimated_pv_wh / 1000)}`
          })
          .filter((point): point is string => point !== null)
          .join(" ")
      : ""

  const hovered = hoveredIndex !== null ? (slots[hoveredIndex] ?? null) : null

  const tickLabel = (value: number): string => {
    if (mode === "energy") {
      return step < 1 ? value.toFixed(1) : String(Math.round(value))
    }
    return value.toFixed(step < 0.1 ? 2 : 1)
  }

  // The x-axis label beneath each slot, centered on its slot's bar:
  // the day view labels every clock hour of its window (in sync with
  // the daylight offset), the week its midnights, month and year
  // their calendar days.
  const axisLabel = (slot: SolarSlot): string => {
    if (period.kind === "day") {
      return String(dayStart + slot.index).padStart(2, "0")
    }
    if (period.kind === "week") {
      // The week curve: a weekday at each local midnight.
      if (slot.index % 24 !== 0) {
        return ""
      }
      const day = dateKeyPlus(periodStart(period), slot.index / 24)
      return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
      })
    }
    const day = dateKeyPlus(periodStart(period), slot.index)
    const dayOfMonth = Number(day.slice(8))
    if (period.kind === "month") {
      if (slot.index === 0) {
        return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
        })
      }
      return String(dayOfMonth)
    }
    // The year's daily bars: a month abbreviation at each month's
    // first day.
    return dayOfMonth === 1
      ? new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
          month: "short",
        })
      : ""
  }

  // The honest empty state: a period entirely before the data start
  // never fabricates zeros.
  const dataStart = data?.dataStart ?? DEFAULT_DATA_START
  if (!periodHasData(period, dataStart)) {
    return (
      <Card>
        <PanelHeader
          icon={Sun}
          title="Solar Production"
          description={`${periodLabel(period)} - PV production per ${hourly ? "hour" : "day"}`}
        />
        <CardContent>
          <p className="min-h-32 text-sm text-muted-foreground">
            No PV data for this period. Production data starts on 10
            October 2026.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Both modes render their figures as the usage tab's
  // period-summary stat row - small muted label, big bold value -
  // one stat per figure, no cards: energy mode the total and peak,
  // cost mode the five money figures. The export earnings can read
  // negative when negative prices outweigh the fees; the combined
  // benefit stays null (an em dash, never 0) while any component is
  // unknown.
  const costNet = data?.totals.totalCostNetEur ?? null

  return (
    <Card>
      <PanelHeader
        icon={Sun}
        title="Solar Production"
        description={`${periodLabel(period)} - PV production per ${hourly ? "hour" : "day"}`}
      />
      <CardContent>
        {data === null ? (
          status === "error" ? (
            <p className="min-h-32 text-sm text-muted-foreground">
              Could not load the solar production data.
            </p>
          ) : (
            <div className="h-56 animate-pulse rounded-lg bg-muted" />
          )
        ) : slots.length === 0 || data.series.length === 0 ? (
          <p className="min-h-32 text-sm text-muted-foreground">
            No production recorded for this period yet.
          </p>
        ) : (
          <>
            {mode === "cost" ? (
              <>
                {/* The cost figures as the usage tab's period-summary
                    stat row: label above, big bold value below, one
                    plain div per stat - no cards. */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Solar benefit (savings + export)
                    </p>
                    <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                      {costNet === null ? "\u2014" : formatEur(costNet)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Avoided cost (self-consumed)
                    </p>
                    <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                      {formatEur(data.totals.selfConsumptionAvoidedCostEur)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Export earnings
                    </p>
                    {data.totals.exportEarningsEur === null ? (
                      <p className="text-2xl font-semibold tabular-nums opacity-60 sm:text-3xl">
                        unknown
                      </p>
                    ) : (
                      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                        {formatEur(data.totals.exportEarningsEur)}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      If all production were self-consumed
                    </p>
                    <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                      {formatEur(data.totals.avoidedCostEur)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Peak</p>
                    {data.peak === null ? (
                      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                        {"\u2014"}
                      </p>
                    ) : (
                      <>
                        <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                          {formatKwh(data.peak.kwh)}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          at {solarSlotLabel(data.peak.ts, hourly)}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {hourly ? "Hourly" : "Daily"} resolution
                  {data.totals.hasUnknownPrice && " \u00b7 unpriced hours excluded"}
                </p>
              </>
            ) : (
              <>
                {/* The energy figures in the same period-summary
                    stat row as cost mode: label above, big bold
                    value below, no cards. */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                      {formatKwh(data.totals.kwh)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Peak</p>
                    {data.peak === null ? (
                      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                        {"\u2014"}
                      </p>
                    ) : (
                      <>
                        <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
                          {formatKwh(data.peak.kwh)}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          at {solarSlotLabel(data.peak.ts, hourly)}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {hourly ? "Hourly" : "Daily"} resolution
                </p>
              </>
            )}
            {/* The mt-4 leaves room above the chart for the Now
                label, the same breathing room the 5-day forecast's
                hourly chart reserves in its top band. The chart row
                mirrors the forecast's flex geometry exactly - w-8
                label column, gap-2, full-width plot, gap-2, w-8
                spacer - so on the day view the same clock hour sits
                at the same pixel in both charts. */}
            <div className="mt-4 flex gap-2">
              {/* The y-axis labels, on the gridlines. */}
              <div className="relative h-56 w-8 shrink-0">
                {Array.from({ length: GRID_LINES + 1 }, (_, i) => i * step).map(
                  (value) => (
                    <span
                      key={value}
                      className="pointer-events-none absolute right-0 -translate-y-1/2 text-right text-[10px] text-muted-foreground tabular-nums"
                      style={{ top: valueY(value) }}
                    >
                      {tickLabel(value)}
                    </span>
                  )
                )}
              </div>
              <div
                className="relative h-56 w-full"
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const index = Math.floor(
                    ((event.clientX - rect.left) / rect.width) * slotCount
                  )
                  setHoveredIndex(
                    index >= 0 && index < slotCount ? index : null
                  )
                }}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <svg
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  preserveAspectRatio="none"
                  className="h-56 w-full"
                  role="img"
                  aria-label="PV production per interval"
                >
                  <defs>
                    {/* The unknown-price hatch: a muted diagonal
                        pattern, never a zero-height bar. */}
                    <pattern
                      id="solar-unknown"
                      width="6"
                      height="6"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="6"
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        strokeWidth="2"
                      />
                    </pattern>
                  </defs>
                  {/* The gridlines and the axis baseline. */}
                  {Array.from({ length: GRID_LINES }, (_, i) => (i + 1) * step).map(
                    (value) => (
                      <line
                        key={value}
                        x1={0}
                        x2={WIDTH}
                        y1={valueY(value)}
                        y2={valueY(value)}
                        stroke="currentColor"
                        strokeOpacity={0.12}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  )}
                  <line
                    x1={0}
                    x2={WIDTH}
                    y1={BASE}
                    y2={BASE}
                    stroke="currentColor"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  {curve ? (
                    /* The week's production curve: every local hour,
                       nights at zero, as one line. Unknown-price
                       hours in cost mode drop out rather than read
                       as zero. */
                    <polyline
                      points={slots
                        .filter((slot) => slotValue(slot) !== null)
                        .map(
                          (slot) =>
                            `${(slot.index + 0.5) * slotWidth},${valueY(slotValue(slot)!)}`
                        )
                        .join(" ")}
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity={0.55}
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    slots.map((slot) => {
                      const value = slotValue(slot)
                      if (value === null) {
                        /* An unknown-price interval in cost mode: a
                           hatched marker at the baseline, excluded
                           from the total, never 0. */
                        return (
                          <rect
                            key={slot.index}
                            x={slot.index * slotWidth + slotWidth * 0.2}
                            y={BASE - UNKNOWN_HEIGHT}
                            width={slotWidth * 0.6}
                            height={UNKNOWN_HEIGHT}
                            fill="url(#solar-unknown)"
                          />
                        )
                      }
                      if (value <= 0) {
                        return null
                      }
                      return (
                        <path
                          key={slot.index}
                          d={barPath(
                            slot.index * slotWidth + slotWidth * 0.2,
                            slotWidth * 0.6,
                            valueY(value),
                            BASE,
                            5
                          )}
                          className="fill-muted-foreground/40"
                        />
                      )
                    })
                  )}
                  {forecastPoints !== "" && (
                    <polyline
                      points={forecastPoints}
                      fill="none"
                      stroke="#eab308"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {hoveredIndex !== null && (
                    <rect
                      x={hoveredIndex * slotWidth}
                      y={0}
                      width={slotWidth}
                      height={HEIGHT}
                      fill="currentColor"
                      opacity={0.08}
                    />
                  )}
                  {nowVisible && nowHour !== null && (
                    <line
                      x1={(nowHour - dayStart + 0.5) * slotWidth}
                      x2={(nowHour - dayStart + 0.5) * slotWidth}
                      y1={TOP}
                      y2={HEIGHT}
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeDasharray="2 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {/* The Now label above the marker's hour, the 5-day
                    forecast's wording and placement. */}
                {nowVisible && nowHour !== null && (
                  <span
                    className="pointer-events-none absolute -top-4 -translate-x-1/2 text-[10px] text-muted-foreground"
                    style={{
                      left: `${((nowHour - dayStart + 0.5) / slotCount) * 100}%`,
                    }}
                  >
                    Now
                  </span>
                )}
                {hovered && (
                  <div
                    className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
                    style={{
                      left: `${Math.min(Math.max((hoveredIndex! / slotCount) * 100, 12), 86)}%`,
                    }}
                  >
                    <div className="text-sm font-medium tabular-nums">
                      {hovered.point !== null
                        ? solarSlotLabel(hovered.point.ts, hourly)
                        : hourly
                          ? `${String(
                              period.kind === "day"
                                ? dayStart + hovered.index
                                : hovered.index % 24
                            ).padStart(2, "0")}:00`
                          : new Intl.DateTimeFormat("en-GB", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                              timeZone: "Europe/Amsterdam",
                            }).format(
                              new Date(
                                `${dateKeyPlus(periodStart(period), hovered.index)}T12:00:00`
                              )
                            )}{" "}
                      &middot; {formatKwh(hovered.kwh)}
                    </div>
                    {/* The tooltip always carries kWh, the interval
                        price and the avoided cost together; unknown
                        reads unknown, never 0. Cost mode adds the
                        solar disposition split - to home (with its
                        avoided cost), to grid, to battery - and the
                        raw export counter's kWh with its earnings at
                        the hour's return price, labeled distinctly
                        because the counter's export includes the
                        battery's while the split's grid share is
                        PV-capped. */}
                    {hovered.point !== null && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {(() => {
                          const price = intervalPriceOf(hovered.point)
                          const split = solarSplitOf(hovered.point)
                          return (
                            <>
                              {price === null
                                ? "price unknown"
                                : `≈ €${price.toFixed(3)}/kWh`}
                              {mode === "cost" &&
                                (split === null ? (
                                  <>
                                    <br />
                                    solar split unknown
                                  </>
                                ) : (
                                  <>
                                    <br />
                                    to home {formatKwh(split.homeKwh)}{" "}
                                    {hovered.point
                                      .selfConsumptionAvoidedCostEur ===
                                    null
                                      ? "(avoided cost unknown)"
                                      : `(${formatEur(hovered.point.selfConsumptionAvoidedCostEur)} avoided)`}
                                    <br />
                                    to grid {formatKwh(split.gridKwh)}
                                    <br />
                                    to battery{" "}
                                    {formatKwh(split.batteryKwh)}
                                    <br />
                                    {hovered.point.exportKwh ===
                                    null
                                      ? "export unknown"
                                      : `export ${formatKwh(
                                          hovered.point.exportKwh
                                        )}${
                                          hovered.point.exportEarningsEur ===
                                          null
                                            ? " (earnings unknown)"
                                            : ` (${formatEur(
                                                hovered.point.exportEarningsEur
                                              )} earned)`
                                        }`}
                                  </>
                                ))}
                              <br />
                              {hovered.point.avoidedCostEur === null
                                ? "avoided cost unknown"
                                : `${formatEur(hovered.point.avoidedCostEur)} avoided${
                                    mode === "cost"
                                      ? " (all production)"
                                      : ""
                                  }`}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* The right spacer: no axis lives here, but it keeps
                  the plot width identical to the 5-day forecast's
                  (whose Wh column rides in this position), so the
                  day view's hours line up across both charts. */}
              <div className="h-56 w-8 shrink-0" aria-hidden="true" />
            </div>
            {/* The x-axis label row, aligned with the bars: every
                label centers exactly on its slot's bar, at the
                same fraction as the bars themselves. The day view
                adds the sunrise and sunset icons at the plot's
                edges, the 5-day forecast's idiom - hidden on narrow
                widths, where the first and last labels would
                collide with them. */}
            <div className="relative mx-10 mt-1 h-4 text-xs text-muted-foreground tabular-nums">
              {period.kind === "day" && (
                <>
                  <Sunrise
                    className="absolute left-0 top-0 hidden size-4 sm:block"
                    aria-hidden="true"
                  />
                  <Sunset
                    className="absolute right-0 top-0 hidden size-4 sm:block"
                    aria-hidden="true"
                  />
                </>
              )}
              {slots.map((slot) => {
                const label = axisLabel(slot)
                if (label === "") {
                  return null
                }
                return (
                  <span
                    key={slot.index}
                    className="absolute top-0 -translate-x-1/2"
                    style={{
                      left: `${((slot.index + 0.5) / slotCount) * 100}%`,
                    }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
            {mode === "cost" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Solar benefit (savings + export) prices only the solar
                your home used at the grid price plus what the raw
                export counter earned; "if all production were
                self-consumed" values all production. Split figures
                are estimates - the P1 meter is net per hour and the
                battery can export during peak hours.{" "}
                {exportPricingLabel(data.meta.returnPricing)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default SolarProductionChart
