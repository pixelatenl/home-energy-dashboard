// AI insights for the dashboard widgets: compact context builders for the
// weather and prices widgets, a shared Mistral client with per-insight
// response caching, a per-insight 30-minute upstream throttle and one shared
// daily call cap. The summary insight is generated through the advisory core
// (server/advisory/); the request is prepared by advisory-adapter.mjs. The
// API key is read from the environment and never logged.

import {
  localDateKey,
  localHourKey,
  localHourIndex,
  localHourLabel,
} from "./time.mjs";
import { guardNonFiniteText, guardTomorrowPrice } from "./advisory/narrative-guards.mjs";
import {
  generateAdvisoryCard,
  validateModelOutput,
} from "./advisory/advisory-core.mjs";
import { MONOLOGUE_STYLE_BRIEF } from "./advisory/advisory-monologue.mjs";
import {
  ADVISORY_MONOLOGUE_ENABLED,
  monologueSectionKeyFromPrompt,
  refreshAdvisoryMonologue,
} from "./advisory-adapter.mjs";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";
const REQUEST_TIMEOUT_MS = 15_000;
// At most one upstream call per 30 minutes per insight: the throttle for
// the weather, prices and battery widget paths.
const MIN_CALL_INTERVAL_MS = 30 * 60 * 1000;
// The summary insight regenerates in step with the live view, so its
// own throttle is tighter: 5 minutes by default, overridable via
// MISTRAL_SUMMARY_MIN_INTERVAL_MINUTES. The context signature is
// already bucketed, so a signature change is meaningful, not noisy;
// the shared daily cap remains the real guardrail and is never
// bypassed.
function summaryMinIntervalMs() {
  const raw = Number.parseInt(
    process.env.MISTRAL_SUMMARY_MIN_INTERVAL_MINUTES ?? "",
    10
  );
  return Number.isFinite(raw) && raw >= 0 ? raw * 60 * 1000 : 5 * 60 * 1000;
}
// Shared daily cap for every insight widget; overridden by
// MISTRAL_DAILY_CALL_LIMIT in the environment (the current plan allows 100).
const DEFAULT_DAILY_LIMIT = 100;

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
  "develop between today and tomorrow (only when the context contains " +
  "tomorrow's prices; otherwise focus on today and today's remaining " +
  "hours), when the cheapest window is, and one practical tip that " +
  "combines cheap grid hours with the sun's production peak " +
  "(self-consumption is free). Every sentence must refer to one single " +
  "coherent time frame: never combine a window on one day with prices " +
  "or solar production from another day. Never call appliances " +
  "solar-heavy; appliances are flexible or not. Advise to run flexible " +
  "appliances during the solar production peak to increase " +
  "self-consumption. Only state numbers that are present in the " +
  "provided context. If data for a period is unavailable, do not " +
  "reference that period, do not estimate, and do not invent values. " +
  "Be concrete, no marketing tone, no emoji.";

const BATTERY_SYSTEM_PROMPT =
  "You are the assistant of a home energy dashboard in the Netherlands " +
  "with a home battery and solar panels. Given battery state and flow " +
  "data, reply in 2 to 3 short sentences: the current charge state, how " +
  "the battery has been used today, and one practical tip about charging " +
  "(prefer surplus solar) or timing discharge. Be concrete, no marketing " +
  "tone, no emoji.";

// The hourly row matching the current hour in Europe/Amsterdam.
function currentHourConditions(todayHourly) {
  const prefix = localHourKey(new Date());
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
// when the weather data is unavailable. Tomorrow's price section exists
// only when tomorrow's prices are genuinely published (rows in the
// merged curve); otherwise the context carries the explicit unpublished
// note instead, so the model is never offered a tomorrow slot to fill.
// Every money value is rounded to display precision - two decimals -
// so the model can only ever quote prices the way humans read them;
// the payload outside the AI context keeps its full precision.
export function buildPriceContext(priceParts, solarDaily) {
  const priceData = priceParts?.priceData ?? null;
  const cheapestBlock = priceParts?.cheapestBlock ?? null;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const eur = (value) =>
    value === null || value === undefined
      ? null
      : Math.round(value * 100) / 100;
  const context = {
    current_price: eur(priceData?.current_price ?? null),
    today: {
      average: eur(priceData?.today?.average ?? null),
      min: eur(priceData?.today?.min ?? null),
      max: eur(priceData?.today?.max ?? null),
      peak_hour: priceData?.today?.peak_hour ?? null,
    },
    cheapest_window: cheapestBlock
      ? {
          day: localDateKey(new Date(cheapestBlock.start)),
          start_hour: localHourLabel(cheapestBlock.start),
          end_hour: localHourLabel(cheapestBlock.end),
          average_price: eur(cheapestBlock.average_price),
        }
      : null,
  };
  if (tomorrowAvailable) {
    context.tomorrow = {
      available: true,
      average: eur(priceData?.tomorrow?.average ?? null),
      min: eur(priceData?.tomorrow?.min ?? null),
      max: eur(priceData?.tomorrow?.max ?? null),
    };
  } else {
    context.tomorrow_note =
      "Tomorrow's prices are not published yet; they become available " +
      "later today. Do not mention or estimate tomorrow's prices.";
  }
  if (solarDaily) {
    context.solar_today = solarDaily;
  }
  return context;
}


// Detects a false denial of today's cheapest window while it exists in
// the context - the model sometimes claims the window is unavailable,
// right after being told that tomorrow's prices are not published.
export function deniesCheapestWindow(text) {
  return (
    /cheapest[^.!?]{0,80}(not available|unavailable|not (?:be )?determin|missing|cannot)/i.test(
      text
    ) || /no cheapest (window|hours?)/i.test(text)
  );
}

// Deterministic price insight from the merged data, served when the
// model output fails validation or the upstream is unavailable: plain
// today-only facts, never contradicting the price widget.
export function priceFallbackText(priceParts) {
  const priceData = priceParts?.priceData ?? null;
  if (!priceData) {
    return null;
  }
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const eur = (value) =>
    value === null || value === undefined
      ? null
      : `€${(Math.round(value * 1000) / 1000).toFixed(3)}/kWh`;
  const sentences = [];
  if (priceData.current_price != null) {
    sentences.push(`The current grid price is ${eur(priceData.current_price)}.`);
  }
  if (priceData.today?.average != null) {
    sentences.push(
      `Today's average is ${eur(priceData.today.average)}` +
        (priceData.today.peak_hour
          ? `, peaking around ${priceData.today.peak_hour}`
          : "") +
        "."
    );
  }
  const block = priceParts?.cheapestBlock;
  if (block) {
    sentences.push(
      `The cheapest window is ${localHourLabel(block.start)}-` +
        `${localHourLabel(block.end)} on ` +
        `${dayLabel(localDateKey(new Date(block.start)))} at ` +
        `${eur(block.average_price)} on average.`
    );
  }
  sentences.push(
    tomorrowAvailable
      ? "Tomorrow's prices are published."
      : "Tomorrow's prices are not published yet; they become available later today."
  );
  return sentences.filter(Boolean).join(" ");
}

// "Sat 11 Oct" for a local "YYYY-MM-DD" date key. Parsed and formatted at
// UTC noon so the label never depends on the server's ambient timezone.
// Weekday label for a date key, "Thu 15 Oct"; shared with the context
// builder for the advisory's day names.
export function dayLabel(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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

// Shared daily budget for every insight widget against
// MISTRAL_DAILY_CALL_LIMIT (read from the environment, default 100). The
// counter is per UTC day and in-memory; all four insight widgets (summary,
// prices, weather, battery) draw from the same budget.
export function getMistralBudget() {
  const utcDay = new Date().toISOString().slice(0, 10);
  const rawLimit = Number.parseInt(
    process.env.MISTRAL_DAILY_CALL_LIMIT ?? "",
    10
  );
  const dailyLimit =
    Number.isFinite(rawLimit) && rawLimit >= 0
      ? rawLimit
      : DEFAULT_DAILY_LIMIT;
  const callsToday = callsPerUtcDay.get(utcDay) ?? 0;
  return {
    daily_limit: dailyLimit,
    calls_today: callsToday,
    remaining_calls: Math.max(0, dailyLimit - callsToday),
  };
}

function dailyLimitReached() {
  return getMistralBudget().remaining_calls <= 0;
}

// One structured line per Mistral call decision, with the widget, the
// context signature the call was made against, the trigger reason
// (signature_change, throttle_expiry, force) and the outcome - so the
// call volume and its causes stay observable in the server log. Never
// logs the API key, the prompt or the context.
function logMistral(widget, signature, reason, outcome) {
  console.log(
    `[mistral] widget=${widget} signature=${signature} reason=${reason} outcome=${outcome}`
  );
}

// Compact single-line error text for the outcome field.
function shortError(err) {
  return String(err?.message ?? err).replace(/\s+/g, " ").slice(0, 80);
}

// Serves the cached insight when the payload has not changed, enforces the
// shared daily cap and the per-insight 30-minute throttle, and degrades to
// { text: null, parsed: null, error } on any upstream failure. The primary
// gate is the cache key (the hash over the materialized context); Mistral
// is called only when it changed since the last generated insight, or on
// force. With options.json the model output must parse as a JSON object; a
// parse failure is retried once before degrading. With options.validate the
// plain-text answer is checked: a failure is retried once with
// options.corrective appended to the prompt and repeated in the context,
// and a second failure returns error "validation_failed" - the caller
// decides the fallback. Retries count against the shared daily cap.
async function getInsight(namespace, systemPrompt, cacheKey, context, options = {}) {
  const asJson = options.json === true;
  const force = options.force === true;
  const validate = typeof options.validate === "function" ? options.validate : null;
  const corrective =
    typeof options.corrective === "string" ? options.corrective : null;
  const cached = insightCaches.get(namespace);
  if (!force && cached && cached.key === cacheKey) {
    return asJson
      ? { parsed: cached.parsed ?? null, generatedAt: cached.generatedAt, error: null }
      : { text: cached.text, generatedAt: cached.generatedAt, error: null };
  }
  const reason =
    force
      ? "force"
      : !cached || cached.key !== cacheKey
        ? "signature_change"
        : "throttle_expiry";

  const attempts = asJson || validate ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Daily call guard (in-memory; resets on the next UTC day). Shared by
    // all insights; retries also count.
    if (dailyLimitReached()) {
      logMistral(namespace, cacheKey, reason, "skipped_daily_limit");
      return { text: null, parsed: null, generatedAt: null, error: "daily_limit_reached" };
    }
    // At most one upstream call per 30 minutes regardless of cache keys; a
    // stale cached text is preferable to skipping the insight entirely.
    // A manual force bypasses this throttle but still counts against the
    // shared daily cap.
    if (
      attempt === 0 &&
      !force &&
      Date.now() - (lastCallAt.get(namespace) ?? 0) < MIN_CALL_INTERVAL_MS
    ) {
      logMistral(namespace, cacheKey, reason, "skipped_throttle");
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
      const prompt =
        attempt > 0 && corrective
          ? `${systemPrompt} ${corrective}`
          : systemPrompt;
      const payload =
        attempt > 0 && corrective ? { ...context, correction: corrective } : context;
      const text = await callMistral(prompt, payload);
      const generatedAt = new Date().toISOString();
      if (asJson) {
        const parsed = parseInsightJson(text);
        if (!parsed) {
          throw new Error("model returned invalid JSON");
        }
        logMistral(namespace, cacheKey, reason, "ok");
        insightCaches.set(namespace, { key: cacheKey, text, parsed, generatedAt });
        return { parsed, generatedAt, error: null };
      }
      if (validate && !validate(text)) {
        if (attempt < attempts - 1) {
          logMistral(namespace, cacheKey, reason, "validation_failed_retry");
          console.warn(
            `${namespace} insight failed validation; retrying with a corrective instruction`
          );
          continue;
        }
        logMistral(namespace, cacheKey, reason, "validation_failed");
        console.warn(`${namespace} insight failed validation twice; degrading`);
        return { text: null, parsed: null, generatedAt: null, error: "validation_failed" };
      }
      logMistral(namespace, cacheKey, reason, "ok");
      insightCaches.set(namespace, { key: cacheKey, text, generatedAt });
      return { text, generatedAt, error: null };
    } catch (err) {
      logMistral(namespace, cacheKey, reason, `error:${shortError(err)}`);
      if (attempt === attempts - 1) {
        console.warn(
          `AI context generation failed for ${namespace}: ${err?.message ?? err}`
        );
        return { text: null, parsed: null, generatedAt: null, error: "ai_unavailable" };
      }
    }
  }
}

export async function getWeatherContext(daily, todayHourly, options = {}) {
  const cacheKey = hashString(
    `${JSON.stringify(daily)}|${JSON.stringify(todayHourly)}`
  );
  return getInsight(
    "weather",
    WEATHER_SYSTEM_PROMPT,
    cacheKey,
    buildWeatherContext(daily, todayHourly),
    {
      ...options,
      validate: (text) => guardNonFiniteText(text).ok,
    }
  );
}

export async function getPriceContext(priceParts, solarDaily, options = {}) {
  const context = buildPriceContext(priceParts, solarDaily);
  // The cache key follows the context, so it changes the moment
  // tomorrow's prices are published and the insight can legitimately
  // start referencing them.
  const cacheKey = hashString(JSON.stringify(context));
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const cheapestExists = priceParts?.cheapestBlock != null;
  // The answer is checked against what the context actually contains:
  // NaN or Infinity is always rejected (the model inventing a value
  // the context does not have); while tomorrow is unpublished,
  // tomorrow price claims are rejected; while today's cheapest window
  // exists, denials of it are rejected. A failure is re-asked once
  // with the corrective instruction; a second failure degrades to the
  // deterministic fallback below, never contradicting the widget.
  const validators = [(text) => guardNonFiniteText(text).ok];
  const correctionNotes = [
    "Never print NaN or Infinity; omit any value that is missing " +
      "from the context instead of inventing it.",
  ];
  if (!tomorrowAvailable) {
    validators.push((text) => guardTomorrowPrice(text).ok);
    correctionNotes.push(
      "Tomorrow's prices are not published and must never be mentioned " +
        "or estimated; you may note that tomorrow's prices are not " +
        "published yet."
    );
  }
  if (cheapestExists) {
    validators.push((text) => !deniesCheapestWindow(text));
    correctionNotes.push(
      "Today's cheapest window is present in the context; state it " +
        "exactly as given."
    );
  }
  const result = await getInsight("prices", PRICE_SYSTEM_PROMPT, cacheKey, context, {
    force: options.force === true,
    validate:
      validators.length > 0
        ? (text) => validators.every((check) => check(text))
        : null,
    corrective:
      correctionNotes.length > 0
        ? `Your previous answer was rejected. ${correctionNotes.join(" ")} Answer again using only the provided context.`
        : null,
  });
  if (result.error) {
    const fallback = priceFallbackText(priceParts);
    if (fallback) {
      return { text: fallback, generatedAt: null, error: null };
    }
  }
  return result;
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

export async function getBatteryContext(summary, weatherDaily, priceParts, options = {}) {
  const context = buildBatteryContext(summary, weatherDaily, priceParts);
  const cacheKey = hashString(JSON.stringify(context));
  return getInsight("battery", BATTERY_SYSTEM_PROMPT, cacheKey, context, {
    ...options,
    validate: (text) => guardNonFiniteText(text).ok,
  });
}

// Context signature for the daily insight: the live values bucketed so
// that trivial drift does not trigger a regeneration. The insight
// regenerates only when this signature changes, which keeps the text in
// step with the panels at a low call volume (roughly one regeneration per
// hour from the current price hour changing, plus a handful per day from
// battery state transitions and kWh buckets crossing).
export function buildSummarySignature(summary, weatherDaily, priceParts, extras) {
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
  // Prices: current hour, tomorrow availability, cheapest window per
  // day, remaining peak (0.05).
  parts.push(`hour:${localHourIndex(new Date())}`);
  // Tomorrow's price rows: the insight must regenerate when they appear
  // (Zonneplan publishes them around 18:00), so tomorrow advice can
  // start and tomorrow claims never outlive the data.
  parts.push(`tpa:${priceParts?.tomorrowPricesAvailable === true ? 1 : 0}`);
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
  // Decision fields: self-consumption and self-sufficiency (5 pct),
  // top appliances (name and 0.5 kWh buckets), today's average price
  // (0.05), today's peak hours and the live CO2 intensity (25).
  parts.push(`sc:${bucket(summary?.today?.self_consumption_pct, 5)}`);
  const usageKwh = summary?.today?.total_usage_kwh ?? null;
  const importKwh = summary?.today?.import_kwh ?? null;
  const selfSufficiencyPct =
    usageKwh !== null && usageKwh > 0 && importKwh !== null
      ? Math.max(0, (usageKwh - importKwh) / usageKwh) * 100
      : null;
  parts.push(`ss:${bucket(selfSufficiencyPct, 5)}`);
  parts.push(
    `appl:${
      (extras?.topAppliances ?? [])
        .map((row) => `${row.appliance}:${bucket(row.kwh, 0.5)}`)
        .join(",") || "na"
    }`
  );
  parts.push(
    `pavg:${bucket(priceParts?.priceData?.today?.average, 0.05)}`
  );
  parts.push(
    `ph:${(priceParts?.peakHours?.today ?? []).join(",") || "na"}`
  );
  parts.push(`co2:${bucket(extras?.co2Intensity, 25)}`);
  // Precomputed candidates: label and exact saving, so the insight
  // regenerates when an opportunity appears, grows or disappears.
  parts.push(
    `cand:${
      (extras?.candidates ?? [])
        .map((candidate) => `${candidate.label}:${candidate.saving_eur}`)
        .join(",") || "na"
    }`
  );
  // The guidance, advisory and week outlook deliberately stay out of
  // the signature: the payload serves them from the live snapshot
  // extras at request time, so a reshaping forecast no longer churns
  // the model call. The candidate list above still regenerates the
  // insight when a real opportunity appears or disappears.
  return parts.join("|");
}

// Stable hash over the materialized context fields: the bucketed
// signature string above, hashed so /api/summary can expose a compact
// `signature` the kiosk compares against the signature the cached
// insight was generated from.
export function summarySignature(summary, weatherDaily, priceParts, extras) {
  return hashString(
    buildSummarySignature(summary, weatherDaily, priceParts, extras)
  );
}

// Records one upstream call against the shared daily cap.
function recordApiCall() {
  const utcDay = new Date().toISOString().slice(0, 10);
  callsPerUtcDay.set(utcDay, (callsPerUtcDay.get(utcDay) ?? 0) + 1);
}

// Capitalizes the first letter of a composed sentence; shared with
// the context builder's outlook lines.
export function capSentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The one money format for composed sentences: the euro sign flush
// against the amount (the subtext line's spacing style - €0.36, never
// "EUR 0.36"), with the pinned precision: two decimals whenever the
// value is nonzero at two decimals, more only when two would show
// 0.00 - a nonzero price never renders as €0.00. Shared with the
// context builder's served sentences.
export function eurFactText(value) {
  const two = value.toFixed(2);
  if (Number(two) !== 0) {
    return `€${two}`;
  }
  return `€${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// Daily summary insight: gated by the context signature. The signature is
// the primary gate - Mistral is called only when it changed since the
// last generated insight, or on force - with the summary's own minimum
// interval underneath. The cache stores the signature the text was
// generated from and is served until the signature changes. Request-
// driven warm-up: when the signature changed, /api/summary fires a
// background regeneration (deduplicated below) and answers immediately
// with the cached insight in state "reasoning"; force keeps its
// synchronous, throttle-bypassing behavior. When the interval has not
// expired, the shared daily cap is exhausted or generation fails, the
// previous insight keeps being served in state "reasoning" with the
// error populated (fail soft) rather than an unverified text. Concurrent
// callers (the kiosk polls /api/summary from several widgets) join one
// in-flight generation.
let summaryInsightCache = null; // { signature, asOf, result }
let summaryLastCallAt = 0;
let summaryInFlight = null; // { signature, promise }
// The last background warm-up failure reason, served with the cached
// insight so the payload can report why the regeneration has not
// landed yet. Cleared when a generation succeeds.
let summaryWarmupError = null;

// The last generated summary insight, read-only: no generation, throttle
// or budget logic runs. Serves the insight debug endpoint's view of the
// cached narrative and its regeneration state, computed against the live
// signature passed in: "fresh" when the cached insight matches it,
// otherwise "reasoning" (the next request warms the new signature up).
// The card itself is never cached: the debug route recomposes it from
// the live facts through the adapter, exactly as the summary route does.
export function peekSummaryInsight(liveSignature = null) {
  const cached = summaryInsightCache;
  if (!cached) {
    return null;
  }
  const narrative = cached.result.narrative ?? null;
  return {
    signature: cached.signature,
    as_of: cached.asOf,
    state:
      liveSignature !== null && cached.signature === liveSignature
        ? "fresh"
        : "reasoning",
    narrative,
    generated_at: cached.result.generatedAt ?? null,
  };
}

// The monologue refresh seam (Stage 4): wraps every per-section model
// call in the shared budget accounting - the daily cap check, the
// summary throttle timestamp and recordApiCall - then hands the
// prompt to the injected stub (the same model seam the tests use) or
// the real model call. Sections whose composition facts are unchanged
// never reach the seam: the adapter replays their stored narrative.
// Each section generation logs one line with the section label, the
// generation reason (new-facts, retry or fallback) and the count of
// figure-verification rejections from validation; zero rejections is
// the healthy state, and a rejection followed by a successful retry
// is logged, never silently passed. logContext carries the refresh's
// signature and reason for the budget log lines.
export async function generateInsightMonologue(
  advisory,
  cachedSections,
  stub = null,
  logContext = null
) {
  const signature = logContext?.signature ?? "monologue";
  const reason = logContext?.reason ?? "monologue_refresh";
  const seam = async (prompt) => {
    if (dailyLimitReached()) {
      logMistral("summary", signature, reason, "skipped_daily_limit");
      return null; // the section serves its fallback sentences
    }
    summaryLastCallAt = Date.now();
    recordApiCall();
    if (stub !== null) {
      return stub(prompt);
    }
    try {
      // The section prompt carries the style brief verbatim; the
      // system message keeps it and the user message carries the task
      // and the section's facts.
      const task = prompt.startsWith(MONOLOGUE_STYLE_BRIEF)
        ? prompt.slice(MONOLOGUE_STYLE_BRIEF.length).trim()
        : prompt;
      const key = monologueSectionKeyFromPrompt(prompt);
      if (key === null) {
        return null;
      }
      const prose = await callMistral(MONOLOGUE_STYLE_BRIEF, task);
      return { narratives: { [key]: prose } };
    } catch (err) {
      logMistral("summary", signature, reason, `error:${shortError(err)}`);
      return null; // a stub failure serves the fallback, never a crash
    }
  };
  const refreshed = await refreshAdvisoryMonologue(
    advisory,
    cachedSections,
    seam
  );
  for (const line of refreshed.log) {
    console.log(
      `monologue ${line.label}: ${line.reason}, figure rejections ${line.rejections}`
    );
  }
  return { sections: refreshed.sections };
}

export async function getSummaryInsight(snapshot, options = {}) {
  const { signature, asOf } = snapshot;
  const force = options.force === true;
  // Request-driven warm-up: answer from the cache immediately and let a
  // signature change regenerate in the background. Never combined with
  // force, which keeps its synchronous behavior.
  const background = options.background === true && !force;
  // The advisory core request, prepared by the adapter and passed in by
  // the index layer - this module never reads the environment. It
  // carries the consolidated facts, the injected nowIso and the style
  // brief; the core is the only pipeline, so it is required.
  const advisory = options.advisory ?? null;
  const cached = summaryInsightCache;
  const reason = force
    ? "force"
    : background
      ? "signature_change_warmup"
      : "signature_change";

  // Serves a result with its regeneration state: "fresh" (the cached
  // insight matches the live signature), "reasoning" (the signatures
  // differ and a regeneration is in flight) or "error" (no cached
  // insight at all). The stale field is the deprecated mirror of
  // state === "reasoning", kept one release for the debug panel and old
  // payload comparisons; remove it in the C25 cleanup.
  const serve = (result, state, error = null) => ({
    ...result,
    asOf,
    state,
    stale: state === "reasoning",
    error,
  });
  const empty = (error, state = "error") => ({
    narrative: null,
    generatedAt: null,
    asOf,
    state,
    stale: state === "reasoning",
    error,
  });
  const degrade = (error) =>
    cached ? serve(cached.result, "reasoning", error) : empty(error);

  // Cache hit: the cached insight was generated from this exact signature.
  if (!force && cached && cached.signature === signature) {
    return serve(cached.result, "fresh");
  }

  const generate = async () => {
    // Force bypasses the summary minimum interval but never the shared
    // daily cap, and still counts.
    if (dailyLimitReached()) {
      logMistral("summary", signature, reason, "skipped_daily_limit");
      return degrade("daily_limit_reached");
    }
    if (!force && Date.now() - summaryLastCallAt < summaryMinIntervalMs()) {
      logMistral("summary", signature, reason, "skipped_throttle");
      return degrade("throttled");
    }
    // The advisory core path: the summary insight is produced by the
    // core's generateAdvisoryCard with the adapter's facts and style
    // brief - the core is the only pipeline. Only the validated
    // narrative is cached; the card is recomposed from the live facts
    // on every serve by the adapter, so the same signature, budget,
    // warm-up and in-flight machinery keeps driving regeneration.
    if (advisory === null) {
      // Every caller routes through the adapter; a missing request is
      // a wiring fault, served fail-soft like a generation failure.
      logMistral(
        "summary",
        signature,
        reason,
        "error:missing advisory request"
      );
      return degrade("ai_unavailable");
    }
    // The modelStub wraps the existing callMistral: every call draws
    // from the shared daily budget, respects the summary minimum
    // interval and is logged through the same one-line accounting.
    // A transport-level failure is recorded out of band - the core
    // treats a failed stub as an empty narrative, which must never be
    // cached as a fresh insight.
    let stubFailure = null;
    let stubCalls = 0;
    const modelStub = async (modelContext) => {
      stubCalls += 1;
      if (dailyLimitReached()) {
        logMistral("summary", signature, reason, "skipped_daily_limit");
        stubFailure = "daily_limit_reached";
        return { warning: null, contextNote: null };
      }
      summaryLastCallAt = Date.now();
      recordApiCall();
      let parsed = null;
      try {
        parsed = parseInsightJson(
          await callMistral(advisory.styleBrief, modelContext)
        );
      } catch (err) {
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
        stubFailure = "ai_unavailable";
        return { warning: null, contextNote: null };
      }
      if (parsed === null || typeof parsed !== "object") {
        logMistral(
          "summary",
          signature,
          reason,
          "error:model returned invalid JSON"
        );
        stubFailure = "model returned invalid JSON";
        return { warning: null, contextNote: null };
      }
      // The core validates after the stub returns; running the same
      // pure check here only logs the rejection reasons in the
      // existing throttled logging style.
      const candidate = {
        warning:
          typeof parsed.warning === "string" && parsed.warning.trim() !== ""
            ? parsed.warning
            : null,
        contextNote:
          typeof parsed.contextNote === "string" &&
          parsed.contextNote.trim() !== ""
            ? parsed.contextNote
            : null,
      };
      const verdict = validateModelOutput(candidate, modelContext.sections);
      if (!verdict.ok) {
        logMistral(
          "summary",
          signature,
          reason,
          stubCalls === 1 ? "validation_failed_retry" : "validation_failed"
        );
        console.warn(
          `Advisory core rejected the model output: ${verdict.reasons.join(
            "; "
          )}`
        );
      }
      return parsed;
    };
    let card = null;
    try {
      card = await generateAdvisoryCard(
        advisory.facts,
        advisory.nowIso,
        modelStub
      );
    } catch (err) {
      logMistral("summary", signature, reason, `error:${shortError(err)}`);
      return degrade("ai_unavailable");
    }
    // A transport-level failure is never served as an empty narrative:
    // the previous insight stays in place, fail soft.
    if (stubFailure !== null) {
      return degrade(stubFailure);
    }
    logMistral("summary", signature, reason, "ok");
    const result = {
      narrative: { warning: card.warning, contextNote: card.context_note },
      generatedAt: new Date().toISOString(),
    };
    // The monologue (Stage 4): generated after the card, only while the
    // switch is on, and stored in the insight record - the section
    // store carries each narrative keyed by the hash of its
    // composition facts, so a later refresh reuses every section
    // whose facts are unchanged and makes no model call for it. A
    // failure here never fails the card generation: the record serves
    // the monologue it has, and every section without a stored
    // narrative serves its deterministic fallback sentences.
    if (ADVISORY_MONOLOGUE_ENABLED) {
      try {
        result.monologue = await generateInsightMonologue(
          advisory,
          cached?.result?.monologue?.sections ?? null,
          options.monologueStub ?? null,
          { signature, reason }
        );
      } catch (err) {
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
      }
    }
    summaryInsightCache = { signature, asOf, result };
    summaryWarmupError = null;
    return serve(result, "fresh");
  };

  // Request-driven warm-up: fire-and-forget regeneration, deduplicated
  // by summaryInFlight - a second generation for the same signature
  // never starts, and while any generation is in flight the next
  // request triggers the newer signature's warm-up. The endpoint
  // answers immediately with the cached insight in state "reasoning"
  // (or the empty pending shape before the first insight exists).
  if (background) {
    if (!summaryInFlight) {
      const promise = generate().catch((err) => {
        // generate degrades every known failure; this guard only keeps
        // the fire-and-forget call from becoming an unhandled
        // rejection. The prompt, context and API key are never logged.
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
        return cached
          ? serve(cached.result, "reasoning", "ai_unavailable")
          : empty("ai_unavailable");
      });
      summaryInFlight = { signature, promise };
      void promise.then((result) => {
        summaryWarmupError =
          result.state === "fresh" ? null : result.error ?? null;
        if (summaryInFlight?.promise === promise) {
          summaryInFlight = null;
        }
      });
    }
    return cached
      ? serve(cached.result, "reasoning", summaryWarmupError)
      : empty(null, "reasoning");
  }

  // Synchronous callers (force, or the insight routes) join a
  // generation already in flight for the same signature instead of
  // starting a second one.
  if (summaryInFlight && summaryInFlight.signature === signature) {
    return summaryInFlight.promise;
  }

  const promise = generate();
  summaryInFlight = { signature, promise };
  try {
    return await promise;
  } finally {
    if (summaryInFlight?.promise === promise) {
      summaryInFlight = null;
    }
  }
}
