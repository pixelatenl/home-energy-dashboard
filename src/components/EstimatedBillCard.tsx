import { useState } from "react"
import { Receipt } from "lucide-react"
import SkeletonReveal from "@/components/SkeletonReveal"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ProfileBillAssumptions, ProfileBillComponents } from "@/lib/api"
import { DEFAULT_DATA_START, periodLabel, todayString } from "@/lib/period"
import { formatEur, signedEur } from "@/lib/statCard"
import { useProfileBill } from "@/lib/useProfileBill"

const MONTH_SHORT_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
})

// All YYYY-MM keys from startMonth to endMonth, inclusive.
function monthKeysBetween(startMonth: string, endMonth: string): string[] {
  const keys: string[] = []
  let [year, month] = startMonth.split("-").map(Number)
  const [endYear, endMonthNum] = endMonth.split("-").map(Number)
  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return keys
}

// One breakdown row: a muted label and its value, the heating model
// card's input-line idiom.
function BillRow({
  label,
  value,
  emphasis = false,
  indent = false,
}: {
  label: string
  value: string
  emphasis?: boolean
  indent?: boolean
}) {
  return (
    <li
      className={`flex justify-between gap-2 text-xs tabular-nums ${
        indent ? "pl-3" : ""
      } ${
        emphasis ? "font-medium text-foreground" : "text-muted-foreground"
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </li>
  )
}

// The card body once a month with data is loaded: the estimated total
// with its markers, the component breakdown rows, and the assumptions
// in an expandable section (the heat page's assumptions idiom behind a
// details toggle).
function BillBody({
  month,
  components,
  assumptions,
  inProgress,
  partialMonth,
}: {
  month: string
  components: ProfileBillComponents
  assumptions: ProfileBillAssumptions
  inProgress: boolean
  partialMonth: boolean
}) {
  const fixed = components.fixed
  const unknownPrice =
    components.import.has_unknown_price ||
    components.export.has_unknown_price ||
    components.gas.has_unknown_price
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xl font-semibold tabular-nums">
          {formatEur(components.total_eur)}
        </p>
        <span className="text-sm text-muted-foreground">
          estimated total for{" "}
          {periodLabel({ kind: "month", date: `${month}-15` })}
        </span>
        {inProgress && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-chip-foreground">
            in progress
          </span>
        )}
        {partialMonth && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-chip-foreground">
            partial month
          </span>
        )}
      </div>
      <ul className="mt-3 space-y-1">
        <BillRow
          label={`Import (${components.import.kwh.toFixed(1)} kWh)`}
          value={formatEur(components.import.cost_eur)}
        />
        <BillRow
          label={`Export credit incl. bonus (${components.export.kwh.toFixed(1)} kWh)`}
          value={signedEur(
            -(components.export.credit_eur + components.export.bonus_eur)
          )}
        />
        <BillRow
          label={`Gas (${components.gas.billed_m3.toFixed(1)} m3 billed)`}
          value={formatEur(components.gas.cost_eur)}
        />
        <BillRow
          label="Fixed costs"
          value={formatEur(components.fixed.total_eur)}
        />
        <BillRow
          indent
          label="Energy tax, electricity"
          value={formatEur(fixed.electricity.energy_tax)}
        />
        <BillRow
          indent
          label="Energy tax, gas"
          value={formatEur(fixed.gas.energy_tax)}
        />
        <BillRow
          indent
          label="Supply costs, electricity"
          value={formatEur(fixed.electricity.supply)}
        />
        <BillRow
          indent
          label="Supply costs, gas"
          value={formatEur(fixed.gas.supply)}
        />
        <BillRow
          indent
          label="Energy tax reduction"
          value={signedEur(fixed.electricity.energy_tax_reduction)}
        />
        <BillRow
          indent
          label="Grid costs, electricity"
          value={formatEur(fixed.electricity.grid)}
        />
        <BillRow
          indent
          label="Grid costs, gas"
          value={formatEur(fixed.gas.grid)}
        />
        <li className="flex justify-between gap-2 border-t pt-1 text-xs font-medium text-foreground tabular-nums">
          <span>Total</span>
          <span>{formatEur(components.total_eur)}</span>
        </li>
      </ul>
      {unknownPrice && (
        <p className="mt-2 text-xs text-subtle-foreground">
          Some hours or days had no known price; their volumes count but
          not their cost.
        </p>
      )}
      <details className="mt-4 border-t pt-3">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Assumptions in use
        </summary>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          <li>{assumptions.tariff_composition}</li>
          <li>{assumptions.export_credit_hypothesis}</li>
          <li>
            Energy tax EUR {assumptions.energy_tax_eur_incl_vat}/kWh incl.
            VAT ({assumptions.energy_tax_year}); Zonnebonus{" "}
            {Math.round(assumptions.zonnebonus * 100)}%; gas correction
            factor {assumptions.gas_correction_factor}.
          </li>
          <li>{assumptions.gas_correction_note}</li>
          <li>{assumptions.fixed_costs_basis}</li>
          <li>{assumptions.annual_energy_tax_true_up}</li>
          <li>{assumptions.excluded}</li>
          <li>{assumptions.data_completeness}</li>
        </ul>
      </details>
    </div>
  )
}

// The profile page's Estimated bill card: live, one local calendar
// month at a time. The current month to date is the default; every
// completed month since the data start is selectable in the header's
// segmented control (the nav idiom). The body shows the total, the
// component breakdown (import, export credit plus bonus, gas, the
// fixed components, total) and the model's assumptions behind an
// expandable section.
function EstimatedBillCard() {
  // Fresh on every render, so the default month follows the clock
  // across midnight on a long-lived kiosk session.
  // eslint-disable-next-line react/purity
  const currentMonth = todayString(new Date()).slice(0, 7)
  const months = monthKeysBetween(
    DEFAULT_DATA_START.slice(0, 7),
    currentMonth
  )
  // Null means "not chosen yet": the current month to date.
  const [chosen, setChosen] = useState<string | null>(null)
  const month = chosen ?? currentMonth
  const { data, status } = useProfileBill(month)

  const loading = status === "loading" && data === null
  const skeleton = (
    <Card className="min-h-64" aria-busy="true">
      <div className="grid auto-rows-min items-start gap-1 px-4">
        <Skeleton className="h-[24.75px] w-36" />
        <Skeleton className="h-5 w-72" />
      </div>
      <CardContent className="space-y-1.5">
        <Skeleton className="h-7 w-32" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  )

  return (
    <SkeletonReveal loading={loading} skeleton={skeleton}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-title-foreground">
            <Receipt className="size-6" aria-hidden="true" />
            Estimated bill
          </CardTitle>
          <CardDescription>
            Estimated monthly bill from measured data, with energy tax, VAT,
            fixed supplier and grid costs, and saldering for export.
          </CardDescription>
          <CardAction>
            <div className="inline-flex rounded-md border p-1">
              {months.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={key === month}
                  onClick={() => setChosen(key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none ${
                    key === month
                      ? "bg-white/20 text-chip-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {MONTH_SHORT_YEAR.format(new Date(`${key}-01T00:00:00Z`))}
                </button>
              ))}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {status === "error" ? (
            <p className="text-sm text-subtle-foreground">
              Could not load the bill estimate. Try again in a moment.
            </p>
          ) : data === null ? null : data.status === "empty" ||
            data.components === null ? (
            <p className="text-sm text-subtle-foreground">
              No data for this month yet. Data collection started on 10
              October 2026.
            </p>
          ) : (
            <BillBody
              month={month}
              components={data.components}
              assumptions={data.assumptions}
              inProgress={data.in_progress}
              partialMonth={data.partial_month}
            />
          )}
        </CardContent>
      </Card>
    </SkeletonReveal>
  )
}

export default EstimatedBillCard
