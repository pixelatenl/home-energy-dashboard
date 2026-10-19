import "dotenv/config";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { shutdown } from "./db.mjs";
import {
  composeAdvisoryLine,
  composeGuidanceLine,
  getBatteryContext,
  getMistralBudget,
  getPriceContext,
  getSummaryInsight,
  getWeatherContext,
  peekSummaryInsight,
  SUMMARY_SYSTEM_PROMPT_STRUCTURED,
  topProductionHours,
} from "./ai.mjs";
import { buildContextSnapshot } from "./context.mjs";
import { getGridScoreDebug } from "./gridscore.mjs";
import {
  getCheapestBlock,
  getHaFetchInfo,
  getPriceContextData,
  getPriceSummary,
} from "./prices.mjs";
import {
  WeatherUpstreamError,
  weatherHourly,
} from "./weather.mjs";
import { dailyForecast } from "./solar.mjs";
import {
  getSolarProduction,
  SOLAR_DATA_START,
} from "./solar-production.mjs";
import { BATTERY_DATA_START, getBatteryFlow } from "./battery-flow.mjs";
import { getLiveSnapshot } from "./live.mjs";
import {
  applianceHourly,
  applianceLatestPower,
  applianceTotals,
  currentMeasurements,
  dailyTotals,
  getDebugTimeData,
  getGasUsage,
  getHeatModel,
  getHeatZones,
  getSummary,
  getUsageBreakdown,
  HEAT_DATA_START,
  hourlySeries,
  hourlyTotals,
  listEntities,
} from "./queries.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  localIsoWithOffset,
  nextDateKey,
  periodDateKeys,
  resolvedTimezone,
} from "./time.mjs";

// Dedicated port for the API server, distinct from the Vite dev server
// (5173) so the two never race for the same port regardless of start order.
const DEFAULT_PORT = Number(process.env.API_PORT ?? 5273);
const MAX_PORT = DEFAULT_PORT + 10;

// Build identifier set at server start: the short git hash of the checkout
// plus the process start time. The debug panel shows it so a stale process
// (started before the latest code changes) is recognizable on screen.
const SERVER_START = new Date().toISOString();
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", {
    cwd: import.meta.dirname,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  gitHash = "unknown";
}
const SERVER_VERSION = `${gitHash} @ ${SERVER_START}`;

// The guidance, advisory and outlook objects served with the insight:
// sourced from the live snapshot extras at request time - never from
// the cached insight - so the rows never go stale between generations
// and the card always renders the current window. The line is
// composed deterministically; the model never writes these objects.
function liveAdvisoryObjects(extras) {
  const guidance = extras?.guidance ?? null;
  const advisory = extras?.advisory ?? null;
  return {
    guidance: guidance ? { ...guidance, line: composeGuidanceLine(guidance) } : null,
    advisory: advisory ? { ...advisory, line: composeAdvisoryLine(advisory) } : null,
    outlook: extras?.outlook ?? null,
  };
}

// One line at startup so a stale or misaligned clock is visible
// immediately: the UTC time, the TZ variable and the timezone the
// process actually resolved to.
console.log(
  `Server time: ${SERVER_START}, TZ=${process.env.TZ ?? "(unset)"}, ` +
    `resolved timezone: ${resolvedTimezone()}`
);

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Minimal CORS for the Vite dev server (any localhost origin), so the
// frontend can also call the API directly instead of only via the proxy.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Parse a positive integer query parameter with a default and an upper bound.
function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res)).catch(next);
};

app.get(
  "/api/entities",
  asyncHandler(async (_req, res) => {
    res.json(await listEntities());
  })
);

app.get(
  "/api/totals/daily",
  asyncHandler(async (req, res) => {
    const days = positiveInt(req.query.days, 7, 365);
    res.json(await dailyTotals(days));
  })
);

app.get(
  "/api/totals/hourly",
  asyncHandler(async (req, res) => {
    const hours = positiveInt(req.query.hours, 24, 24 * 31);
    res.json(await hourlyTotals(hours));
  })
);

app.get(
  "/api/series/hourly",
  asyncHandler(async (req, res) => {
    const hours = positiveInt(req.query.hours, 24, 24 * 31);
    res.json(await hourlySeries(hours));
  })
);

app.get(
  "/api/current",
  asyncHandler(async (_req, res) => {
    res.json(await currentMeasurements());
  })
);

// Live power snapshot: the whitelisted HA sensors with a fail-soft
// database fallback, served read-only from live.mjs.
app.get(
  "/api/live",
  asyncHandler(async (_req, res) => {
    res.json(await getLiveSnapshot());
  })
);

app.get(
  "/api/prices",
  asyncHandler(async (req, res) => {
    let days = 2;
    if (req.query.days !== undefined) {
      const raw = req.query.days;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
        return res
          .status(400)
          .json({ error: "days must be an integer between 1 and 7" });
      }
      days = parsed;
    }
    res.json(await getPriceSummary(days));
  })
);

app.get(
  "/api/prices/cheapest",
  asyncHandler(async (req, res) => {
    let hours = 3;
    if (req.query.hours !== undefined) {
      const raw = req.query.hours;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
        return res
          .status(400)
          .json({ error: "hours must be an integer between 1 and 12" });
      }
      hours = parsed;
    }
    res.json(await getCheapestBlock(hours));
  })
);

app.get(
  "/api/prices/context",
  asyncHandler(async (req, res) => {
    const force = req.query.force === "1" || req.query.force === "true";
    const priceParts = await getPriceContextData();
    // Optional solar summary from the weather module; omitted when the
    // weather data is unavailable rather than failing the request.
    let solarDaily = null;
    try {
      const daily = await dailyForecast(5);
      const todayKey = localDateKey(new Date());
      const todayEntry = daily.find((day) => day.date === todayKey) ?? null;
      const hourlyResult = await weatherHourly(todayKey);
      if (todayEntry && hourlyResult?.hours?.length) {
        solarDaily = {
          estimated_kwh: todayEntry.estimated_kwh,
          top_production_hours: topProductionHours(hourlyResult.hours),
        };
      }
    } catch {
      solarDaily = null;
    }
    const result = await getPriceContext(priceParts, solarDaily, { force });
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

app.get(
  "/api/debug/time",
  asyncHandler(async (_req, res) => {
    const data = await getDebugTimeData();
    // Freshen the merged price curve so ha_fetch reports the current
    // fetch state instead of "never fetched" after a server restart.
    try {
      await getPriceContextData();
    } catch {
      // The debug fields below report the failure.
    }
    // The gridScore object for the debug panel: the display fields
    // plus the raw uncapped permille, so the served curve can be
    // verified against the raw HA forecast. Fail-soft: null only when
    // the builder itself throws.
    const gridScore = await getGridScoreDebug().catch(() => null);
    res.json({
      ...data,
      // Whether the HA price fetches succeeded and how old the price
      // forecast is.
      ha_fetch: getHaFetchInfo(),
      // The shared Mistral budget: limit, calls today, remaining.
      mistral: getMistralBudget(),
      grid_score: gridScore,
    });
  })
);

app.get(
  "/api/summary",
  asyncHandler(async (req, res) => {
    // force regenerates the insight once regardless of the context
    // signature; it bypasses the summary minimum interval but never the
    // daily cap, and still counts - synchronously, as before. Without
    // force a signature change is warmed up in the background: the
    // endpoint answers immediately with the cached insight in state
    // "reasoning" and the next poll delivers the fresh one. The warm-up
    // only runs while a cached insight exists to serve meanwhile - with
    // an empty cache (the first request after a restart) the insight
    // generates synchronously instead, so the kiosk's first response
    // already carries the advisory and its skeleton covers the wait.
    const force = req.query.force === "1" || req.query.force === "true";
    const snapshot = await buildContextSnapshot();
    const insight = await getSummaryInsight(snapshot, {
      force,
      background: !force && peekSummaryInsight() !== null,
    });
    res.json({
      ...snapshot.summary,
      // The moment the underlying summary data was built.
      as_of: snapshot.asOf,
      // Stable hash over the materialized context fields; provenance
      // for the debug panel (the insight state folds the signature
      // comparison in server-side).
      signature: snapshot.signature,
      insight: {
        // The decision structure: the primary action with its estimated
        // saving and confidence, its warning and context note. The
        // guidance, advisory and outlook objects join from the live
        // snapshot extras; there is no legacy prose format.
        primary_action: insight.primaryAction
          ? {
              what: insight.primaryAction.what,
              when: insight.primaryAction.when,
              saving_eur: insight.primaryAction.savingEur,
              confidence: insight.primaryAction.confidence,
            }
          : null,
        supporting_facts: insight.supportingFacts ?? [],
        warning: insight.warning ?? null,
        context_note: insight.contextNote ?? null,
        // True when no meaningful saving was available; the
        // belowThreshold candidates let the card name the largest
        // real opportunity with its true amount.
        no_opportunity: insight.noOpportunity ?? false,
        candidates: insight.candidates ?? [],
        ...liveAdvisoryObjects(snapshot.extras),
        generated_at: insight.generatedAt,
        // The data moment the cached insight text is based on (its own
        // as_of, which can trail the top-level as_of).
        insight_as_of: insight.asOf,
        // The regeneration state: "fresh" (the cached insight matches
        // the live signature), "reasoning" (the signatures differ and
        // a regeneration is in flight) or "error" (no cached insight
        // at all; the card stays empty rather than unverified).
        state: insight.state,
        // Deprecated mirror of state === "reasoning", kept one release
        // for the debug panel and old payload comparisons; remove with
        // the C25 cleanup.
        stale: insight.stale,
        error: insight.error,
      },
      // Remaining calls in the shared daily Mistral budget.
      remaining_calls: getMistralBudget().remaining_calls,
      server_version: SERVER_VERSION,
    });
  })
);

// Appliance disaggregation ranges: today starts at local midnight; the
// longer ranges are rolling windows back from now.
const APPLIANCE_RANGES = new Set(["today", "week", "month", "year"]);
const APPLIANCE_RANGE_DAYS = { week: 7, month: 30, year: 365 };

// Strips the trailing sensor-kind word from an entity name so the energy
// and power sensors of one plug map to the same appliance
// ("Dishwasher energy" / "Dishwasher power" -> "Dishwasher").
const applianceName = (raw) =>
  raw.replace(/\s+(energy|power)$/i, "").trim();

app.get(
  "/api/appliances",
  asyncHandler(async (req, res) => {
    const range = req.query.range ?? "today";
    if (typeof range !== "string" || !APPLIANCE_RANGES.has(range)) {
      return res.status(400).json({
        error: "range must be one of today, week, month, year",
      });
    }
    // Optional anchored window: filter to the concrete period containing
    // the anchor day (period=day|week|month|year, date=YYYY-MM-DD). When
    // the anchor params are absent the relative ranges below behave
    // exactly as before.
    const period = req.query.period;
    const date = req.query.date;
    let window = null;
    if (period !== undefined || date !== undefined) {
      if (typeof period !== "string" || typeof date !== "string") {
        return res.status(400).json({
          error:
            "period and date must be provided together (period=day|week|month|year, date=YYYY-MM-DD)",
        });
      }
      const keys = periodDateKeys(period, date);
      if (keys === null) {
        return res.status(400).json({
          error:
            "unknown period or invalid date (period=day|week|month|year, date=YYYY-MM-DD)",
        });
      }
      window = {
        fromMs: localDayStartUtcMs(keys.startKey),
        // Exclusive end: the first ms after the period's last day.
        toMs: localDayStartUtcMs(nextDateKey(keys.endKey, 1)),
      };
    }
    const nowMs = Date.now();
    const fromMs =
      window === null
        ? range === "today"
          ? localDayStartUtcMs(localDateKey(new Date()))
          : nowMs - APPLIANCE_RANGE_DAYS[range] * 24 * 60 * 60 * 1000
        : window.fromMs;
    const toMs = window === null ? null : window.toMs;
    // The hourly breakdown exists only for day windows (the today view,
    // or an anchored day).
    const isDayView = window === null ? range === "today" : period === "day";
    const [totalsRows, powerRows, hourlyRows] = await Promise.all([
      applianceTotals(fromMs, toMs),
      applianceLatestPower(),
      isDayView ? applianceHourly(fromMs, toMs) : Promise.resolve([]),
    ]);
    // One entry per appliance, from the energy totals, with the latest
    // power sample attached by normalized name; a plug that has power
    // samples but no energy deltas yet still appears with null kWh.
    const appliances = new Map();
    for (const row of totalsRows) {
      const name = applianceName(row.appliance);
      appliances.set(name, {
        appliance: name,
        kwh: Math.round(Number(row.kwh) * 100) / 100,
        cost_eur:
          row.cost_eur === null
            ? null
            : Math.round(Number(row.cost_eur) * 100) / 100,
        power_w: null,
        power_ts: null,
      });
    }
    for (const row of powerRows) {
      const name = applianceName(row.appliance);
      const entry =
        appliances.get(name) ?? {
          appliance: name,
          kwh: null,
          cost_eur: null,
          power_w: null,
          power_ts: null,
        };
      entry.power_w = Math.round(Number(row.power_w));
      entry.power_ts = row.power_ts.toISOString();
      appliances.set(name, entry);
    }
    let plugKwh = 0;
    let plugCost = 0;
    for (const entry of appliances.values()) {
      if (entry.kwh !== null) {
        plugKwh += entry.kwh;
      }
      if (entry.cost_eur !== null) {
        plugCost += entry.cost_eur;
      }
    }
    res.json({
      // The anchored mode reuses the range vocabulary (the navigator's
      // day is the API's "today") so the response shape is unchanged.
      range: window === null ? range : period === "day" ? "today" : period,
      from: new Date(fromMs).toISOString(),
      appliances: [...appliances.values()].sort((a, b) =>
        a.appliance.localeCompare(b.appliance)
      ),
      hourly: hourlyRows.map((row) => ({
        hour: row.hour.toISOString(),
        appliance: applianceName(row.appliance),
        kwh: Math.round(Number(row.kwh) * 1000) / 1000,
      })),
      totals: {
        plug_kwh: Math.round(plugKwh * 100) / 100,
        plug_cost: Math.round(plugCost * 100) / 100,
      },
    });
  })
);

// GET /api/usage/breakdown: the category breakdown of household
// usage for a period (period=day|week|month|year, date=YYYY-MM-DD
// anchoring the period, default today): the registry's measured
// categories, the heat pump estimate ("Est." class), the remainder
// bucket, the previous period's totals per category and the
// measured/estimated split. Windows are half-open local calendar
// periods; the previous period is the same-length period immediately
// before the anchored one. The calculation lives in docs/spec.md
// section 3.
app.get(
  "/api/usage/breakdown",
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    if (
      typeof period !== "string" ||
      !["day", "week", "month", "year"].includes(period)
    ) {
      return res.status(400).json({
        error: "period must be one of day, week, month, year",
      });
    }
    const anchor =
      typeof req.query.date === "string"
        ? req.query.date
        : localDateKey(new Date());
    const keys = periodDateKeys(period, anchor);
    if (keys === null) {
      return res.status(400).json({
        error: "invalid date (date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    // The previous period: the same period containing the day before
    // the current one's first day.
    const prevKeys = periodDateKeys(period, nextDateKey(keys.startKey, -1));
    const prevFromMs = localDayStartUtcMs(prevKeys.startKey);
    const prevToMs = localDayStartUtcMs(nextDateKey(prevKeys.endKey, 1));
    const [current, previous] = await Promise.all([
      getUsageBreakdown(fromMs, toMs),
      getUsageBreakdown(prevFromMs, prevToMs),
    ]);
    const previousByKey = new Map(
      previous.categories.map((category) => [category.key, category])
    );
    res.json({
      period,
      date: anchor,
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      previous: {
        period,
        window: {
          start: localIsoWithOffset(new Date(prevFromMs)),
          end: localIsoWithOffset(new Date(prevToMs)),
        },
      },
      total: {
        kwh: current.total.kwh,
        cost_eur: current.total.cost_eur,
        previous_kwh: previous.total.kwh,
        previous_cost_eur: previous.total.cost_eur,
      },
      categories: current.categories.map((category) => {
        const prev = previousByKey.get(category.key);
        return {
          ...category,
          previous_kwh: prev === undefined ? 0 : prev.kwh,
          previous_cost_eur: prev === undefined ? null : prev.cost_eur,
        };
      }),
      split: {
        ...current.split,
        previous_measured_kwh: previous.split.measured_kwh,
        previous_estimated_kwh: previous.split.estimated_kwh,
        previous_remainder_kwh: previous.split.remainder_kwh,
      },
      // The window's average hourly price and the home model over the
      // window, for the Usage tab's right-column cards.
      avg_price_eur: current.avg_price_eur,
      home_model: current.home_model,
      // The grid statistics for the period summary strip's net view
      // (docs/spec.md section 7.1).
      grid_import_kwh: current.grid_import_kwh,
      grid_export_kwh: current.grid_export_kwh,
      import_cost_eur: current.import_cost_eur,
      export_credit_eur: current.export_credit_eur,
      // The per-slot chart series for the hourly/daily/monthly chart
      // (docs/spec.md section 8).
      slots: current.slots,
      assumptions: current.assumptions,
    });
  })
);

// GET /api/solar/production: PV production per interval with the
// avoided grid cost, anchored to a concrete period (the same
// date-anchored convention as the usage endpoints; date defaults to
// today). Resolution follows the period: hourly buckets for day and
// week, daily buckets for month and year. Production comes only
// from the PV energy counter's continuous aggregates; the avoided
// cost is bottom-up per interval at that hour's grid price. The
// meta note carries the known data caveats the frontend can
// footnote.
app.get(
  "/api/solar/production",
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    if (
      typeof period !== "string" ||
      !["day", "week", "month", "year"].includes(period)
    ) {
      return res.status(400).json({
        error: "period must be one of day, week, month, year",
      });
    }
    const anchor =
      typeof req.query.date === "string"
        ? req.query.date
        : localDateKey(new Date());
    const keys = periodDateKeys(period, anchor);
    if (keys === null) {
      return res.status(400).json({
        error: "invalid date (date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    const resolution =
      period === "day" || period === "week" ? "hourly" : "daily";
    const production = await getSolarProduction(fromMs, toMs, resolution);
    const { series, totals, peak, hourlyCoverage, returnPricing } = production;
    res.json({
      period,
      date: anchor,
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      dataStart: SOLAR_DATA_START,
      resolution,
      series,
      totals,
      peak,
      meta: {
        note: "the PV counter updates roughly every 15 minutes, so hourly attribution can look stepped",
        // The return-pricing configuration (server/return-price.mjs):
        // mode "dynamic" prices export at the hour's market price
        // plus the feed-in fee, with the Zonnebonus in positive
        // daytime hours (the constants ride along); mode
        // "flat-override" is the explicit EMS_FEED_IN_TARIFF_EUR
        // flat rate. The frontend footnotes its numbers with this.
        returnPricing,
        // The energy_hourly coverage sanity check: stale means the
        // aggregate's newest bucket predates the current hour. The
        // data is served either way, never failed; null when the
        // window predates the data start.
        hourlyCoverage,
      },
    });
  })
);

// GET /api/heat/zones: the zone timeline data for the heat page,
// anchored to a concrete period (period=day|week|month|year,
// date=YYYY-MM-DD). Day periods return the stored 5-minute samples,
// week/month/year the hourly continuous-aggregate averages. The
// window is half-open: start is the local midnight of the first day,
// end the local midnight after the last day.
app.get(
  "/api/heat/zones",
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    const date = req.query.date;
    if (typeof period !== "string" || typeof date !== "string") {
      return res.status(400).json({
        error:
          "period and date are required (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const keys = periodDateKeys(period, date);
    if (keys === null) {
      return res.status(400).json({
        error:
          "unknown period or invalid date (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    const resolution = period === "day" ? "raw" : "hourly";
    const zones = await getHeatZones(fromMs, toMs, resolution);
    res.json({
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      dataStart: HEAT_DATA_START,
      resolution,
      ...zones,
    });
  })
);

// GET /api/heat/gas: gas consumption and cost for the heat page,
// anchored to a concrete period. Granularity follows the period: hour
// for day, day for week and month, month for year. The meta note is a
// known data caveat the frontend can footnote.
app.get(
  "/api/heat/gas",
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    const date = req.query.date;
    if (typeof period !== "string" || typeof date !== "string") {
      return res.status(400).json({
        error:
          "period and date are required (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const keys = periodDateKeys(period, date);
    if (keys === null) {
      return res.status(400).json({
        error:
          "unknown period or invalid date (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    const granularity =
      period === "day" ? "hour" : period === "year" ? "month" : "day";
    const gas = await getGasUsage(fromMs, toMs, granularity);
    res.json({
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      ...gas,
      meta: {
        note: "Gas day totals miss roughly the first half hour after midnight",
      },
    });
  })
);

// GET /api/heat/model: the hybrid heating cost model for a period -
// the gas route as the cost basis and the heat pump route as a
// visible estimate, with the env-derived assumptions echoed back.
app.get(
  "/api/heat/model",
  asyncHandler(async (req, res) => {
    const period = req.query.period;
    const date = req.query.date;
    if (typeof period !== "string" || typeof date !== "string") {
      return res.status(400).json({
        error:
          "period and date are required (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const keys = periodDateKeys(period, date);
    if (keys === null) {
      return res.status(400).json({
        error:
          "unknown period or invalid date (period=day|week|month|year, date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    const model = await getHeatModel(
      fromMs,
      toMs,
      period === "day" ? "raw" : "hourly"
    );
    res.json({
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      ...model,
    });
  })
);

app.get(
  "/api/insight/debug",
  asyncHandler(async (_req, res) => {
    // Read-only traceability: the exact context payload the summary
    // insight is built from - the candidates with their exact savings
    // and belowThreshold marks, the price statistics, the appliance,
    // battery and solar facts - plus the composed system prompt and the
    // last generated insight for the verbatim saving comparison.
    // Composing the context never calls the model: every source is a
    // cache or a cheap query, and peekSummaryInsight only reads the
    // in-memory insight. The guidance, advisory and week outlook ride
    // the payload from the live extras, not the model context; they
    // are merged into both sections so the debug view keeps showing
    // them next to the price data its consistency checks compare
    // against.
    const snapshot = await buildContextSnapshot();
    // The peeked insight carries its regeneration state, computed
    // against the live signature, so the debug panel shows whether the
    // insight tracks the current context.
    const peeked = peekSummaryInsight(snapshot.signature);
    const live = liveAdvisoryObjects(snapshot.extras);
    res.json({
      as_of: snapshot.asOf,
      signature: snapshot.signature,
      system_prompt: SUMMARY_SYSTEM_PROMPT_STRUCTURED,
      // The shared Mistral budget: limit, calls today, remaining -
      // the same fields the debug time route reports.
      mistral: getMistralBudget(),
      context: {
        ...snapshot.context,
        guidance: live.guidance,
        advisory: live.advisory,
        week_outlook: live.outlook,
      },
      insight: peeked ? { ...peeked, ...live } : null,
    });
  })
);

app.get(
  "/api/insight/daily",
  asyncHandler(async (req, res) => {
    // force regenerates once regardless of the context signature.
    const force = req.query.force === "1" || req.query.force === "true";
    const snapshot = await buildContextSnapshot();
    const result = await getSummaryInsight(snapshot, { force });
    res.json({
      primary_action: result.primaryAction
        ? {
            what: result.primaryAction.what,
            when: result.primaryAction.when,
            saving_eur: result.primaryAction.savingEur,
            confidence: result.primaryAction.confidence,
          }
        : null,
      supporting_facts: result.supportingFacts ?? [],
      warning: result.warning ?? null,
      context_note: result.contextNote ?? null,
      no_opportunity: result.noOpportunity ?? false,
      candidates: result.candidates ?? [],
      ...liveAdvisoryObjects(snapshot.extras),
      generated_at: result.generatedAt,
      as_of: result.asOf,
      stale: result.stale,
      error: result.error,
    });
  })
);

// GET /api/battery/flow: the battery charge/discharge flow for a
// period, anchored to a concrete period with optional params
// (period=day|week|month|year, date=YYYY-MM-DD; no params means
// today, the previous behavior). Resolution follows the period:
// hourly buckets for a day, daily aggregates for a week or month,
// monthly aggregates for a year; the money dimensions - charge cost
// and discharge value - are always priced bottom-up at the dynamic
// hourly price, and the SOC series rides along on hour windows for
// the current-state gauge's chart. Windows that end before the data
// start carry an empty series rather than an error.
app.get(
  "/api/battery/flow",
  asyncHandler(async (req, res) => {
    const period =
      typeof req.query.period === "string" ? req.query.period : "day";
    if (!["day", "week", "month", "year"].includes(period)) {
      return res.status(400).json({
        error: "period must be one of day, week, month, year",
      });
    }
    const anchor =
      typeof req.query.date === "string"
        ? req.query.date
        : localDateKey(new Date());
    const keys = periodDateKeys(period, anchor);
    if (keys === null) {
      return res.status(400).json({
        error: "invalid date (date=YYYY-MM-DD)",
      });
    }
    const fromMs = localDayStartUtcMs(keys.startKey);
    const toMs = localDayStartUtcMs(nextDateKey(keys.endKey, 1));
    const resolution =
      period === "day" ? "hour" : period === "year" ? "month" : "day";
    const flow = await getBatteryFlow(fromMs, toMs, resolution);
    res.json({
      period,
      date: anchor,
      window: {
        start: localIsoWithOffset(new Date(fromMs)),
        end: localIsoWithOffset(new Date(toMs)),
      },
      dataStart: BATTERY_DATA_START,
      resolution,
      ...flow,
    });
  })
);

app.get(
  "/api/battery/context",
  asyncHandler(async (req, res) => {
    const force = req.query.force === "1" || req.query.force === "true";
    const summary = await getSummary();
    // Optional solar forecast and price context; omitted when the source
    // is unavailable rather than failing the request.
    let daily = null;
    try {
      daily = await dailyForecast(5);
    } catch {
      daily = null;
    }
    let priceParts = null;
    try {
      priceParts = await getPriceContextData();
    } catch {
      priceParts = null;
    }
    const result = await getBatteryContext(summary, daily, priceParts, {
      force,
    });
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

app.get(
  "/api/weather/daily",
  asyncHandler(async (req, res) => {
    let days = 5;
    if (req.query.days !== undefined) {
      const raw = req.query.days;
      const parsed =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
        return res
          .status(400)
          .json({ error: "days must be an integer between 1 and 6" });
      }
      days = parsed;
    }
    res.json(await dailyForecast(days));
  })
);

app.get(
  "/api/weather/hourly",
  asyncHandler(async (req, res) => {
    const raw = req.query.date;
    const date = raw === undefined ? localDateKey(new Date()) : raw;
    if (typeof date !== "string" || !isValidIsoDate(date)) {
      return res
        .status(400)
        .json({ error: "date must be a valid YYYY-MM-DD value" });
    }
    const rows = await weatherHourly(date);
    if (rows === null) {
      return res
        .status(400)
        .json({ error: `no forecast data available for ${date}` });
    }
    res.json(rows);
  })
);

app.get(
  "/api/weather/context",
  asyncHandler(async (req, res) => {
    const force = req.query.force === "1" || req.query.force === "true";
    const daily = await dailyForecast(5);
    const hourlyResult =
      (await weatherHourly(localDateKey(new Date()))) ??
      { current: null, hours: [] };
    const result = await getWeatherContext(daily, hourlyResult, { force });
    res.json({
      text: result.text,
      generated_at: result.generatedAt,
      error: result.error,
    });
  })
);

// Serve the production build of the frontend. Express matches in
// registration order, so this must come before the catch-all 404 handler
// below, which would otherwise intercept every page request.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

app.use(express.static(distDir));

// SPA fallback: any non-API GET request returns index.html, so client-side
// routing keeps working on refresh.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  if (err instanceof WeatherUpstreamError) {
    res.status(502).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Bind to the network instead of localhost only; the dashboard is meant
// to be reachable from other devices on the home network. Not reachable
// from the internet as long as the router does not forward the port.
const HOST = process.env.HOST ?? "0.0.0.0";

// The successfully bound server, so shutdown can stop accepting requests.
let activeServer = null;

function listen(port) {
  const server = app.listen(port, HOST, () => {
    activeServer = server;
    console.log(`API server listening on http://${HOST}:${port}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port < MAX_PORT) {
      console.warn(`Port ${port} in use, trying ${port + 1}`);
      listen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

// Development keeps the default 5273 via API_PORT; production overrides
// the start port via PORT (see deploy/ems-dashboard.service).
listen(Number(process.env.PORT ?? DEFAULT_PORT));

// Graceful shutdown: stop accepting requests before the pool ends, and
// always exit, even when pool.end() never resolves - a stuck database
// connection hangs it, and a listening process with an ended pool would
// answer every request with a 500. The timeout guarantees the exit; a
// second signal exits at once. SIGHUP covers closing the terminal that
// ran `pnpm dev:all`.
let shuttingDown = false;
function gracefulShutdown() {
  if (shuttingDown) {
    process.exit(0);
  }
  shuttingDown = true;
  const exit = () => process.exit(0);
  if (activeServer) {
    activeServer.close();
    activeServer.closeIdleConnections?.();
  }
  shutdown()
    .catch(() => {})
    .finally(exit);
  setTimeout(exit, 5000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, gracefulShutdown);
}
