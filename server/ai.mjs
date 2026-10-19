// AI insights for the dashboard widgets: compact context builders for the
// weather and prices widgets, a shared Mistral client with per-insight
// response caching, a per-insight 30-minute upstream throttle and one shared
// daily call cap. The API key is read from the environment and never
// logged.

import {
  localDateKey,
  localHourKey,
  localHourIndex,
  localHourLabel,
  localIsoWithOffset,
  nextDateKey,
} from "./time.mjs";
import { checkAdvisory, logCheckerVerdict } from "./checker.mjs";
import { PRACTICAL_MIN_ADVANTAGE_EUR } from "./advisory-constants.mjs";

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

// Primary prompt: the model returns structured actions the frontend
// renders as designed rows (day chip, window, icon, title, reason,
// price). A window without a date is invalid.
// Decision-focused daily insight: one primary action with an estimated
// euro saving, at most three supporting facts and an optional warning.
// The server computes the candidate actions with exact arithmetic; the
// model only selects and phrases. The rules the model must enforce live
// in the prompt itself: select from candidates, copy savings verbatim,
// no arithmetic anywhere in the output, under 25 words, English, no
// preamble.
// Exported for the read-only insight debug endpoint: the exact prompt
// the summary insight is generated with, so the model's input stays
// traceable.
export const SUMMARY_SYSTEM_PROMPT_STRUCTURED = `You are the decision assistant of a home energy dashboard in the Netherlands with solar panels, a home battery and a dynamic electricity contract. The context carries usage, solar, battery, appliance, price, CO2 and candidate_actions data. Reply with JSON only, no preamble, no markdown fences, in English, with exactly these keys.

Schema: { "primaryAction": { "what": string (one concrete imperative recommendation), "when": string (the selected candidate's window), "savingEur": number (copied verbatim from the selected candidate; 0 only when candidates is empty), "confidence": "high" | "medium" | "low" }, "supportingFacts": [], "warning": string or null, "contextNote": string or null }. You write only these fields; the card renders every other row from server-computed data.

Action: you never compute; the server has done all arithmetic. Select the candidate with the largest saving_eur among those whose below_threshold is false; copy its saving_eur verbatim and its window into "when". If every candidate is below_threshold, state honestly that no meaningful saving is available today and name the largest real opportunity with its true amount copied from that candidate. If candidates is empty, the action is the plain honest statement that nothing is worth taking today, for example "No action worth taking today" - set savingEur to 0. Never phrase the empty case as deferral advice such as "Wait for tomorrow". savingEur is only ever a candidate's saving.

Voice: phrase "what" as a household instruction addressing the user directly, in appliance classes - for example "Run your large appliances between 12:00 and 15:00" - never a specific appliance name. Use exactly one "today" per sentence and state the benefit in it. Never use operator abstractions like "heavy loads", "plan usage", "defer consumption". Never duplicate timing guidance or day comparisons in your fields; the card renders those rows itself.

Honesty: every number you state must appear in the context - never multiply, divide or derive. No raw formulas or arithmetic expressions anywhere in the output. Only recommend windows in the future relative to now_local. Distinguish actual production from forecast. Only tomorrow's grid price is published: never state a price for a day beyond tomorrow, and when a day's price is null, no number may stand in for it. When tomorrow_prices_available is false, do not mention tomorrow at all; base advice only on today's prices, remaining hours, solar and battery state. When data for a period is unavailable, make no claims about that period. Weigh cheap hours, green hours (co2_intensity_g_per_kwh) and own solar production. Grounded facts: the card states today's lowest and peak price with their hours and the battery's exact charge and state itself, from server-computed fields. Never name today's lowest or peak price or their hours in your own words, and never state the battery's charge level or whether it is charging, discharging or idle - reference the battery only abstractly as "the battery", never with phrases like "fully charged", "empty", "idle" or a percentage.

Warning and context: "warning" is only for something that needs attention and implies what to check or do, for example "The battery needs attention before tonight's peak; check its settings". "contextNote" is written only on quiet days - one coherent sentence about the home explaining why no candidate exists, for example "No appliance used enough power today to make shifting worthwhile" - or for a genuine insight the rows do not carry, such as the battery's own evening hours reducing the value of shifting usage. When a real action is selected, contextNote is null: the action's basis line explains it, and the note never restates the action's numbers, appliance names or windows.

Plain language: user-facing text never contains internal system vocabulary - candidates, threshold, belowThreshold, payload, context, insight, budget, signature, mechanism. If something cannot be expressed in home terms, omit it. supportingFacts is always an empty array. "confidence" is high when the selected candidate is above threshold, medium or low when below_threshold or the data is thin. Name appliances only with the labels in candidates and the names in top_appliances. The primaryAction (what plus when) stays under 25 words.`;

// The decision prompt as one clean document with sections: schema,
// action, voice, honesty, warning/context, plain language.

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

// A NaN or Infinity in an answer is always a model artifact: the
// context never carries one (JSON renders missing numbers as null),
// so an answer containing either is invalid - the model tried to
// state a value the context does not have.
export function containsNonFiniteText(text) {
  return /\b(?:nan|infinity)\b/i.test(text ?? "");
}

// Detects battery-state claims the model must not make: the card
// states the battery's exact charge and state from the server-computed
// facts, so the model may reference the battery only abstractly. A
// sentence that names the battery together with a state word (fully
// charged, charging, discharging, idle, empty, full) or a percentage
// claim is a state claim in the model's own words.
export function claimsBatteryState(text) {
  if (typeof text !== "string" || !/batter/i.test(text)) {
    return false;
  }
  const stateClaim =
    /\b(?:fully\s+)?(?:charg(?:e|ed|es|ing)|discharg\w+|idle|empty|full)\b/i;
  const socClaim = /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent\b|pct\b)/i;
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /batter/i.test(sentence))
    .some((sentence) => stateClaim.test(sentence) || socClaim.test(sentence));
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

// Compact decision context for the model. weatherDaily and priceParts
// are optional; extras carries today's top appliances and the live CO2
// intensity; parts whose source is unavailable are omitted. priceParts
// has the shape returned by getPriceContextData() in prices.mjs.
export function buildSummaryContext(summary, weatherDaily, priceParts, extras) {
  const extrasSafe = extras ?? {};
  // Self-sufficiency: the share of today's household usage covered by
  // own production (the complement of grid dependence), (usage -
  // import) / usage. Null without usage.
  const usageKwh = summary?.today?.total_usage_kwh ?? null;
  const importKwh = summary?.today?.import_kwh ?? null;
  const selfSufficiencyPct =
    usageKwh !== null && usageKwh > 0 && importKwh !== null
      ? Math.round((Math.max(0, usageKwh - importKwh) / usageKwh) * 1000) / 10
      : null;
  const context = {
    // The wall clock the model must treat as "now": only windows after
    // this moment may be recommended.
    now_local: localIsoWithOffset(new Date()),
    today: {
      net_usage_kwh: importKwh,
      total_usage_kwh: usageKwh,
      back_delivery_kwh: summary?.today?.export_kwh ?? null,
      // Bottom-up: the sum of hourly import kWh times the hourly price
      // (computed in getRangeMetrics). Export revenue is omitted: no
      // hourly feed-in tariff exists in the data.
      import_cost_eur: summary?.today?.cost_eur ?? null,
      // Share of today's solar used on site; null while production is
      // zero (before sunrise).
      self_consumption_pct: summary?.today?.self_consumption_pct ?? null,
      self_sufficiency_pct: selfSufficiencyPct,
    },
    week_cost_eur: summary?.week?.cost_eur ?? null,
    month_cost_eur: summary?.month?.cost_eur ?? null,
  };
  // Today's top appliances by kWh, for grounded recommendations.
  if (extrasSafe.topAppliances?.length > 0) {
    context.top_appliances = extrasSafe.topAppliances.map((row) => ({
      name: row.appliance,
      kwh: row.kwh,
    }));
  }
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
    // Today's price statistics with the hours above the peak threshold.
    context.today_prices = {
      min: priceParts.priceData.today?.min ?? null,
      average: priceParts.priceData.today?.average ?? null,
      max: priceParts.priceData.today?.max ?? null,
      peak_hours: priceParts.peakHours?.today ?? [],
    };
    context.price_peak_threshold_eur = priceParts.peakThresholdEur ?? null;
    if (context.tomorrow_prices_available) {
      // Tomorrow's published rows exist; the model may use them.
      context.tomorrow_prices = {
        available: true,
        average: priceParts.priceData.tomorrow?.average ?? null,
        min: priceParts.priceData.tomorrow?.min ?? null,
        max: priceParts.priceData.tomorrow?.max ?? null,
        peak_hours: priceParts.peakHours?.tomorrow ?? [],
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
  // Live grid CO2 intensity, so the model can weigh green hours
  // alongside cheap hours. Omitted entirely when unreachable.
  if (
    extrasSafe.co2Intensity !== null &&
    extrasSafe.co2Intensity !== undefined
  ) {
    context.co2_intensity_g_per_kwh = extrasSafe.co2Intensity;
  }
  // Precomputed candidate actions with exact arithmetic: the model
  // selects and phrases, it never computes. Always an array, possibly
  // empty, so the model knows when no opportunity exists.
  context.candidates = Array.isArray(extrasSafe.candidates)
    ? extrasSafe.candidates
    : [];
  // The guidance, advisory and week outlook objects never reach the
  // model: the payload serves them from the live snapshot extras at
  // request time, and the card renders their rows from its own
  // templates. Only the summary-level solar and price facts above stay
  // in the model context, because the context note and the warning
  // reference them.
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
    {
      ...options,
      validate: (text) => !containsNonFiniteText(text),
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
  const validators = [(text) => !containsNonFiniteText(text)];
  const correctionNotes = [
    "Never print NaN or Infinity; omit any value that is missing " +
      "from the context instead of inventing it.",
  ];
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
  return getInsight("battery", BATTERY_SYSTEM_PROMPT, cacheKey, context, {
    ...options,
    validate: (text) => !containsNonFiniteText(text),
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

// --- Decision insight (primaryAction + supporting facts + warning) ---

const CONFIDENCE_LEVELS = ["high", "medium", "low"];

// Arithmetic expressions must never appear in user-facing text: digit
// times digit (also "x" and "×"), or a parenthesised subtraction or
// addition of two numbers - the shapes the model used to leak raw
// formulas like "0.01 kWh x (0.279678 - 0.267126)".
const ARITHMETIC_PATTERN =
  /\d\s*[x\u00d7*]\s*[\d.(]|\(\s*[\d.]+\s*[-+]\s*[\d.]+\s*\)/;

// Number or numeric string ("0.42") - models drift between the two;
// both normalize to a number, anything else is null.
function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

// The deterministic lines served with the guidance and advisory
// objects: the model never writes them, the card renders the rows
// from the fields, and these lines ride the payload for consumers
// that want a sentence (the debug view). The routes call them with
// the live snapshot extras at request time.
export function composeGuidanceLine(g) {
  // The C17 evening-window gate: an evening window (at or after the
  // evening pivot, e.g. 21:00-00:00) whose expected benefit against
  // the day's average sits below the practicality threshold is
  // demoted to plain-fact voice - no imperative wording below the
  // minimum benefit worth acting on, and never the 0.03 minimum
  // detectable spread. The benefit is the honest live reference
  // computed in buildGuidance from the actual curve; an evening
  // window without a computable benefit never commands either.
  if (
    g.evening_window &&
    (g.expected_benefit_eur === null ||
      g.expected_benefit_eur < PRACTICAL_MIN_ADVANTAGE_EUR)
  ) {
    const hours = g.window.replace(" today", "").replace("-", " and ");
    return g.expected_benefit_eur !== null && g.expected_benefit_eur > 0
      ? `Prices are low between ${hours} (${eurFactText(
          g.expected_benefit_eur
        )} below average).`
      : `The cheapest remaining window today is ${g.window} at ${eurFactText(
          g.cheapest_window_average_eur
        )} average.`;
  }
  return `Cheapest remaining window today is ${g.window} at ${g.cheapest_window_average_eur} average; running heavy appliances then instead of the ${g.peak_hour} peak saves about ${g.spread_per_kwh_eur} per kWh.`;
}

// The solar narrative branches at a 20 percent swing either way:
// within it the expected solar reads as "about the same" - a smaller
// difference is noise in the forecast, not a meaning worth stating.
const NARRATIVE_SOLAR_FACTOR = 0.2;

// Capitalizes the first letter of a composed sentence; shared with
// the context builder's outlook lines.
export function capSentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The price half of the Tomorrow narrative: cheaper, pricier or
// similar against the compare day, derived from the computed figures
// and stated at the minimum benefit worth acting on - never the
// minimum detectable spread. Null when either average is missing
// (the clause is then omitted entirely, never guessed).
function advisoryPriceClause(a) {
  if (a.tomorrow_average_eur === null || a.compare_average_eur === null) {
    return null;
  }
  const diff =
    Math.round((a.tomorrow_average_eur - a.compare_average_eur) * 10_000) /
    10_000;
  const referent = a.compare_day === "today" ? "today" : `on ${a.compare_day}`;
  if (diff <= -PRACTICAL_MIN_ADVANTAGE_EUR) {
    return `grid power should cost you less than ${referent}`;
  }
  if (diff >= PRACTICAL_MIN_ADVANTAGE_EUR) {
    return `grid power will cost you more than ${referent}`;
  }
  return `grid power should cost about the same as ${referent}`;
}

// The solar half of the Tomorrow narrative: more, less or similar
// solar against the compare day, or the low-solar meaning (grid
// reliance) when the score flags it. The trailing form joins a price
// clause; the lead form stands alone when prices are unavailable.
// Null when no honest comparison exists.
function advisorySolarClause(a) {
  if (a.tomorrow_solar_kwh === null) {
    return null;
  }
  if (a.tomorrow_low_solar === true) {
    return {
      trailing: "with little sun expected",
      lead: "Little sun is expected - you'll lean mostly on grid power",
    };
  }
  const compare = a.compare_solar_kwh;
  if (compare === null || compare <= 0) {
    return null;
  }
  const referent = a.compare_day === "today" ? "today" : `on ${a.compare_day}`;
  // The trailing form rides a price clause that already names the
  // compare day, so the "today" referent is left implicit.
  const trailingReferent = a.compare_day === "today" ? "" : ` than ${referent}`;
  if (a.tomorrow_solar_kwh >= compare * (1 + NARRATIVE_SOLAR_FACTOR)) {
    return {
      trailing: `with more of your own solar${trailingReferent}`,
      lead: `More of your own solar is expected than ${referent}`,
    };
  }
  if (a.tomorrow_solar_kwh <= compare * (1 - NARRATIVE_SOLAR_FACTOR)) {
    return {
      trailing: `with less of your own solar${trailingReferent}`,
      lead: `Less of your own solar is expected than ${referent}`,
    };
  }
  return {
    trailing: `with about as much of your own solar${trailingReferent}`,
    lead: `Your own solar should come in about the same as ${referent}`,
  };
}

// The Tomorrow description: one short narrative sentence about what
// the figures MEAN - cheaper or pricier, more or less solar - in
// household voice. It complements the card's subtext, which carries
// the exact comparison, so it never restates the figures; and it never
// opens by restating the card title ("Tomorrow"). Deterministically
// composed from the computed figures, one writer on the server; were
// it ever model-generated it would have to pass the advisory
// integrity checker and state only figures matching the computed
// values. A missing figure omits its clause, and with nothing to say
// the line is null - the card then falls back to its own composer,
// never a guess.
export function composeAdvisoryLine(a) {
  const price = advisoryPriceClause(a);
  const solar = advisorySolarClause(a);
  if (price !== null && solar !== null) {
    return `${capSentence(price)}, ${solar.trailing}.`;
  }
  if (price !== null) {
    return `${capSentence(price)}.`;
  }
  if (solar !== null) {
    return `${capSentence(solar.lead)}.`;
  }
  return null;
}

// The deterministic price sentence over the grounding facts: the
// template names today's lowest and peak price, each with its own
// timestamp, composed straight from the served fields so the low can
// never pair with the peak's hour or price. The model never writes
// this sentence. Both halves must exist; when the price data is
// missing the sentence is omitted entirely - never approximated.
export function composePriceSentence(facts) {
  const low = facts?.lowPrice ?? null;
  const peak = facts?.peakPrice ?? null;
  if (low === null || peak === null) {
    return null;
  }
  return `Lowest price around ${low.timestamp} (${eurFactText(
    low.price
  )}); peak around ${peak.timestamp} (${eurFactText(peak.price)}).`;
}

// The deterministic battery sentence: the template states the SOC and
// the state verbatim from the context values; the model may only
// reference the battery abstractly. Null when the battery data is
// missing, so the sentence is omitted entirely.
export function composeBatterySentence(facts) {
  const battery = facts?.battery ?? null;
  if (battery === null) {
    return null;
  }
  return `The battery is at ${battery.soc_pct}% and is ${battery.state}.`;
}

// Pinned money precision for the fact sentences: two decimals whenever
// the value is nonzero at two decimals, more only when two would show
// 0.00 - a nonzero price never renders as EUR 0.00.
function eurFactText(value) {
  const two = value.toFixed(2);
  if (Number(two) !== 0) {
    return `EUR ${two}`;
  }
  return `EUR ${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// The saving guard: the claimed saving must match a candidate's exact
// value. Zero is legitimate in the two honest no-opportunity cases
// (C3 rule a): no candidates at all, or every candidate below
// threshold with the plain no-action statement. A zero claim with an
// above-threshold candidate present is invalid - the model missed a
// real saving. Exported as a pure function so the test suite pins the
// boundaries.
export function savingMatchesCandidate(savingEur, candidates) {
  if (candidates.length === 0) {
    return savingEur === 0;
  }
  if (savingEur === 0 && candidates.every((c) => c.below_threshold === true)) {
    return true;
  }
  return candidates.some(
    (candidate) => Math.abs(candidate.saving_eur - savingEur) < 0.005
  );
}

// Validates the decision insight: a primary action with non-empty
// what and when, a finite saving and a known confidence level, an
// empty supporting facts array, an optional warning and an optional
// context note. The guidance, advisory and outlook objects never pass
// through the model: the server serves them from its own context, so
// the model output carries only the fields it actually writes.
// Returns null when the payload does not fit the schema.
export function validateDecisionInsight(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const raw = parsed.primaryAction;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const what = typeof raw.what === "string" ? raw.what.trim() : "";
  // The window may be legitimately empty: with no candidate there is
  // no window to name, and the honest no-opportunity action carries
  // only the what.
  const when = typeof raw.when === "string" ? raw.when.trim() : "";
  // The saving may arrive as a number or a numeric string ("0",
  // "0.42") - models drift between the two; both are accepted and
  // normalized so the verbatim check works either way.
  const savingRaw = raw.savingEur;
  const savingEur = asFiniteNumber(savingRaw);
  const confidence =
    typeof raw.confidence === "string"
      ? raw.confidence.trim().toLowerCase()
      : "";
  if (!what || savingEur === null) {
    return null;
  }
  // The model occasionally drops the confidence field on the trivial
  // no-opportunity answer; defaulting to the conservative "medium"
  // keeps that payload valid instead of paying a second call for a
  // missing style label.
  const confidenceSafe = CONFIDENCE_LEVELS.includes(confidence)
    ? confidence
    : "medium";
  // The card renders rows and the single context note; any additional
  // fact would duplicate them and reopen the fabrication surface, so
  // a non-empty facts array is invalid.
  if (
    Array.isArray(parsed.supportingFacts) &&
    parsed.supportingFacts.length > 0
  ) {
    return null;
  }
  const supportingFacts = [];
  const warning =
    typeof parsed.warning === "string" && parsed.warning.trim()
      ? parsed.warning.trim()
      : null;
  // Explanatory context (why no candidates exist) - a muted footnote,
  // never a warning.
  const contextNote =
    typeof parsed.contextNote === "string" && parsed.contextNote.trim()
      ? parsed.contextNote.trim()
      : null;
  return {
    what,
    when,
    savingEur,
    confidence: confidenceSafe,
    supportingFacts,
    warning,
    contextNote,
  };
}

// The insight must not reference tomorrow's prices while they are
// unpublished (the publication status entity has not confirmed them):
// any price claim about tomorrow in the decision text invalidates the
// model output.
function insightClaimsUnpublishedTomorrow(validated, priceParts) {
  if (priceParts?.tomorrowPricesAvailable === true) {
    return false;
  }
  const texts = [
    validated.primaryAction?.what,
    validated.primaryAction?.when,
    ...(validated.supportingFacts ?? []),
    validated.warning,
  ];
  return texts.some(
    (text) => typeof text === "string" && claimsTomorrowPrices(text)
  );
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
// or budget logic runs. Serves the insight debug endpoint's verbatim
// saving comparison against the current context's candidates. The
// guidance, advisory and outlook objects are not part of the cached
// insight - the debug route serves them from the live snapshot extras,
// exactly as the summary route does. The regeneration state is
// computed against the live signature passed in: "fresh" when the
// cached insight matches it, otherwise "reasoning" (the next request
// warms the new signature up).
export function peekSummaryInsight(liveSignature = null) {
  const cached = summaryInsightCache;
  if (!cached) {
    return null;
  }
  const primaryAction = cached.result.primaryAction ?? null;
  return {
    signature: cached.signature,
    as_of: cached.asOf,
    state:
      liveSignature !== null && cached.signature === liveSignature
        ? "fresh"
        : "reasoning",
    no_opportunity: cached.result.noOpportunity ?? false,
    context_note: cached.result.contextNote ?? null,
    candidates: cached.result.candidates ?? [],
    primary_action: primaryAction
      ? {
          what: primaryAction.what,
          when: primaryAction.when,
          saving_eur: primaryAction.savingEur,
          confidence: primaryAction.confidence,
        }
      : null,
  };
}

export async function getSummaryInsight(snapshot, options = {}) {
  const { summary, weatherDaily, priceParts, extras, signature, asOf } =
    snapshot;
  const force = options.force === true;
  // Request-driven warm-up: answer from the cache immediately and let a
  // signature change regenerate in the background. Never combined with
  // force, which keeps its synchronous behavior.
  const background = options.background === true && !force;
  const cached = summaryInsightCache;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const context = buildSummaryContext(
    summary,
    weatherDaily,
    priceParts,
    extras
  );
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
    primaryAction: null,
    supportingFacts: [],
    warning: null,
    contextNote: null,
    noOpportunity: false,
    candidates: [],
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
    // Context integrity: while tomorrow's prices are unpublished, the
    // output must not claim them. The saving must be copied verbatim
    // from a candidate (0 only when no candidate exists), and the
    // user-facing text must carry no arithmetic expressions - both
    // enforced server-side so the model can never pass off its own
    // arithmetic as data.
    const savingsOk = (validated) =>
      savingMatchesCandidate(validated.savingEur, context.candidates ?? []);
    const textsOf = (validated) => [
      validated.what,
      validated.when,
      ...validated.supportingFacts,
      validated.warning ?? "",
    ];
    const noFormulas = (validated) =>
      !textsOf(validated).some((text) => ARITHMETIC_PATTERN.test(text ?? ""));

    // Plain language: user-facing text never contains internal
    // system vocabulary; anything that cannot be said in home terms
    // is omitted, so a leak invalidates the output.
    const plainLanguageOk = (validated) =>
      !textsOf(validated).some((text) =>
        /candidates|belowThreshold|threshold|payload|\bbudget\b|signature|mechanism/i.test(
          text ?? ""
        )
      );
    // Battery grounding: the card states the battery's exact charge and
    // state from the server-computed facts, so a battery-state claim in
    // the model's own words - in any field, the context note included -
    // invalidates the output.
    const batteryStateFree = (validated) =>
      ![
        validated.what,
        validated.when,
        ...validated.supportingFacts,
        validated.warning ?? "",
        validated.contextNote ?? "",
      ].some((text) => claimsBatteryState(text));
    // Price honesty: no user-facing text may state a grid price for a
    // day beyond tomorrow - those prices are unpublished. A sentence
    // naming such a weekday together with a price claim is invalid.
    // The weekday names come from the live outlook extras: the model
    // context carries the solar forecast labels, and the check guards
    // the text the model writes against them.
    const beyondTomorrowWeekdays = (extras?.outlook?.days ?? [])
      .slice(1)
      .map((day) => day.weekday);
    const priceHonestyOk = (validated) =>
      !textsOf(validated).some((text) => {
        if (typeof text !== "string") {
          return false;
        }
        return text.split(/(?<=[.!?])\s+/).some((sentence) => {
          const namesDay = beyondTomorrowWeekdays.some((weekday) =>
            sentence.includes(weekday)
          );
          const claimsPrice =
            /averag|\bEUR\b|\u20ac/.test(sentence) && /\d\.\d/.test(sentence);
          return namesDay && claimsPrice;
        });
      });

    // Every integrity check with its failure reason, so the log names
    // the actual failure instead of a generic guess.
    const integrityChecks = (validated) => [
      [
        tomorrowAvailable ||
          !insightClaimsUnpublishedTomorrow(validated, priceParts),
        "model referenced tomorrow's unpublished prices",
      ],
      [savingsOk(validated), "saving does not match a candidate"],
      [noFormulas(validated), "arithmetic expression in output"],
      [plainLanguageOk(validated), "internal vocabulary in output"],
      [priceHonestyOk(validated), "price claimed for an unpublished day"],
      [batteryStateFree(validated), "battery state claim in output"],
      [
        !textsOf(validated).some((text) => containsNonFiniteText(text)),
        "NaN or Infinity in output",
      ],
    ];
    const integrityFailure = (validated) =>
      integrityChecks(validated).find(([ok]) => !ok)?.[1] ?? null;

    // Strict decision JSON; one retry on invalid JSON or an integrity
    // failure, then the previous insight stays in place (fail soft).
    // Every attempt counts against the shared daily cap.
    let validated = null;
    let lastFailureWasChecker = false;
    for (let attempt = 0; attempt < 2 && !validated; attempt++) {
      if (dailyLimitReached()) {
        logMistral("summary", signature, reason, "skipped_daily_limit");
        return degrade("daily_limit_reached");
      }
      summaryLastCallAt = Date.now();
      recordApiCall();
      // The raw text stays in scope so a validation failure can log a
      // short excerpt - the fastest way to see what shape the model
      // drifted to. The prompt, context and API key are never logged.
      let text = "";
      try {
        text = await callMistral(
          SUMMARY_SYSTEM_PROMPT_STRUCTURED,
          context
        );
        const candidate = validateDecisionInsight(parseInsightJson(text));
        if (!candidate) {
          throw new Error("model returned invalid decision JSON");
        }
        const failure = integrityFailure(candidate);
        if (failure !== null) {
          throw new Error(failure);
        }
        // The advisory integrity checker: the generated narrative is
        // verified against the grounding facts before it is served -
        // every price-plus-hour pair against the day's curve, every
        // battery-state claim against the context battery values. A
        // rejection regenerates once; a second failure serves the
        // deterministic core facts alone. Never a mismatched advisory.
        const verdict = checkAdvisory(
          {
            what: candidate.what,
            when: candidate.when,
            warning: candidate.warning,
            contextNote: candidate.contextNote,
          },
          extras?.facts ?? null
        );
        logCheckerVerdict(verdict);
        if (!verdict.ok) {
          throw new Error(`advisory checker: ${verdict.reason}`);
        }
        validated = candidate;
        logMistral("summary", signature, reason, "ok");
      } catch (err) {
        lastFailureWasChecker = String(err?.message ?? "").startsWith(
          "advisory checker:"
        );
        logMistral("summary", signature, reason, `error:${shortError(err)}`);
        // Retried on the next loop iteration; after it the previous
        // insight stays. The reason is logged so schema misses stay
        // diagnosable.
        console.warn(
          `Decision insight validation failed: ${err?.message ?? err}; raw: ${text.slice(0, 200)}`
        );
      }
    }
    if (!validated) {
      // Both generations failed the integrity checker: the
      // deterministic core facts alone are served - the price and
      // battery sentences composed by the templates, which ride the
      // payload from the live snapshot extras - without the model's
      // narrative. Cached for this signature so the polls do not
      // hammer the model; the next signature change retries.
      if (lastFailureWasChecker) {
        logMistral("summary", signature, reason, "checker_core_only");
        const coreResult = {
          primaryAction: null,
          supportingFacts: [],
          warning: null,
          contextNote: null,
          noOpportunity: false,
          candidates: context.candidates ?? [],
          generatedAt: null,
        };
        summaryInsightCache = { signature, asOf, result: coreResult };
        summaryWarmupError = null;
        return serve(coreResult, "fresh");
      }
      return degrade("ai_unavailable");
    }

    const result = {
      primaryAction: {
        what: validated.what,
        when: validated.when,
        savingEur: validated.savingEur,
        confidence: validated.confidence,
      },
      supportingFacts: validated.supportingFacts,
      warning: validated.warning,
      contextNote: validated.contextNote,
      // The honest no-opportunity signal, derived from the candidates
      // rather than the model's phrasing: true when every candidate is
      // belowThreshold or none exists. The card then omits the
      // highlighted saving and names the largest real opportunity.
      noOpportunity: (context.candidates ?? []).every(
        (candidate) => candidate.below_threshold === true
      ),
      candidates: context.candidates ?? [],
      generatedAt: new Date().toISOString(),
    };

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

  // Synchronous callers (force, or the legacy insight routes) join a
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
