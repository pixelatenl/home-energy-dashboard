import { Card, CardContent } from "@/components/ui/card"
import type { HeatModelData } from "@/lib/api"

// One input line of a route: a muted label and its value.
function ModelInput({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{label}</span>
      <span>{value}</span>
    </p>
  )
}

// The heating cost card: both routes side by side for the period. The
// gas route is the cost basis; every heat pump number carries an
// estimate label. A route without data shows the not-enough-data
// note, never zeros. The card informs; it does not advise.
function HeatingModelCard({
  data,
  status,
}: {
  data: HeatModelData | null
  status: "loading" | "ok" | "error"
}) {
  if (status === "loading" && data === null) {
    return (
      <div
        className="min-h-48 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }
  if (status === "error") {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Could not load the heating cost model. Try again in a moment.
        </CardContent>
      </Card>
    )
  }
  if (data === null) {
    return null
  }

  const gas = data.gas_route
  const pump = data.heat_pump_route
  const assumptions = data.assumptions

  return (
    <Card>
      <CardContent>
        <p className="text-sm font-medium">Heating cost</p>
        <div className="mt-3 grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Gas</p>
            {gas.cost_per_kwh_heat === null ? (
              <p className="text-sm text-muted-foreground">
                Not enough data for this period.
              </p>
            ) : (
              <>
                <p className="text-xl font-semibold tabular-nums">
                  €{gas.cost_per_kwh_heat.toFixed(4)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    per kWh heat
                  </span>
                </p>
                <div className="space-y-1">
                  <ModelInput
                    label="Gas price"
                    value={`${gas.price_eur_per_m3?.toFixed(4)} EUR/m3`}
                  />
                  <ModelInput
                    label="Calorific value"
                    value={`${gas.calorific_kwh_per_m3} kWh/m3`}
                  />
                  <ModelInput
                    label="Boiler efficiency"
                    value={String(gas.boiler_efficiency)}
                  />
                </div>
              </>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Heat pump
              <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                estimate
              </span>
            </p>
            {pump.cost_per_kwh_heat === null ? (
              <p className="text-sm text-muted-foreground">
                Not enough data for this period.
              </p>
            ) : (
              <>
                <p className="text-xl font-semibold tabular-nums">
                  €{pump.cost_per_kwh_heat.toFixed(4)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    per kWh heat (estimate)
                  </span>
                </p>
                <div className="space-y-1">
                  <ModelInput
                    label="Avg electricity price (estimate)"
                    value={`${pump.avg_electricity_price_eur_per_kwh?.toFixed(4)} EUR/kWh`}
                  />
                  <ModelInput
                    label="Avg COP (estimate)"
                    value={String(pump.avg_cop)}
                  />
                  <ModelInput
                    label="Avg outdoor temp (estimate)"
                    value={`${pump.avg_outdoor_temp?.toFixed(1)} \u00b0C`}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Assumptions in use
          </p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            <li className="flex justify-between gap-2">
              <span>Gas calorific value (EMS_GAS_CALORIFIC_KWH_PER_M3)</span>
              <span className="tabular-nums">
                {assumptions.gas_calorific_kwh_per_m3} kWh/m3
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Boiler efficiency, condensing (EMS_BOILER_EFFICIENCY)</span>
              <span className="tabular-nums">
                {assumptions.boiler_efficiency}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>
                COP from outdoor temperature, linear and clamped
                (EMS_COP_AT_7C / EMS_COP_AT_MINUS_7C)
              </span>
              <span className="tabular-nums">
                {assumptions.cop_at_7c} at 7 °C ·{" "}
                {assumptions.cop_at_minus_7c} at -7 °C
              </span>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

export default HeatingModelCard
