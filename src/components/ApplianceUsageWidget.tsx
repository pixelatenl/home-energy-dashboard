import { REST_COLOR, applianceColor } from "@/lib/applianceColors"
import type { Appliance } from "@/lib/api"

// A power sample counts as live for 15 minutes; above 10 W the appliance
// reads as active (same stale treatment as the battery panel).
const STALE_AFTER_MS = 15 * 60_000
const ACTIVE_THRESHOLD_W = 10

function formatKwh(value: number | null): string {
  return value === null ? "\u2014" : `${value.toFixed(2)} kWh`
}

function formatEur(value: number | null): string {
  return value === null ? "\u2014" : `\u20ac${value.toFixed(2)}`
}

function formatShare(value: number | null): string {
  return value === null ? "\u2014" : `${Math.round(value * 100)}%`
}

// Live state line: active with the latest power above the threshold,
// standby below it, unknown when the latest sample is stale or missing.
function liveState(powerW: number | null, powerTs: string | null): string {
  if (powerW === null || powerTs === null) {
    return "unknown"
  }
  if (Date.now() - new Date(powerTs).getTime() > STALE_AFTER_MS) {
    return "unknown"
  }
  return powerW > ACTIVE_THRESHOLD_W
    ? `active \u00b7 ${Math.round(powerW)} W`
    : "standby"
}

interface CardShare {
  // Fraction of total home usage, null when home usage is unknown.
  share: number | null
}

// One appliance tile: colored border, name, kWh, cost, share of home
// usage and the live state line.
function ApplianceTile({
  appliance,
  kwh,
  cost_eur,
  power_w,
  power_ts,
  share,
}: CardShare & Appliance) {
  const color = applianceColor(appliance)
  const state = liveState(power_w, power_ts)
  return (
    <div
      className="rounded-lg border-2 bg-card p-4"
      style={{ borderColor: color }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          {appliance}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatShare(share)}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {formatKwh(kwh)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {formatEur(cost_eur)}
      </p>
      <p
        className={`mt-2 text-xs tabular-nums ${
          state === "active"
            ? "font-medium"
            : state === "standby"
              ? "text-muted-foreground"
              : "italic text-muted-foreground"
        }`}
        style={state === "active" ? { color } : undefined}
      >
        {state}
      </p>
    </div>
  )
}

// The neutral residual tile: everything the smart plugs do not see.
function RestOfHomeTile({ kwh, share }: CardShare & { kwh: number }) {
  return (
    <div
      className="rounded-lg border-2 bg-card p-4"
      style={{ borderColor: REST_COLOR }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: REST_COLOR }}
            aria-hidden="true"
          />
          Rest of home
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatShare(share)}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {formatKwh(kwh)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        heat, standby, lighting
      </p>
    </div>
  )
}

interface BreakdownRow {
  name: string
  kwh: number | null
  color: string
}

// Percentage breakdown: one horizontal bar per appliance plus the rest of
// home, its width the share of total home usage. When home usage is
// unknown the bars fall back to shares of the plug total and the
// percentage labels show a dash.
function Breakdown({
  rows,
  homeKwh,
  plugKwh,
}: {
  rows: BreakdownRow[]
  homeKwh: number | null
  plugKwh: number | null
}) {
  const denominator = homeKwh ?? plugKwh
  return (
    <div className="mt-5">
      <p className="text-sm font-medium">Share of home usage</p>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const fraction =
            row.kwh !== null && denominator !== null && denominator > 0
              ? Math.min(row.kwh / denominator, 1)
              : 0
          return (
            <div key={row.name} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                {row.name}
              </span>
              <div className="h-2 flex-1 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${fraction * 100}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                {formatShare(
                  homeKwh !== null && row.kwh !== null && homeKwh > 0
                    ? row.kwh / homeKwh
                    : null
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The appliance usage card, modeled on the Google Nest "what uses power
// in your home" card: a responsive grid of colored appliance tiles plus
// the rest-of-home residual, and in full mode a percentage breakdown
// underneath. Purely presentational; the caller fetches and passes the
// data. When home usage is unknown (restOfHomeKwh null) the residual
// tile is omitted and percentages read as unavailable.
function ApplianceUsageWidget({
  appliances,
  plugKwh,
  restOfHomeKwh,
  compact = false,
}: {
  appliances: Appliance[]
  plugKwh: number | null
  restOfHomeKwh: number | null
  compact?: boolean
}) {
  const homeKwh =
    restOfHomeKwh !== null && plugKwh !== null ? plugKwh + restOfHomeKwh : null
  const shareOf = (kwh: number | null): number | null =>
    homeKwh !== null && kwh !== null && homeKwh > 0 ? kwh / homeKwh : null

  const breakdownRows: BreakdownRow[] = [
    ...appliances.map((appliance) => ({
      name: appliance.appliance,
      kwh: appliance.kwh,
      color: applianceColor(appliance.appliance),
    })),
    ...(restOfHomeKwh !== null
      ? [{ name: "Rest of home", kwh: restOfHomeKwh, color: REST_COLOR }]
      : []),
  ]

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">What uses power in your home</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {appliances.map((appliance) => (
          <ApplianceTile
            key={appliance.appliance}
            {...appliance}
            share={shareOf(appliance.kwh)}
          />
        ))}
        {restOfHomeKwh !== null && (
          <RestOfHomeTile kwh={restOfHomeKwh} share={shareOf(restOfHomeKwh)} />
        )}
      </div>
      {!compact && (
        <Breakdown
          rows={breakdownRows}
          homeKwh={homeKwh}
          plugKwh={plugKwh}
        />
      )}
    </div>
  )
}

export default ApplianceUsageWidget
