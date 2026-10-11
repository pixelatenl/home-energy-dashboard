// AI insights for the dashboard widgets: compact context builders for the
// weather and prices widgets, a shared Mistral client with per-insight
// response caching, a per-insight 30-minute upstream throttle and one shared
// daily call cap. The API key is read from the environment and never
// logged.

import {
  localDateKey,
  localHourKey,
  localHourLabel,
} from "./time.mjs";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";
const REQUEST_TIMEOUT_MS = 15_000;
// At most one upstream call per 30 minutes per insight.
const MIN_CALL_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 20;

const WEATHER_SYSTEM_PROMPT =
  "You are the assistant of a home energy dashboard in the Netherlands. " +
  "Given forecast data, reply in 2 to 3 short sentences: how good the " +
  "coming days are for solar production, when production peaks today, and " +
  "one practical tip about timing energy use. Be concrete, no marketing " +
  "tone, no emoji.";

const PRICE_SYSTEM_PROMPT =
  "You are the assistant of a home energy dashboard in the Netherlands " +
  "with a dynamic electricity contract and solar panels. Given price and " +
  "production data, reply in 2 to 3 short sentences: how grid prices " +
  "develop between today and tomorrow, when the cheapest window is, and " +
  "one practical tip that combines cheap grid hours with the sun's " +
  "production peak (self-consumption is free). Be concrete, no marketing " +
  "tone, no emoji.";

const SUMMARY_SYSTEM_PROMPT =
  "You are the assistant of a home energy dashboard in the Netherlands " +
  "with solar panels and a dynamic electricity contract. Given " +
  "statistics, solar forecast and price data, reply in JSON only: " +
  "{ one_liner: string (a single short sentence for the dashboard header " +
  "about the context of the day), summary: string (2 to 3 short sentences " +
  "about today and the coming days), actions: array of at most 3 objects " +
  "{ text: string, window: string, reason: string } } with concrete, " +
  "time-specific recommended actions such as when to run appliances. No " +
  "marketing tone, no emoji. Distinguish clearly between actual production " +
  "today and the forecast for today; never present the forecast as " +
  "realized production.";

const BATTERY_SYSTEM_PROMPT =
  "You are the assistant of a home energy dashboard in the Netherlands " +
  "with a home battery and solar panels. Given battery state and flow " +
  "data, reply in 2 to 3 short sentences: the current charge state, how " +
  "the battery has been used today, and one practical tip about charging " +
  "(prefer surplus solar) or timing discharge. Be concrete, no marketing " +
  "tone, no emoji.";

// The hourly row matching the current hour in Europe/Amsterdam.
function currentHourConditions(todayHourly) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const prefix = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;
  return todayHourly.find((hour) => hour.hour.startsWith(prefix)) ?? null;
}

// The N hours with the highest estimated PV production.
export function topProductionHours(todayHourly, count = 3) {
  return [...todayHourly]
    .sort((a, b) => b.estimated_pv_wh - a.estimated_pv_wh)
    .slice(0, count)
    .map((hour) => ({
      hour: hour.hour,
      estimated_pv_wh: hour.estimated_pv_wh,
    }));
}

// Compact summary of the weather forecast payloads for the model. The
// hourly result is the { current, hours } object from weatherHourly(); a
// bare hour array is accepted for backward compatibility. Present
// conditions prefer the "current" analysis over the hourly series value.
export function buildWeatherContext(daily, hourlyResult) {
  const hours = Array.isArray(hourlyResult)
    ? hourlyResult
    : (hourlyResult?.hours ?? []);
  const currentConditions = Array.isArray(hourlyResult)
    ? currentHourConditions(hourlyResult)
    : (hourlyResult?.current ?? currentHourConditions(hours) ?? null);
  return {
    days: daily.map((day) => ({
      date: day.date,
      solar_score: day.solar_score,
      estimated_kwh: day.estimated_kwh,
      temp_min: day.temp_min,
      temp_max: day.temp_max,
      weather_code: day.weather_code,
    })),
    today: {
      top_production_hours: topProductionHours(hours),
      current_conditions: currentConditions,
    },
  };
}

// Hour label "HH:00" for an ISO timestamp in Europe/Amsterdam is provided
// by server/time.mjs (localHourLabel).

// Compact price summary for the model. solarDaily is optional and omitted
// when the weather data is unavailable.
export function buildPriceContext(priceData, cheapestBlock, solarDaily) {
  const context = {
    current_price: priceData?.current_price ?? null,
    today: priceData?.today ?? null,
    tomorrow: priceData?.tomorrow ?? null,
    cheapest_window: cheapestBlock
      ? {
          start_hour: localHourLabel(cheapestBlock.start),
          end_hour: localHourLabel(cheapestBlock.end),
          average_price: cheapestBlock.average_price,
        }
      : null,
  };
  if (solarDaily) {
    context.solar_today = solarDaily;
  }
  return context;
}

// Compact summary statistics context for the model. weatherDaily and
// priceParts are optional; parts whose source is unavailable are omitted.
// priceParts has the shape returned by getPriceContextData() in prices.mjs.
export function buildSummaryContext(summary, weatherDaily, priceParts) {
  const context = {
    today: {
      net_usage_kwh: summary?.today?.import_kwh ?? null,
      total_usage_kwh: summary?.today?.total_usage_kwh ?? null,
      back_delivery_kwh: summary?.today?.export_kwh ?? null,
      cost_eur: summary?.today?.cost_eur ?? null,
    },
    week_cost_eur: summary?.week?.cost_eur ?? null,
    month_cost_eur: summary?.month?.cost_eur ?? null,
  };
  if (Array.isArray(weatherDaily)) {
    // One compact line separating actual production from the forecast,
    // e.g. "pv today: 9.5 kWh actual (forecast 15.88 kWh)".
    const todayEntry =
      weatherDaily.find(
        (day) => day.date === localDateKey(new Date())
      ) ?? null;
    const actual = summary?.today?.pv_kwh ?? null;
    const forecast = todayEntry?.estimated_kwh ?? null;
    if (actual !== null || forecast !== null) {
      context.pv_today =
        `pv today: ${actual !== null ? `${actual} kWh` : "unknown"} actual ` +
        `(forecast ${forecast !== null ? `${forecast} kWh` : "unknown"})`;
    }
    context.solar_forecast = weatherDaily.map((day) => ({
      date: day.date,
      solar_score: day.solar_score,
      estimated_kwh: day.estimated_kwh,
    }));
  }
  if (priceParts?.priceData) {
    context.current_price = priceParts.priceData.current_price ?? null;
    context.cheapest_window = priceParts.cheapestBlock
      ? {
          start_hour: localHourLabel(priceParts.cheapestBlock.start),
          end_hour: localHourLabel(priceParts.cheapestBlock.end),
          average_price: priceParts.cheapestBlock.average_price,
        }
      : null;
    context.tomorrow = {
      available: priceParts.priceData.tomorrow?.available ?? null,
      average: priceParts.priceData.tomorrow?.average ?? null,
    };
  }
  // One compact battery line, or "no data" when unavailable.
  if (summary?.battery_available) {
    const parts = [];
    if (summary.battery_soc_pct !== null) {
      parts.push(`soc ${summary.battery_soc_pct} pct`);
    }
    if (
      (summary.battery_state === "charging" ||
        summary.battery_state === "discharging") &&
      summary.battery_power_w !== null
    ) {
      parts.push(`${summary.battery_state} ${Math.abs(summary.battery_power_w)} W`);
    } else {
      parts.push("idle");
    }
    parts.push(
      `today ${summary.today?.battery_charged_kwh} kWh in, ` +
        `${summary.today?.battery_discharged_kwh} kWh out`
    );
    context.battery = parts.join(", ");
  } else {
    context.battery = "no data";
  }
  return context;
}

async function callMistral(systemPrompt, context) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY not configured");
  }
  const response = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Mistral returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Mistral returned no content");
  }
  return text.trim();
}

// Simple FNV-1a string hash; only used as a cache key, not for security.
function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const insightCaches = new Map(); // namespace -> { key, text, parsed?, generatedAt }
const lastCallAt = new Map(); // namespace -> timestamp of the last upstream call
const callsPerUtcDay = new Map(); // UTC day -> call count, shared by all insights

// Parses model output as a JSON object; strips markdown code fences the
// model may have added. Returns null on any parse failure.
function parseInsightJson(text) {
  let candidate = text.trim();
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    candidate = fence[1];
  }
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function dailyLimitReached() {
  const utcDay = new Date().toISOString().slice(0, 10);
  const rawLimit = Number.parseInt(
    process.env.MISTRAL_DAILY_CALL_LIMIT ?? "",
    10
  );
  const dailyLimit =
    Number.isFinite(rawLimit) && rawLimit >= 0
      ? rawLimit
      : DEFAULT_DAILY_LIMIT;
  return (callsPerUtcDay.get(utcDay) ?? 0) >= dailyLimit;
}

// Serves the cached insight when the payload has not changed, enforces the
// shared daily cap and the per-insight 30-minute throttle, and degrades to
// { text: null, parsed: null, error } on any upstream failure. With
// options.json the model output must parse as a JSON object; a parse
// failure is retried once before degrading.
async function getInsight(namespace, systemPrompt, cacheKey, context, options = {}) {
  const asJson = options.json === true;
  const cached = insightCaches.get(namespace);
  if (cached && cached.key === cacheKey) {
    return asJson
      ? { parsed: cached.parsed ?? null, generatedAt: cached.generatedAt, error: null }
      : { text: cached.text, generatedAt: cached.generatedAt, error: null };
  }

  const attempts = asJson ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Daily call guard (in-memory; resets on the next UTC day). Shared by
    // all insights; retries also count.
    if (dailyLimitReached()) {
      return { text: null, parsed: null, generatedAt: null, error: "daily_limit_reached" };
    }
    // At most one upstream call per 30 minutes regardless of cache keys; a
    // stale cached text is preferable to skipping the insight entirely.
    if (attempt === 0 && Date.now() - (lastCallAt.get(namespace) ?? 0) < MIN_CALL_INTERVAL_MS) {
      if (cached) {
        return asJson
          ? { parsed: cached.parsed ?? null, generatedAt: cached.generatedAt, error: null }
          : { text: cached.text, generatedAt: cached.generatedAt, error: null };
      }
      return { text: null, parsed: null, generatedAt: null, error: "ai_unavailable" };
    }
    const utcDay = new Date().toISOString().slice(0, 10);
    lastCallAt.set(namespace, Date.now());
    callsPerUtcDay.set(utcDay, (callsPerUtcDay.get(utcDay) ?? 0) + 1);
    try {
      const text = await callMistral(systemPrompt, context);
      const generatedAt = new Date().toISOString();
      if (asJson) {
        const parsed = parseInsightJson(text);
        if (!parsed) {
          throw new Error("model returned invalid JSON");
        }
        insightCaches.set(namespace, { key: cacheKey, text, parsed, generatedAt });
        return { parsed, generatedAt, error: null };
      }
      insightCaches.set(namespace, { key: cacheKey, text, generatedAt });
      return { text, generatedAt, error: null };
    } catch (err) {
      if (attempt === attempts - 1) {
        console.warn(
          `AI context generation failed for ${namespace}: ${err?.message ?? err}`
        );
        return { text: null, parsed: null, generatedAt: null, error: "ai_unavailable" };
      }
    }
  }
}

export async function getWeatherContext(daily, todayHourly) {
  const cacheKey = hashString(
    `${JSON.stringify(daily)}|${JSON.stringify(todayHourly)}`
  );
  return getInsight(
    "weather",
    WEATHER_SYSTEM_PROMPT,
    cacheKey,
    buildWeatherContext(daily, todayHourly)
  );
}

export async function getPriceContext(priceData, cheapestBlock, solarDaily) {
  const cacheKey = hashString(
    `${JSON.stringify(priceData)}|${JSON.stringify(cheapestBlock)}|${JSON.stringify(solarDaily)}`
  );
  return getInsight(
    "prices",
    PRICE_SYSTEM_PROMPT,
    cacheKey,
    buildPriceContext(priceData, cheapestBlock, solarDaily)
  );
}

// Compact battery context for the model: the snapshot, the range
// throughputs and today's hourly flow; the solar forecast and the price
// context are optional.
export function buildBatteryContext(summary, weatherDaily, priceParts) {
  const context = {
    soc_pct: summary?.battery_soc_pct ?? null,
    state: summary?.battery_state ?? null,
    power_w: summary?.battery_power_w ?? null,
    today_in_kwh: summary?.today?.battery_charged_kwh ?? null,
    today_out_kwh: summary?.today?.battery_discharged_kwh ?? null,
    week_in_kwh: summary?.week?.battery_charged_kwh ?? null,
    week_out_kwh: summary?.week?.battery_discharged_kwh ?? null,
    month_in_kwh: summary?.month?.battery_charged_kwh ?? null,
    month_out_kwh: summary?.month?.battery_discharged_kwh ?? null,
    flow_hourly: (summary?.battery_flow_hourly ?? []).map((hour) => ({
      hour: localHourLabel(hour.ts),
      in_kwh: hour.in_kwh,
      out_kwh: hour.out_kwh,
    })),
  };
  if (Array.isArray(weatherDaily)) {
    context.solar_forecast = weatherDaily.map((day) => ({
      date: day.date,
      solar_score: day.solar_score,
      estimated_kwh: day.estimated_kwh,
    }));
  }
  if (priceParts?.priceData) {
    context.current_price = priceParts.priceData.current_price ?? null;
    context.cheapest_window = priceParts.cheapestBlock
      ? {
          start_hour: localHourLabel(priceParts.cheapestBlock.start),
          end_hour: localHourLabel(priceParts.cheapestBlock.end),
          average_price: priceParts.cheapestBlock.average_price,
        }
      : null;
  }
  return context;
}

export async function getBatteryContext(summary, weatherDaily, priceParts) {
  const context = buildBatteryContext(summary, weatherDaily, priceParts);
  const cacheKey = hashString(JSON.stringify(context));
  return getInsight("battery", BATTERY_SYSTEM_PROMPT, cacheKey, context);
}

// Daily summary insight: JSON with a summary text and up to three
// recommended actions. The model output is parsed defensively; on failure
// the caller receives { summary: null, actions: [], error }.
// Context signature for the daily insight: the live values bucketed so
// that trivial drift does not trigger a regeneration. The insight
// regenerates only when this signature changes, which keeps the text in
// step with the panels at a low call volume (roughly one regeneration per
// hour from the current price hour changing, plus a handful per day from
// battery state transitions and kWh buckets crossing).
export function buildSummarySignature(summary, weatherDaily, priceParts) {
  const bucket = (value, size) =>
    value === null || value === undefined
      ? "na"
      : Math.floor(value / size).toString();
  const parts = [];
  // Battery: state, SOC (10%), power (500 W), today in/out (0.5 kWh).
  parts.push(`b:${summary?.battery_state ?? "na"}`);
  parts.push(`soc:${bucket(summary?.battery_soc_pct, 10)}`);
  parts.push(
    `pw:${
      summary?.battery_power_w === null || summary?.battery_power_w === undefined
        ? "na"
        : Math.floor(summary.battery_power_w / 500)
    }`
  );
  parts.push(`bin:${bucket(summary?.today?.battery_charged_kwh, 0.5)}`);
  parts.push(`bout:${bucket(summary?.today?.battery_discharged_kwh, 0.5)}`);
  // Usage: from grid, home usage, to grid (0.5 kWh), cost (EUR 0.10).
  parts.push(`fg:${bucket(summary?.today?.import_kwh, 0.5)}`);
  parts.push(`hu:${bucket(summary?.today?.total_usage_kwh, 0.5)}`);
  parts.push(`tg:${bucket(summary?.today?.export_kwh, 0.5)}`);
  parts.push(`cost:${bucket(summary?.today?.cost_eur, 0.1)}`);
  // Prices: current hour, cheapest window per day, remaining peak (0.05).
  parts.push(`hour:${localHourKey(new Date()).slice(11, 13)}`);
  parts.push(
    `cw:${
      priceParts?.cheapestByDay?.today
        ? localHourLabel(priceParts.cheapestByDay.today.start)
        : "na"
    }`
  );
  parts.push(
    `cwt:${
      priceParts?.cheapestByDay?.tomorrow
        ? localHourLabel(priceParts.cheapestByDay.tomorrow.start)
        : "na"
    }`
  );
  parts.push(`maxp:${bucket(priceParts?.remainingMaxPrice, 0.05)}`);
  // Solar: actual and forecast production today (0.5 kWh).
  const todayForecast = Array.isArray(weatherDaily)
    ? (weatherDaily.find(
        (day) => day.date === localDateKey(new Date())
      )?.estimated_kwh ?? null)
    : null;
  parts.push(`pvact:${bucket(summary?.today?.pv_kwh, 0.5)}`);
  parts.push(`pvfc:${bucket(todayForecast, 0.5)}`);
  return parts.join("|");
}

// Records one upstream call against the shared daily cap.
function recordApiCall() {
  const utcDay = new Date().toISOString().slice(0, 10);
  callsPerUtcDay.set(utcDay, (callsPerUtcDay.get(utcDay) ?? 0) + 1);
}

// Daily summary insight: cached against the bucketed context signature
// and regenerated as soon as the signature changes (or on force), so the
// text tracks the live panels. When the shared daily cap is exhausted (or
// the upstream fails), the cached text is served and marked stale.
let summaryInsightCache = null; // { signature, asOf, result }

export async function getSummaryInsight(
  summary,
  weatherDaily,
  priceParts,
  options = {}
) {
  const force = options.force === true;
  const signature = buildSummarySignature(summary, weatherDaily, priceParts);
  const asOf = summary?.summary_as_of ?? null;
  const cached = summaryInsightCache;

  if (!force && cached && cached.signature === signature) {
    return { ...cached.result, asOf: cached.asOf, stale: false, error: null };
  }

  const degrade = (error) => {
    if (cached) {
      return {
        ...cached.result,
        asOf: cached.asOf,
        stale: true,
        error: null,
      };
    }
    return {
      oneLiner: null,
      summary: null,
      actions: [],
      generatedAt: null,
      asOf,
      stale: error === "daily_limit_reached",
      error,
    };
  };

  if (dailyLimitReached()) {
    return degrade("daily_limit_reached");
  }

  const context = buildSummaryContext(summary, weatherDaily, priceParts);
  let success = null;
  for (let attempt = 0; attempt < 2 && !success; attempt++) {
    // The JSON output is retried once on a parse failure; every attempt
    // counts against the shared daily cap.
    if (dailyLimitReached()) {
      return degrade("daily_limit_reached");
    }
    recordApiCall();
    try {
      const text = await callMistral(SUMMARY_SYSTEM_PROMPT, context);
      const parsed = parseInsightJson(text);
      if (!parsed || typeof parsed.summary !== "string") {
        throw new Error("model returned invalid JSON");
      }
      success = parsed;
    } catch {
      // Retried on the next loop iteration, degraded after it.
    }
  }
  if (!success) {
    return degrade("ai_unavailable");
  }

  const oneLiner =
    typeof success.one_liner === "string" ? success.one_liner : null;
  const actions = Array.isArray(success.actions)
    ? success.actions
        .filter((action) => action && typeof action.text === "string")
        .slice(0, 3)
        .map((action) => ({
          text: action.text,
          window: typeof action.window === "string" ? action.window : "",
          reason: typeof action.reason === "string" ? action.reason : "",
        }))
    : [];
  const result = {
    oneLiner,
    summary: success.summary,
    actions,
    generatedAt: new Date().toISOString(),
  };
  summaryInsightCache = { signature, asOf, result };
  return { ...result, asOf, stale: false, error: null };
}
