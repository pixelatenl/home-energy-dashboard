// Typed client for the local data server (server/index.mjs). All fetch calls
// for /api endpoints live here; components should import these functions.

import type { PeriodKind } from "@/lib/period"

export interface Entity {
  id: number
  ha_entity_id: string
  domain: string
  unit: string | null
  is_counter: boolean
}

export interface DailyTotal {
  id: number
  ha_entity_id: string
  domain: string
  day: string
  kwh: number
}

export interface HourlyTotal {
  id: number
  ha_entity_id: string
  domain: string
  hour: string
  kwh: number
}

export interface HourlySeriesPoint {
  id: number
  ha_entity_id: string
  domain: string
  unit: string | null
  hour: string
  avg_value: number | null
  max_value: number | null
}

export interface CurrentMeasurement {
  id: number
  ha_entity_id: string
  domain: string
  ts: string
  value: number | null
  state: string | null
  unit: string | null
}

// One field of the live snapshot (GET /api/live): the reading, its
// unit, where it came from and how old the reading is. A missing
// field is value null with source "none" - the server never
// fabricates a zero, so neither does the frontend.
export type LiveSource = "ha" | "db" | "none"

export interface LiveField {
  value: number | boolean | null
  unit: string | null
  source: LiveSource
  ageSeconds: number | null
}

// A server-computed state field (the single writer): the state itself,
// its source and the age of the readings it derives from. "unavailable"
// whenever the power readings are missing - never a guessed state.
export interface LiveStateField {
  state: BatteryState
  source: LiveSource
  ageSeconds: number | null
}

// The live power snapshot: the whitelisted power sensors (net grid
// draw, battery flow, SOC, PV) with per-field source and age.
export interface LiveSnapshot {
  fetchedAt: string
  cacheSeconds: number
  fields: {
    gridImportW: LiveField
    gridExportW: LiveField
    netGridW: LiveField
    batteryChargeW: LiveField
    batteryDischargeW: LiveField
    batterySocPct: LiveField
    // The server-computed battery state at the shared 25 W deadband,
    // rendered verbatim by the compact BatteryStatusWidget.
    batteryState: LiveStateField
    // The panels feeding the Anker directly (the solar split's input).
    batterySolarInW: LiveField
    pvPowerW: LiveField
    // Net export above the shared 25 W deadband; boolean, null when
    // the grid fields are missing.
    isExporting: LiveField
  }
}

export type PriceSource = "db" | "ha"

export interface PriceHour {
  ts: string
  price_eur: number | null
  source: PriceSource
}

export interface PriceDayStats {
  average: number | null
  min: number | null
  max: number | null
}

export interface PriceTomorrow extends PriceDayStats {
  available: boolean
  hours: PriceHour[]
}

export interface CheapestBlock {
  start: string
  end: string
  average_price: number
}

export interface PriceSummary {
  hours: PriceHour[]
  today: PriceDayStats
  tomorrow: PriceTomorrow
  cheapest_block: CheapestBlock | null
  // The day's actual cheapest window, whole-day: the single source the
  // advisory card and the prices widget both consume.
  day_cheapest_block: CheapestBlock | null
}

export interface RangeMetrics {
  import_kwh: number
  export_kwh: number
  pv_kwh: number | null
  // Share of the range's solar production used on site; null while
  // production is zero.
  self_consumption_pct: number | null
  total_usage_kwh: number
  cost_eur: number
  battery_charged_kwh: number | null
  battery_discharged_kwh: number | null
}

export type BatteryState =
  | "charging"
  | "discharging"
  | "idle"
  | "unavailable"

export interface BatteryFlowHour {
  ts: string
  in_kwh: number
  out_kwh: number
}

export interface BatterySocPoint {
  ts: string
  soc_pct: number
}

// One hour of today's actual PV production, for the live hero's
// compact solar chart.
export interface PvFlowHour {
  ts: string
  kwh: number
}

export interface FlowSnapshot {
  pv_w: number | null
  grid_import_w: number | null
  grid_export_w: number | null
  battery_solar_in_w: number | null
  battery_charge_w: number | null
  battery_discharge_w: number | null
}

// The grid renewables share ("Energy sustainability" hub stat):
// Zonneplan's wind-and-solar share of Dutch grid electricity, capped
// at 100 like the app displays it. Server-computed; the frontend only
// renders.
export type GridScoreState = "green" | "yellow" | "grey"

export interface GridScoreHour {
  // Local Amsterdam hour key "YYYY-MM-DDTHH".
  hour: string
  // The capped share (0-100) for that hour (average of the quarter-
  // hour blocks).
  score: number
}

export interface GridScore {
  current: number | null
  // Our own interpretation of the app's color badge, computed
  // server-side (green 75+, yellow 40-75, grey below 40).
  state: GridScoreState | null
  curve: GridScoreHour[]
  // How many hours the curve covers (current hour included).
  horizon_hours: number
  // Whether the forecast actually carries tomorrow, gated the same
  // way as tomorrow prices.
  tomorrow_available: boolean
  // The server-rendered sub-caption fact (e.g. "now, falls to 41 at
  // 19:00"), rendered verbatim; null when there is no honest
  // prediction (fail-soft or flat without horizon).
  sub: string | null
}

// The gridScore object in /api/debug/time: the display fields plus the
// raw uncapped permille of the current forecast block, the current
// value's source and the state thresholds, so the curve can be
// verified against the raw HA forecast.
export interface GridScoreDebug extends GridScore {
  raw_current_permille: number | null
  current_source: "forecast" | "sensor" | null
  thresholds: { green_min: number; yellow_min: number }
}

export interface SummaryData {
  today: RangeMetrics
  week: RangeMetrics
  month: RangeMetrics
  pv_available: boolean
  battery_available: boolean
  battery_soc_pct: number | null
  battery_power_w: number | null
  battery_power_age_min: number | null
  battery_state: BatteryState
  battery_flow_hourly: BatteryFlowHour[]
  battery_soc_series: BatterySocPoint[]
  pv_flow_hourly: PvFlowHour[]
  server_version: string
  flow: FlowSnapshot
  // The grid renewables share stat (Energy sustainability); null
  // fields when the Zonneplan forecast is unreachable.
  grid_score: GridScore | null
  battery_full_in_min?: number
  battery_empty_in_min?: number
  summary_as_of: string
  // The moment the underlying summary data was built (same value as
  // summary_as_of, exposed under the name the API contract uses).
  as_of: string
  // Stable hash over the materialized context fields the AI insight is
  // based on.
  signature: string
  // The cached AI insight served with the summary.
  insight: SummaryInsight
  // Remaining calls in the shared daily Mistral budget.
  remaining_calls: number
}

// The AI insight embedded in /api/summary: the structured decision
// payload (the only format) plus the metadata the kiosk needs to
// judge freshness. The guidance, advisory and outlook objects are
// served from the live snapshot extras at request time.
export interface SummaryInsight {
  // The decision structure: the primary action the server-side
  // candidates produced, its warning and context note.
  primary_action?: {
    what: string
    when: string
    saving_eur: number
    confidence: "high" | "medium" | "low"
  } | null
  supporting_facts?: string[]
  warning?: string | null
  // Explanatory context (why no candidates exist), rendered as a
  // muted footnote - never a warning.
  context_note?: string | null
  // True when no meaningful saving was available: every candidate is
  // belowThreshold (or none exists). The card leads with the honest
  // statement and omits the highlighted saving.
  no_opportunity?: boolean
  // The server-computed C1b candidates, for the muted largest-
  // opportunity line in the no-opportunity state.
  candidates?: InsightCandidate[]
  // Generic per-kWh timing guidance from the price data: leads the
  // card when no action exists, a muted fact line when one does.
  // Null on flat-price days.
  guidance?: {
    window: string
    cheapest_window_average_eur: number
    peak_hour: string
    peak_price_eur: number
    spread_per_kwh_eur: number
    // The practicality gate: the today imperative renders only when
    // the window starts before the evening pivot, enough of it
    // remains and its average sits meaningfully below the day's.
    practical: boolean
    window_start_hour: number
    hours_remaining: number
    day_average_eur: number | null
    day_cheapest_window: string | null
    day_cheapest_average_eur: number | null
    // The Phase E today modes: the peak-avoidance line renders while
    // the day's peak hour is ahead of now; the passed-hours fact only
    // when the day's cheap hours are actually gone; the evening price
    // situation carries today's remaining-hours average; the delay
    // comparison advises tomorrow's window once today stops
    // commanding.
    peak_ahead: boolean
    day_cheapest_passed: boolean
    remaining_average_eur: number | null
    delay: {
      tomorrow_window: string
      tomorrow_window_average_eur: number
      today_window_average_eur: number
    } | null
    line: string
  } | null
  // The week outlook rows, planning voice.
  outlook?: WeekOutlook | null
  // The day-ahead advisory: defer or advance heavy usage based on
  // tomorrow's prices and solar forecast versus the known days.
  // Renders as a distinct line beneath the guidance. Null when no
  // meaningful difference exists.
  advisory?: {
    type: "defer" | "advance"
    // Whether a prefer trigger fired: the row always renders with
    // forecast data; the recommendation only when this is true.
    triggered: boolean
    tomorrow_average_eur: number | null
    tomorrow_solar_kwh: number | null
    // Tomorrow's solar score and its low-solar flag: below
    // LOW_SOLAR_SCORE the unpublished-prices row reads as little sun
    // with the hedged market expectation.
    tomorrow_solar_score: number | null
    tomorrow_low_solar: boolean
    compare_day: string
    compare_average_eur: number | null
    compare_solar_kwh: number | null
    price_difference_per_kwh: number | null
    horizon_note: string
    // The server-composed narrative description (what the figures
    // mean - cheaper or pricier, more or less solar): the card's
    // description writer. Null when no honest narrative exists.
    line: string | null
  } | null
  // The grounding facts served next to the advisory: today's lowest
  // and peak price, each with its own timestamp, and the battery
  // state (SOC percentage and charging/discharging/idle) verbatim
  // from the context values. Each is null when its data is missing,
  // and the matching sentence is omitted with it - never guessed.
  lowPrice?: { timestamp: string; price: number } | null
  peakPrice?: { timestamp: string; price: number } | null
  battery?: {
    soc_pct: number
    state: "charging" | "discharging" | "idle"
  } | null
  // The deterministic sentences the server composes from the fields
  // above; the model never writes them. Rendered verbatim.
  priceSentence?: string | null
  batterySentence?: string | null
  // The deterministic achievement sentences (contract section 4):
  // recap mode only, at most one solar line and one battery line, in
  // that order, rendered verbatim - the sentences carry their own
  // periods. Always present from the advisory core, possibly empty -
  // below the threshold or without the fact, the line is omitted
  // entirely, never a vague substitute. Optional while the legacy
  // path serves payloads without the field (Stage 3b).
  achievements?: string[]
  generated_at: string | null
  // The data moment the cached insight text is based on; can trail the
  // top-level as_of while a regeneration is in flight.
  insight_as_of: string | null
  // The insight's regeneration state, computed server-side: "fresh"
  // (the cached insight matches the live signature), "reasoning" (the
  // signatures differ and a regeneration is in flight) or "error" (no
  // cached insight at all).
  state: "fresh" | "reasoning" | "error"
  // Deprecated mirror of state === "reasoning", kept one release for
  // old payload comparisons; remove with the C25 cleanup.
  stale?: boolean
  error: string | null
}

let summaryInFlight: Promise<SummaryData> | null = null

// Fetches /api/summary. Concurrent non-force callers share one
// in-flight request, so the kiosk refetch (several widgets poll this
// endpoint) never multiplies into a burst. With force, a fresh request
// is made that asks the server to regenerate the AI insight once
// regardless of the context signature.
export function fetchSummary(force = false): Promise<SummaryData> {
  if (!force && summaryInFlight) {
    return summaryInFlight
  }
  const promise = getJson<SummaryData>(
    withParams("/api/summary", force ? { force: "1" } : {})
  ).then(
    (value) => {
      if (summaryInFlight === promise) {
        summaryInFlight = null
      }
      return value
    },
    (error) => {
      if (summaryInFlight === promise) {
        summaryInFlight = null
      }
      throw error
    }
  )
  summaryInFlight = promise
  return promise
}

// GET /api/usage/breakdown: the category breakdown of household usage
// for a calendar period (docs/spec.md section 3). Every category
// carries kWh and cost for the period and the previous period; the
// heat pump is the one estimated category ("Est." class).
export interface UsageBreakdownCategory {
  key: string
  label: string
  class: "measured" | "Est." | "remainder"
  entities: string[]
  kwh: number
  cost_eur: number | null
  previous_kwh: number
  previous_cost_eur: number | null
}

export interface UsageBreakdown {
  period: PeriodKind
  date: string
  window: { start: string; end: string }
  previous: { period: PeriodKind; window: { start: string; end: string } }
  total: {
    kwh: number
    cost_eur: number | null
    previous_kwh: number
    previous_cost_eur: number | null
  }
  categories: UsageBreakdownCategory[]
  split: {
    measured_kwh: number
    estimated_kwh: number
    remainder_kwh: number
    measured_cost_eur: number | null
    estimated_cost_eur: number | null
    remainder_cost_eur: number | null
    previous_measured_kwh: number
    previous_estimated_kwh: number
    previous_remainder_kwh: number
  }
  // The window's average hourly electricity price (the flat basis for
  // costing model estimates); null when the window has no price rows.
  avg_price_eur: number | null
  // The grid statistics for the period summary strip's net view
  // (docs/spec.md section 7.1): physical volumes plus the hourly-priced
  // import cost and export credit; the priced fields are null without
  // usable price rows, never zero.
  grid_import_kwh: number
  grid_export_kwh: number
  import_cost_eur: number | null
  export_credit_eur: number | null
  // The home model (docs/spec.md section 6): the steady background
  // devices without their own counter, per-day estimates scaled to
  // the window, plus the unexplained share of the remainder. The
  // base load entry is data-derived (derived: true): computed per
  // covered day from the day's own hourly consumption, not a static
  // estimate.
  home_model: {
    days: number
    modeled_kwh: number
    unexplained_kwh: number
    entries: {
      key: string
      name: string
      kwh_per_day: number
      basis: string
      kwh: number
      derived?: boolean
    }[]
  }
  // The per-slot chart series (docs/spec.md section 8): the window's
  // household consumption per hour, day or month, with the slot's
  // average hourly price and the active categories' kWh for the
  // tooltip breakdown.
  slots: {
    unit: UsageSlotUnit
    series: UsageSlot[]
  }
  assumptions: {
    flat_cop: number
    heating_gas_m3: number
    heating_days: number
    gas_non_heating_baseline_m3_per_month: number
    setpoint_staleness_hours: number
  }
}

// One per-slot chart entry (docs/spec.md section 8): the slot's total
// household consumption, its average hourly price, its cost at that
// price, and the active categories' kWh (the heat pump carries its
// "Est." class).
export type UsageSlotUnit = "hour" | "day" | "month"

export interface UsageSlotCategory {
  key: string
  label: string
  kwh: number
  class: "measured" | "Est."
}

export interface UsageSlot {
  ts: string
  kwh: number
  price_eur: number | null
  cost_eur: number | null
  categories: UsageSlotCategory[]
}

export function fetchUsageBreakdown(
  period: PeriodKind,
  date: string
): Promise<UsageBreakdown> {
  return getJson<UsageBreakdown>(
    withParams("/api/usage/breakdown", { period, date })
  )
}

// GET /api/heat/zones: the zone timeline data for the heat page. The
// window is half-open local ISO; heating intervals are inferred
// server-side from the setpoint gap.
export interface HeatZonePoint {
  ts: string
  temp: number
  setpoint: number | null
}

export interface HeatZone {
  key: string
  name: string
  series: HeatZonePoint[]
  heatingIntervals: { from: string; to: string }[]
}

export interface HeatZonesData {
  window: { start: string; end: string }
  dataStart: string
  resolution: "raw" | "hourly"
  zones: HeatZone[]
  outdoor: { series: { ts: string; temp: number }[] }
}

export function fetchHeatZones(
  period: PeriodKind,
  date: string
): Promise<HeatZonesData> {
  return getJson<HeatZonesData>(withParams("/api/heat/zones", { period, date }))
}

// GET /api/heat/gas: gas consumption and cost for the heat page. Cost
// is null (never 0) when no gas price applies; the meta note is a
// known data caveat for the section's footnote.
export interface GasInterval {
  ts: string
  m3: number
  price_eur_per_m3: number | null
  cost_eur: number | null
}

export interface GasUsageData {
  window: { start: string; end: string }
  granularity: "hour" | "day" | "month"
  series: GasInterval[]
  totals: { m3: number; cost_eur: number; hasUnknownPrice: boolean }
  meta: { note: string }
}

export function fetchHeatGas(
  period: PeriodKind,
  date: string
): Promise<GasUsageData> {
  return getJson<GasUsageData>(withParams("/api/heat/gas", { period, date }))
}

// GET /api/heat/model: the hybrid heating cost model for a period.
// The gas route is the cost basis; every heat pump number is an
// estimate. Null means the period lacks the data; unknown is never 0.
export interface HeatModelData {
  window: { start: string; end: string }
  gas_route: {
    cost_per_kwh_heat: number | null
    price_eur_per_m3: number | null
    calorific_kwh_per_m3: number
    boiler_efficiency: number
  }
  heat_pump_route: {
    cost_per_kwh_heat: number | null
    avg_electricity_price_eur_per_kwh: number | null
    avg_cop: number | null
    avg_outdoor_temp: number | null
  }
  assumptions: {
    gas_calorific_kwh_per_m3: number
    boiler_efficiency: number
    cop_at_7c: number
    cop_at_minus_7c: number
  }
}

export function fetchHeatModel(
  period: PeriodKind,
  date: string
): Promise<HeatModelData> {
  return getJson<HeatModelData>(withParams("/api/heat/model", { period, date }))
}

// GET /api/solar/production: PV production per interval with the
// avoided grid cost, for the anchored period. Resolution follows the
// period: hourly buckets for day and week, daily buckets for month
// and year. Avoided cost is bottom-up per interval at that hour's
// grid price; intervals without any known price cost null (never 0)
// and are excluded from totals.avoidedCostEur. Each interval also
// carries the solar disposition split - the estimate of how its
// production was divided across the home, the grid export and the
// battery charging (null when the hourly aggregate lagged the
// interval away, daily resolution) - and the self-consumption
// avoided cost, the bottom-up cost of the solarToHome share at the
// same price with the same null-never-0 rule. dataStart marks the
// first day any data exists, for honest empty states.
export interface SolarProductionPoint {
  ts: string
  kwh: number
  avoidedCostEur: number | null
  solarToHomeKwh: number | null
  solarToGridKwh: number | null
  solarToBatteryKwh: number | null
  selfConsumptionAvoidedCostEur: number | null
  // The raw grid export counter's kWh in the interval (battery
  // discharge included), distinct from the PV-capped split share.
  exportKwh: number | null
  // Export kWh priced at the hour's return price (the dynamic
  // construction, or the flat override); null when no price is
  // known or the export counter is not registered, never a silent
  // 0. Negative prices earn negative amounts.
  exportEarningsEur: number | null
}

// The export earnings' pricing configuration, exposed as the solar
// production payload's meta.returnPricing: mode "dynamic" prices
// each hour at the derived return price (the constants ride
// along), mode "flat-override" at the explicit flat rate.
export interface ReturnPricing {
  mode: "dynamic" | "flat-override"
  // The EMS_FEED_IN_TARIFF_EUR override in EUR/kWh; null in
  // dynamic mode.
  flatTariffEur: number | null
  vatRate: number
  energyTaxEur: number
  handlingFeeConsumptionEur: number
  handlingFeeFeedInEur: number
  // The Zonnebonus fraction, applied in positive daytime hours
  // [bonusStartHour, bonusEndHour) local.
  solarBonus: number
  bonusStartHour: number
  bonusEndHour: number
}

export interface SolarProductionData {
  period: PeriodKind
  date: string
  window: { start: string; end: string }
  dataStart: string
  resolution: "hourly" | "daily"
  series: SolarProductionPoint[]
  totals: {
    kwh: number
    avoidedCostEur: number
    hasUnknownPrice: boolean
    selfConsumedKwh: number
    // Null when nothing was produced - no share exists, never 0.
    selfConsumedShare: number | null
    selfConsumptionAvoidedCostEur: number
    exportKwh: number | null
    // Null when an exported hour lacks a known return price, never
    // a silent 0; negative when negative prices outweigh the fees.
    exportEarningsEur: number | null
    // The combined benefit: self-consumption savings plus export
    // earnings. Null while either component is null.
    totalCostNetEur: number | null
  }
  peak: { ts: string; kwh: number } | null
  meta: {
    note: string
    returnPricing: ReturnPricing
    // The energy_hourly coverage sanity check: stale means the
    // aggregate's newest bucket predates the current hour. Null
    // when the window predates the data start.
    hourlyCoverage: { lastBucket: string | null; stale: boolean } | null
  }
}

export function fetchSolarProduction(
  period: PeriodKind,
  date: string
): Promise<SolarProductionData> {
  return getJson<SolarProductionData>(
    withParams("/api/solar/production", { period, date })
  )
}

export interface DailyInsight {
  generated_at: string | null
  as_of: string | null
  stale: boolean
  error: string | null
}

let dailyInsightInFlight: Promise<DailyInsight> | null = null

// Fetches the daily AI insight. There is no long-lived client cache:
// refreshes ride the 5-minute panel cycle, and concurrent callers share
// one in-flight request. With force, a fresh request is made that asks the
// server to regenerate once regardless of the context signature.
// The week outlook from the five-day forecast: every day after today
// with its expected solar and home-language condition, plus the best
// solar day and any notably poor rain day. Grid prices beyond
// tomorrow are not yet published; there the solar forecast is the
// deciding signal.
export interface OutlookDay {
  date: string
  weekday: string
  weekday_short: string
  solar_kwh: number
  // The solar score (0 to 100 versus the annual peak) grounds the
  // qualitative wording.
  solar_score: number | null
  condition: string
  // Tomorrow's average grid price when published; null for every day
  // beyond tomorrow - those prices do not exist in the data.
  average_price_eur: number | null
}

export interface WeekOutlook {
  days: OutlookDay[]
  best_solar_day: {
    date: string
    weekday: string
    weekday_short: string
    solar_kwh: number
    solar_score: number | null
    // "Looks good for solar" only when the score backs it
    // (GOOD_SOLAR_SCORE).
    good: boolean
    // The server-composed narrative description for the card; the
    // card renders it verbatim. Optional so payloads from before the
    // line existed keep rendering through the local fallback.
    line?: string | null
  } | null
  poor_day: {
    date: string
    weekday: string
    weekday_short: string
    solar_kwh: number
    condition: string
    // The server-composed narrative description for the card; the
    // card renders it verbatim. Optional for pre-line payloads.
    line?: string | null
    // The server-composed narrative advice line (reason and guidance
    // in one household sentence); the card renders it verbatim.
    // Optional for pre-line payloads.
    advice?: string | null
  } | null
}

// One precomputed C1b candidate action with exact server-computed
// arithmetic, shared between the insight payload and the insight
// debug endpoint.
export interface InsightCandidate {
  label: string
  load_kwh: number
  window: string
  saving_eur: number
  below_threshold: boolean
  basis: string
}

// The read-only insight debug payload: the exact context the summary
// insight is built from, plus the composed system prompt and the last
// generated insight for the verbatim saving comparison. Fetching it
// never costs a Mistral call.
export interface InsightDebugData {
  as_of: string
  signature: string
  system_prompt: string
  // The shared Mistral budget: limit, calls today, remaining.
  mistral: DebugMistral
  context: {
    now_local?: string
    today?: Record<string, number | null>
    top_appliances?: { name: string; kwh: number }[]
    candidates?: InsightCandidate[]
    battery?: string
    co2_intensity_g_per_kwh?: number
    solar_today?: string
    solar_tomorrow?: string
    current_price?: number | null
    cheapest_window?: {
      day?: string
      start_hour?: string
      end_hour?: string
      average_price?: number
    } | null
    today_prices?: {
      min?: number | null
      average?: number | null
      max?: number | null
      peak_hours?: string[]
    }
    tomorrow_prices_available?: boolean
    tomorrow_prices?: {
      min?: number | null
      average?: number | null
      max?: number | null
      peak_hours?: string[]
    }
    price_peak_threshold_eur?: number | null
    guidance?: {
      window: string
      cheapest_window_average_eur: number
      peak_hour: string | null
      peak_price_eur: number
      spread_per_kwh_eur: number
      practical: boolean
      window_start_hour: number
      hours_remaining: number
      day_average_eur: number | null
      day_cheapest_window: string | null
      day_cheapest_average_eur: number | null
    } | null
    week_outlook?: WeekOutlook | null
    advisory?: {
      type: "defer" | "advance"
      triggered: boolean
      tomorrow_average_eur: number | null
      tomorrow_solar_kwh: number | null
      compare_day: string
      compare_average_eur: number | null
      compare_solar_kwh: number | null
      price_difference_per_kwh: number | null
      horizon_note: string
    } | null
  }
  insight: {
    signature: string
    as_of: string
    // The regeneration state, computed against the live signature:
    // "fresh" or "reasoning".
    state: "fresh" | "reasoning"
    no_opportunity: boolean
    candidates: InsightCandidate[]
    guidance: {
      window: string
      cheapest_window_average_eur: number
      peak_hour: string
      peak_price_eur: number
      spread_per_kwh_eur: number
      line: string
    } | null
    advisory: {
      type: "defer" | "advance"
      triggered: boolean
      tomorrow_average_eur: number | null
      tomorrow_solar_kwh: number | null
      compare_day: string
      compare_average_eur: number | null
      compare_solar_kwh: number | null
      price_difference_per_kwh: number | null
      horizon_note: string
      line: string
    } | null
    primary_action: {
      what: string
      when: string
      saving_eur: number
      confidence: string
    } | null
  } | null
}

export function fetchInsightDebug(): Promise<InsightDebugData> {
  return getJson<InsightDebugData>("/api/insight/debug")
}

export function fetchDailyInsight(force = false): Promise<DailyInsight> {
  if (!force && dailyInsightInFlight) {
    return dailyInsightInFlight
  }
  const promise = getJson<DailyInsight>(
    withParams("/api/insight/daily", force ? { force: "1" } : {})
  ).then(
    (value) => {
      if (dailyInsightInFlight === promise) {
        dailyInsightInFlight = null
      }
      return value
    },
    (error) => {
      if (dailyInsightInFlight === promise) {
        dailyInsightInFlight = null
      }
      throw error
    }
  )
  dailyInsightInFlight = promise
  return promise
}

export interface WeatherDay {
  date: string
  weather_code: number
  temp_min: number
  temp_max: number
  solar_score: number
  estimated_kwh: number
  sunrise: string
  sunset: string
  // Present on today's row only: actual PV production so far, null before
  // any production today.
  actual_today_kwh?: number | null
}

export interface WeatherHour {
  hour: string
  temperature: number
  weather_code: number
  cloud_cover: number
  precipitation_probability: number
  estimated_pv_wh: number
}

export interface WeatherCurrent {
  temperature: number | null
  weather_code: number | null
  cloud_cover: number | null
}

export interface WeatherHourlyResponse {
  current: WeatherCurrent | null
  hours: WeatherHour[]
}

export interface WeatherContext {
  text: string | null
  generated_at: string | null
  error: string | null
}

export interface PriceContext {
  text: string | null
  generated_at: string | null
  error: string | null
}

export interface BatteryContext {
  text: string | null
  generated_at: string | null
  error: string | null
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`API request failed: ${path} (${response.status})`)
  }
  return (await response.json()) as T
}

function withParams(
  path: string,
  params: Record<string, number | string | undefined>
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value))
    }
  }
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

export interface DebugTimeRawRow {
  entity_id?: number
  ha_entity_id?: string
  ts: string
  [key: string]: unknown
}

// GET /api/debug/time: server clock, timezone and local bucket
// diagnostics, plus raw rows for stored-vs-displayed time comparison.
export interface DebugHaFetch {
  price_entity_ok: boolean | null
  tomorrow_status_entity_ok: boolean | null
  price_forecast_fetched_at: string | null
  // Minutes since the last successful HA price forecast fetch; null when
  // none has succeeded since server start.
  price_forecast_age_min: number | null
}

export interface DebugMistral {
  daily_limit: number
  calls_today: number
  remaining_calls: number
}

export interface DebugTime {
  server_now_utc: string
  server_now_local: string
  tz_env: string | null
  resolved_timezone: string
  local_date: string
  local_hour: string
  current_hour_start_utc: string
  current_price_row: { ts: string; price_eur: number | null } | null
  latest_measurement: DebugTimeRawRow | null
  latest_energy_delta: DebugTimeRawRow | null
  ha_fetch: DebugHaFetch
  mistral: DebugMistral
  // The gridScore trace for the debug panel (raw uncapped permille
  // included); null when the builder failed.
  grid_score: GridScoreDebug | null
}

export function fetchDebugTime(): Promise<DebugTime> {
  return getJson<DebugTime>("/api/debug/time")
}

export function getEntities(): Promise<Entity[]> {
  return getJson<Entity[]>("/api/entities")
}

export function getDailyTotals(days = 7): Promise<DailyTotal[]> {
  return getJson<DailyTotal[]>(withParams("/api/totals/daily", { days }))
}

export function getHourlyTotals(hours = 24): Promise<HourlyTotal[]> {
  return getJson<HourlyTotal[]>(withParams("/api/totals/hourly", { hours }))
}

export function getHourlySeries(hours = 24): Promise<HourlySeriesPoint[]> {
  return getJson<HourlySeriesPoint[]>(withParams("/api/series/hourly", { hours }))
}

export function getCurrentMeasurements(): Promise<CurrentMeasurement[]> {
  return getJson<CurrentMeasurement[]>("/api/current")
}

export function fetchLiveSnapshot(): Promise<LiveSnapshot> {
  return getJson<LiveSnapshot>("/api/live")
}

export function fetchWeatherDaily(days = 5): Promise<WeatherDay[]> {
  return getJson<WeatherDay[]>(withParams("/api/weather/daily", { days }))
}

export function fetchWeatherHourly(
  date?: string
): Promise<WeatherHourlyResponse> {
  return getJson<WeatherHourlyResponse>(
    withParams("/api/weather/hourly", { date })
  )
}

const CONTEXT_CACHE_MS = 30 * 60 * 1000
let contextCache: { fetchedAt: number; value: WeatherContext } | null = null

// Fetches the AI insight at most once every 30 minutes; the module-level
// cache means remounts and day selections never trigger a new request.
// With force, the cache is bypassed and the server is asked to regenerate.
export function fetchWeatherContext(force = false): Promise<WeatherContext> {
  if (!force && contextCache && Date.now() - contextCache.fetchedAt < CONTEXT_CACHE_MS) {
    return Promise.resolve(contextCache.value)
  }
  return getJson<WeatherContext>(
    withParams("/api/weather/context", force ? { force: "1" } : {})
  ).then((value) => {
    contextCache = { fetchedAt: Date.now(), value }
    return value
  })
}

export function fetchPrices(days = 2): Promise<PriceSummary> {
  return getJson<PriceSummary>(withParams("/api/prices", { days }))
}

export function fetchCheapestBlock(hours = 3): Promise<CheapestBlock | null> {
  return getJson<CheapestBlock | null>(
    withParams("/api/prices/cheapest", { hours })
  )
}

let priceContextCache: { fetchedAt: number; value: PriceContext } | null =
  null

// Fetches the price AI insight at most once every 30 minutes; the
// module-level cache means remounts never trigger a new request. With
// force, the cache is bypassed and the server is asked to regenerate.
export function fetchPriceContext(force = false): Promise<PriceContext> {
  if (
    !force &&
    priceContextCache &&
    Date.now() - priceContextCache.fetchedAt < CONTEXT_CACHE_MS
  ) {
    return Promise.resolve(priceContextCache.value)
  }
  return getJson<PriceContext>(
    withParams("/api/prices/context", force ? { force: "1" } : {})
  ).then((value) => {
    priceContextCache = { fetchedAt: Date.now(), value }
    return value
  })
}

let batteryContextCache: { fetchedAt: number; value: BatteryContext } | null =
  null

// Fetches the battery AI insight at most once every 30 minutes. With
// force, the cache is bypassed and the server is asked to regenerate.
export function fetchBatteryContext(force = false): Promise<BatteryContext> {
  if (
    !force &&
    batteryContextCache &&
    Date.now() - batteryContextCache.fetchedAt < CONTEXT_CACHE_MS
  ) {
    return Promise.resolve(batteryContextCache.value)
  }
  return getJson<BatteryContext>(
    withParams("/api/battery/context", force ? { force: "1" } : {})
  ).then((value) => {
    batteryContextCache = { fetchedAt: Date.now(), value }
    return value
  })
}

// One interval of the period-anchored battery flow: charged and
// discharged kWh with their money dimensions, both carried so the
// Energy/Cost toggle restyles without a refetch. Null money means
// the interval carried flow but no known price, never a silent 0.
export interface BatteryFlowInterval {
  ts: string
  in_kwh: number
  out_kwh: number
  in_cost_eur: number | null
  out_value_eur: number | null
}

// The battery flow for a period: hourly intervals (with the SOC
// series) for a day, daily aggregates for a week or month, monthly
// aggregates for a year. The totals sum the series bottom-up; a
// money total is null when any flowing interval lacks its price,
// and the arbitrage - discharge value minus charge cost - is null
// while either money figure is null.
export interface BatteryFlowData {
  period: PeriodKind
  date: string
  window: { start: string; end: string }
  dataStart: string
  resolution: "hour" | "day" | "month"
  series: BatteryFlowInterval[]
  soc_series: BatterySocPoint[]
  battery_available: boolean
  totals: {
    charged_kwh: number
    discharged_kwh: number
    net_kwh: number
    charge_cost_eur: number | null
    discharge_value_eur: number | null
    arbitrage_eur: number | null
  }
}

export function fetchBatteryFlow(
  period: PeriodKind,
  date: string
): Promise<BatteryFlowData> {
  return getJson<BatteryFlowData>(
    withParams("/api/battery/flow", { period, date })
  )
}
