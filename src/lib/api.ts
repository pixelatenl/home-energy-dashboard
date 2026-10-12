// Typed client for the local data server (server/index.mjs). All fetch calls
// for /api endpoints live here; components should import these functions.

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
}

export interface RangeMetrics {
  import_kwh: number
  export_kwh: number
  pv_kwh: number | null
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

export interface FlowSnapshot {
  pv_w: number | null
  grid_import_w: number | null
  grid_export_w: number | null
  battery_solar_in_w: number | null
  battery_charge_w: number | null
  battery_discharge_w: number | null
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
  server_version: string
  flow: FlowSnapshot
  battery_full_in_min?: number
  battery_empty_in_min?: number
}

export function fetchSummary(): Promise<SummaryData> {
  return getJson<SummaryData>("/api/summary")
}

// GET /api/appliances: smart plug disaggregation (domain = 'plug' only).
export type ApplianceRange = "today" | "week" | "month" | "year"

export interface Appliance {
  appliance: string
  kwh: number | null
  cost_eur: number | null
  power_w: number | null
  power_ts: string | null
}

export interface ApplianceHour {
  hour: string
  appliance: string
  kwh: number
}

export interface ApplianceSummary {
  range: ApplianceRange
  from: string
  appliances: Appliance[]
  hourly: ApplianceHour[]
  totals: {
    plug_kwh: number
    plug_cost: number
  }
}

export function fetchAppliances(
  range: ApplianceRange
): Promise<ApplianceSummary> {
  return getJson<ApplianceSummary>(withParams("/api/appliances", { range }))
}

export type InsightActionType =
  | "appliance"
  | "battery"
  | "ev"
  | "solar"
  | "general"

// Structured action: the primary insight format, rendered as a designed
// row (day chip, window, type icon, title, reason, price tag).
export interface StructuredInsightAction {
  date: string // YYYY-MM-DD
  start: string // HH:MM
  end: string // HH:MM
  type: InsightActionType
  title: string
  reason: string
  price_eur: number | null
}

// Prose action: the fallback format when structured validation fails.
export interface LegacyInsightAction {
  text: string
  window: string
  reason: string
}

export type InsightAction = StructuredInsightAction | LegacyInsightAction

export function isStructuredAction(
  action: InsightAction
): action is StructuredInsightAction {
  return (
    typeof (action as StructuredInsightAction).date === "string" &&
    typeof (action as StructuredInsightAction).start === "string"
  )
}

export interface DailyInsight {
  one_liner: string | null
  summary: string | null
  actions: InsightAction[]
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
