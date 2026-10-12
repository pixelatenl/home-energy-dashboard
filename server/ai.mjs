// AI insights for the dashboard widgets: compact context builders for the
// weather and prices widgets, a shared Mistral client with per-insight
// response caching, a per-insight 30-minute upstream throttle and one shared
// daily call cap. The API key is read from the environment and never
// logged.

import {
  localDateKey,
  localDayStartUtcMs,
  localHourKey,
  localHourIndex,
  localHourLabel,
  localIsoWithOffset,
  nextDateKey,
} from "./time.mjs";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";
const REQUEST_TIMEOUT_MS = 15_000;
// At most one upstream call per 30 minutes per insight.
const MIN_CALL_INTERVAL_MS = 30 * 60 * 1000;
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

// Primary prompt: the model returns structured actions the frontend
// renders as designed rows (day chip, window, icon, title, reason,
// price). A window without a date is invalid.
const SUMMARY_SYSTEM_PROMPT_STRUCTURED =
  "You are the assistant of a home energy dashboard in the Netherlands " +
  "with solar panels and a dynamic electricity contract. Given " +
  "statistics, solar forecast and price data, reply in JSON only: " +
  "{ one_liner: string (a single short sentence for the dashboard header " +
  "about the context of the day), summary: string (2 to 3 short sentences " +
  "about today and the coming days), actions: array of at most 3 objects " +
  '{ date: string ("YYYY-MM-DD"), start: string ("HH:MM"), ' +
  'end: string ("HH:MM"), type: string (one of "appliance", "battery", ' +
  '"ev", "solar", "general"), title: string, reason: string, ' +
  "price_eur: number or null (the average EUR/kWh in the window when " +
  "known) } }. Use the dates from the context for the date fields. " +
  "Recommend only windows that lie in the future relative to the current " +
  "time. The title is a short imperative. The reason is one sentence " +
  "containing the key number. No marketing tone, no emoji. Distinguish " +
  "clearly between actual production today and the forecast for today; " +
  "never present the forecast as realized production. The summary must " +
  "open by naming today with its date, and when describing future days it " +
  "must name them with their dates. Never invent or extrapolate prices; " +
  "if data for a period is unavailable, do not make claims about that " +
  "period. The context field tomorrow_prices_available says whether " +
  "price rows for tomorrow exist: when it is false, do not mention " +
  "tomorrow's prices or any cheapest window for tomorrow, and base " +
  "advice only on today's actual prices, today's remaining hours and " +
  "live usage. Every action must refer to one single coherent time " +
  "frame: never combine a window on one day with solar production or " +
  "prices from another day in the same sentence.";

// Fallback prompt (prose actions) used when the structured output fails
// validation twice, so the dashboard never breaks.
const SUMMARY_SYSTEM_PROMPT_PROSE =
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
  "realized production. Every action must open with an explicit day label " +
  '- "Today (Sat 11 Oct)" or "Tomorrow (Sun 12 Oct)" - directly before ' +
  "the time window; a window without a day label is invalid and must be " +
  "rewritten. The summary must open by naming today with its date, and " +
  "when describing future days it must name them with their dates. " +
  "Never invent or extrapolate prices; if data for a period is " +
  "unavailable, do not make claims about that period. The context field " +
  "tomorrow_prices_available says whether price rows for tomorrow exist: " +
  "when it is false, do not mention tomorrow's prices or any cheapest " +
  "window for tomorrow, and base advice only on today's actual prices, " +
  "today's remaining hours and live usage. Every action must refer to " +
  "one single coherent time frame: never combine a window on one day " +
  "with solar production or prices from another day in the same sentence.";

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
export function buildPriceContext(priceParts, solarDaily) {
  const priceData = priceParts?.priceData ?? null;
  const cheapestBlock = priceParts?.cheapestBlock ?? null;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const context = {
    current_price: priceData?.current_price ?? null,
    today: priceData?.today ?? null,
    cheapest_window: cheapestBlock
      ? {
          day: localDateKey(new Date(cheapestBlock.start)),
          start_hour: localHourLabel(cheapestBlock.start),
          end_hour: localHourLabel(cheapestBlock.end),
          average_price: cheapestBlock.average_price,
        }
      : null,
  };
  if (tomorrowAvailable) {
    context.tomorrow = {
      available: true,
      average: priceData?.tomorrow?.average ?? null,
      min: priceData?.tomorrow?.min ?? null,
      max: priceData?.tomorrow?.max ?? null,
    };
  } else {
    context.tomorrow_note =
      "Tomorrow's prices are not published yet; they become available " +
      "around 18:00. Do not mention or estimate tomorrow's prices.";
  }
  if (solarDaily) {
    context.solar_today = solarDaily;
  }
  return context;
}

// Detects claims about tomorrow that must not be made while tomorrow's
// prices are unpublished: a sentence mentioning tomorrow that carries a
// specific price figure (with or without a currency marker - models
// drop the "EUR" often), claims a cheapest window for it, or names a
// concrete time window on it. Sentences about tomorrow being not yet
// published are the legitimate exception.
export function claimsTomorrowPrices(text) {
  const pending =
    /not (yet )?(published|available)|pending|becomes? available|become available/i;
  const price =
    /(\beur\b\s?[\d.,]+|€\s?[\d.,]+|[\d.,]+\s?(?:eur|€|\/kwh)|\d+\.\d{2,})/i;
  const windowClaim =
    /cheapest|window|\b\d{1,2}:\d{2}\s*(?:-|to|and)\s*\d{1,2}:\d{2}\b/i;
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (!/tomorrow/i.test(sentence)) {
      continue;
    }
    if (pending.test(sentence)) {
      continue;
    }
    if (price.test(sentence) || windowClaim.test(sentence)) {
      return true;
    }
  }
  return false;
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
      : `EUR ${(Math.round(value * 1000) / 1000).toFixed(3)}/kWh`;
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
      : "Tomorrow's prices are not published yet; they become available around 18:00."
  );
  return sentences.filter(Boolean).join(" ");
}

// "Sat 11 Oct" for a local "YYYY-MM-DD" date key. Parsed and formatted at
// UTC noon so the label never depends on the server's ambient timezone.
function dayLabel(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Compact summary statistics context for the model. weatherDaily and
// priceParts are optional; parts whose source is unavailable are omitted.
// priceParts has the shape returned by getPriceContextData() in prices.mjs.
export function buildSummaryContext(summary, weatherDaily, priceParts) {
  const context = {
    // The wall clock the model must treat as "now": only windows after
    // this moment may be recommended.
    now_local: localIsoWithOffset(new Date()),
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
    // Strictly separated, explicitly dated solar facts. Today never
    // appears in a future series; the multi-day line starts at tomorrow.
    const todayKey = localDateKey(new Date());
    const tomorrowKey = nextDateKey(todayKey, 1);
    // Machine-readable dates for the structured action date fields.
    context.today_date = todayKey;
    context.tomorrow_date = tomorrowKey;
    const todayEntry =
      weatherDaily.find((day) => day.date === todayKey) ?? null;
    const actual = summary?.today?.pv_kwh ?? null;
    const forecast = todayEntry?.estimated_kwh ?? null;
    if (actual !== null && forecast !== null) {
      context.solar_today = `today ${dayLabel(todayKey)}: actual ${actual} kWh, forecast ${forecast} kWh`;
    } else if (forecast !== null) {
      context.solar_today = `today ${dayLabel(todayKey)}: forecast ${forecast} kWh`;
    } else if (actual !== null) {
      context.solar_today = `today ${dayLabel(todayKey)}: actual ${actual} kWh`;
    }
    const tomorrowEntry =
      weatherDaily.find((day) => day.date === tomorrowKey) ?? null;
    if (tomorrowEntry) {
      context.solar_tomorrow = `tomorrow ${dayLabel(tomorrowKey)}: forecast ${tomorrowEntry.estimated_kwh} kWh`;
    }
    const following = weatherDaily.filter((day) => day.date > tomorrowKey);
    if (following.length > 0) {
      context.solar_following_days =
        "following days " +
        following
          .map((day) => `${dayLabel(day.date)} ${day.estimated_kwh} kWh`)
          .join(", ");
    }
  }
  // Whether price rows for tomorrow actually exist (computed by
  // getPriceContextData from the merged curve, local midnight tomorrow
  // onwards). Always a definite boolean: when false, the model must not
  // make any claims about tomorrow's prices, so the tomorrow price
  // section is omitted entirely rather than offered as nulls.
  context.tomorrow_prices_available =
    priceParts?.tomorrowPricesAvailable === true;
  if (priceParts?.priceData) {
    context.current_price = priceParts.priceData.current_price ?? null;
    context.cheapest_window = priceParts.cheapestBlock
      ? {
          day: localDateKey(new Date(priceParts.cheapestBlock.start)),
          start_hour: localHourLabel(priceParts.cheapestBlock.start),
          end_hour: localHourLabel(priceParts.cheapestBlock.end),
          average_price: priceParts.cheapestBlock.average_price,
        }
      : null;
    if (context.tomorrow_prices_available) {
      // Tomorrow's published rows exist; the model may use them.
      context.tomorrow = {
        available: true,
        average: priceParts.priceData.tomorrow?.average ?? null,
        min: priceParts.priceData.tomorrow?.min ?? null,
        max: priceParts.priceData.tomorrow?.max ?? null,
      };
    }
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
    options
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
  // while tomorrow is unpublished, tomorrow price claims are rejected;
  // while today's cheapest window exists, denials of it are rejected.
  // A failure is re-asked once with the corrective instruction; a second
  // failure degrades to the deterministic fallback below, never
  // contradicting the widget.
  const validators = [];
  const correctionNotes = [];
  if (!tomorrowAvailable) {
    validators.push((text) => !claimsTomorrowPrices(text));
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
  return getInsight("battery", BATTERY_SYSTEM_PROMPT, cacheKey, context, options);
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
  return parts.join("|");
}

// Stable hash over the materialized context fields: the bucketed
// signature string above, hashed so /api/summary can expose a compact
// `signature` the kiosk compares against the signature the cached
// insight was generated from.
export function summarySignature(summary, weatherDaily, priceParts) {
  return hashString(buildSummarySignature(summary, weatherDaily, priceParts));
}

// Records one upstream call against the shared daily cap.
function recordApiCall() {
  const utcDay = new Date().toISOString().slice(0, 10);
  callsPerUtcDay.set(utcDay, (callsPerUtcDay.get(utcDay) ?? 0) + 1);
}

// --- Structured daily insight (summary + designed action rows) ---

const ACTION_TYPES = ["appliance", "battery", "ev", "solar", "general"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Validates the structured insight: summary non-empty, at most three
// actions, every field non-empty and well-formed, start before end. The
// actions are normalized (unknown types become "general", prices become
// number or null) and sorted ascending by date and start time. Returns
// null when the payload does not fit the schema.
export function validateStructuredInsight(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) {
    return null;
  }
  const raw = Array.isArray(parsed.actions) ? parsed.actions : [];
  if (raw.length > 3) {
    return null;
  }
  const actions = [];
  for (const action of raw) {
    if (!action || typeof action !== "object") {
      return null;
    }
    const date = String(action.date ?? "");
    const start = String(action.start ?? "");
    const end = String(action.end ?? "");
    const title = String(action.title ?? "").trim();
    const reason = String(action.reason ?? "").trim();
    if (
      !DATE_PATTERN.test(date) ||
      !TIME_PATTERN.test(start) ||
      !TIME_PATTERN.test(end) ||
      !title ||
      !reason
    ) {
      return null;
    }
    if (start >= end) {
      return null;
    }
    actions.push({
      date,
      start,
      end,
      type: ACTION_TYPES.includes(action.type) ? action.type : "general",
      title,
      reason,
      price_eur:
        typeof action.price_eur === "number" && Number.isFinite(action.price_eur)
          ? action.price_eur
          : null,
    });
  }
  actions.sort((a, b) =>
    `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`)
  );
  const oneLiner =
    typeof parsed.one_liner === "string" && parsed.one_liner.trim()
      ? parsed.one_liner
      : null;
  return { oneLiner, summary, actions };
}

// Drops structured actions whose window has already ended relative to the
// given instant (the summary as_of time, so advice for the past is never
// shown). Legacy prose actions pass through unchanged.
export function filterPastActions(actions, asOfMs) {
  return actions.filter((action) => {
    if (
      typeof action?.date !== "string" ||
      typeof action?.end !== "string" ||
      !TIME_PATTERN.test(action.end)
    ) {
      return true; // legacy prose action
    }
    const [hours, minutes] = action.end.split(":").map(Number);
    const endMs =
      localDayStartUtcMs(action.date) + (hours * 60 + minutes) * 60_000;
    return endMs > asOfMs;
  });
}

// The insight must not reference tomorrow's prices while they are
// unpublished (the publication status entity has not confirmed them):
// price claims about tomorrow in the text, or actions dated tomorrow
// that carry a price tag, invalidate the model output.
function insightClaimsUnpublishedTomorrow(validated, priceParts) {
  if (priceParts?.tomorrowPricesAvailable === true) {
    return false;
  }
  const tomorrowKey = nextDateKey(localDateKey(new Date()), 1);
  for (const action of validated.actions) {
    if (action.date === tomorrowKey && action.price_eur !== null) {
      return true;
    }
  }
  const texts = [
    validated.oneLiner,
    validated.summary,
    ...validated.actions.map((action) => `${action.title} ${action.reason}`),
  ];
  return texts.some(
    (text) => typeof text === "string" && claimsTomorrowPrices(text)
  );
}

// Daily summary insight: gated by the context signature. The signature is
// the primary gate - Mistral is called only when it changed since the
// last generated insight, or on force - with the 30-minute minimum
// interval per widget underneath. The cache stores the signature the
// text was generated from and is served until the signature changes.
// When the interval has not expired, the shared daily cap is exhausted
// or generation fails, the previous insight is served with a stale
// marker (fail soft) rather than an unverified text. Concurrent callers
// (the kiosk polls /api/summary from several widgets) join one
// in-flight generation.
let summaryInsightCache = null; // { signature, asOf, result }
let summaryLastCallAt = 0;
let summaryInFlight = null; // { signature, promise }

export async function getSummaryInsight(snapshot, options = {}) {
  const { summary, weatherDaily, priceParts, signature, asOf } = snapshot;
  const force = options.force === true;
  const asOfMs = asOf !== null ? Date.parse(asOf) : Date.now();
  const cached = summaryInsightCache;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const context = buildSummaryContext(summary, weatherDaily, priceParts);
  const reason = force ? "force" : "signature_change";

  // Advice for the past is never shown: the filter runs on every
  // response, including cached ones.
  const serve = (result, stale) => ({
    ...result,
    actions: filterPastActions(result.actions, asOfMs),
    asOf,
    stale,
    error: null,
  });
  const empty = (error) => ({
    oneLiner: null,
    summary: null,
    actions: [],
    generatedAt: null,
    asOf,
    stale: false,
    error,
  });
  const degrade = (error) =>
    cached ? serve(cached.result, true) : empty(error);

  // Cache hit: the cached insight was generated from this exact signature.
  if (!force && cached && cached.signature === signature) {
    return serve(cached.result, false);
  }

  if (summaryInFlight && summaryInFlight.signature === signature) {
    return summaryInFlight.promise;
  }

  const generate = async () => {
    // Force bypasses the 30-minute interval but never the shared daily
    // cap, and still counts.
    if (dailyLimitReached()) {
      logMistral("summary", signature, reason, "skipped_daily_limit");
      return degrade("daily_limit_reached");
    }
    if (!force && Date.now() - summaryLastCallAt < MIN_CALL_INTERVAL_MS) {
      logMistral("summary", signature, reason, "skipped_throttle");
      return degrade("throttled");
    }
    // Context integrity: while tomorrow's prices are unpublished, the
    // output must not claim them.
    const contextOk = (validated) =>
      tomorrowAvailable || !insightClaimsUnpublishedTomorrow(validated, priceParts);

    // Structured output first; retried once on invalid JSON or an
    // integrity failure, then a single prose fallback call so the
    // dashboard never breaks. Every attempt counts against the shared
    // daily cap.
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      if (dailyLimitReached()) {
        logMistral("summary", signature, reason, "skipped_daily_limit");
        return degrade("daily_limit_reached");
      }
      summaryLastCallAt = Date.now();
      recordApiCall();
      try {
        const text = await callMistral(SUMMARY_SYSTEM_PROMPT_STRUCTURED, context);
        const validated = validateStructuredInsight(parseInsightJson(text));
        if (!validated) {
          throw new Error("model returned invalid structured JSON");
        }
        if (!contextOk(validated)) {
          throw new Error(
            "model referenced tomorrow's unpublished prices"
          );
        }
        logMistral("summary", signature, reason, "ok");
        result = {
          oneLiner: validated.oneLiner,
          summary: validated.summary,
          actions: validated.actions,
          generatedAt: new Date().toISOString(),
        };
      } catch (err) {
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
        // Retried on the next loop iteration, prose fallback after it.
        // The reason is logged so schema misses stay diagnosable.
        console.warn(
          `Structured insight validation failed: ${err?.message ?? err}`
        );
      }
    }
    if (!result && !dailyLimitReached()) {
      summaryLastCallAt = Date.now();
      recordApiCall();
      try {
        const text = await callMistral(SUMMARY_SYSTEM_PROMPT_PROSE, context);
        const parsed = parseInsightJson(text);
        if (!parsed || typeof parsed.summary !== "string") {
          throw new Error("model returned invalid JSON");
        }
        if (
          !tomorrowAvailable &&
          claimsTomorrowPrices(
            `${parsed.one_liner ?? ""} ${parsed.summary}`
          )
        ) {
          throw new Error("model referenced tomorrow's unpublished prices");
        }
        const actions = Array.isArray(parsed.actions)
          ? parsed.actions
              .filter((action) => action && typeof action.text === "string")
              .slice(0, 3)
              .map((action) => ({
                text: action.text,
                window: typeof action.window === "string" ? action.window : "",
                reason: typeof action.reason === "string" ? action.reason : "",
              }))
          : [];
        logMistral("summary", signature, reason, "ok");
        result = {
          oneLiner:
            typeof parsed.one_liner === "string" ? parsed.one_liner : null,
          summary: parsed.summary,
          actions,
          generatedAt: new Date().toISOString(),
        };
      } catch (err) {
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
      }
    }
    if (!result) {
      return degrade("ai_unavailable");
    }

    summaryInsightCache = { signature, asOf, result };
    return serve(result, false);
  };

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
