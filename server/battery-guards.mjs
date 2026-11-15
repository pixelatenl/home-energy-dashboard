// The battery context box guards, following weather-guards.mjs in
// structure. The battery box is a context box like the weather box: it
// states the charge state and today's use as plain facts and never
// advises - what to do remains the hub advisory's job. Unlike the
// weather box, this context DOES serve price facts, so prices may be
// stated as plain facts, but only exactly as served, never computed or
// converted. Each guard is a pure function over the model-authored text
// plus only the served context it needs, and returns { ok, problems }
// with human-readable rejection reasons. No IO, no Date.now(), no
// environment reads.

import { guardNonFiniteText } from "./advisory/narrative-guards.mjs";

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// Guard 1: the appliance-advice ban, the same rule as the weather box:
// any mention of an appliance (appliances, washing machine, dishwasher,
// dryer) rejects, and so does any run/start/plan imperative about
// energy use in the same sentence.
const APPLIANCE_RE =
  /\b(?:appliances?|washing\s+machines?|dishwashers?|dryers?|tumble\s+dryers?|laundry)\b/i;
const ENERGY_USE_RE =
  /\b(?:energy|electricity|power|usage|consumption|appliance|machine|load|laundry|washer|dishwasher|dryer)\b/i;
const RUN_PLAN_IMPERATIVE_RE =
  /\b(?:run|start|plan|schedule|time|shift|turn\s+on|switch\s+on|put\s+on|programme|program)\b/i;

export function guardNoApplianceAdvice(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const appliance = APPLIANCE_RE.exec(sentence);
    if (appliance !== null) {
      problems.push(
        `mentions "${appliance[0]}" - this box never advises on appliances or energy use`
      );
      continue;
    }
    const imperative = RUN_PLAN_IMPERATIVE_RE.exec(sentence);
    if (imperative !== null && ENERGY_USE_RE.test(sentence)) {
      problems.push(
        `gives a run/start/plan imperative about energy use ("${imperative[0]}") - this box never advises`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 2: the battery-advice ban. Any recommendation marker (should,
// could, consider, recommend, tip, advice, worth, make sure, aim, try,
// best to, ensure, avoid, prefer) rejects, and so does any imperative
// sentence that instructs battery operation ("Charge the battery...",
// "Discharge now..."). Descriptive past or present tense ("charged
// 4.2 kWh today", "is charging at 800 W") carries no marker and no
// imperative and passes.
const RECOMMENDATION_MARKER_RE =
  /\b(?:should|could|consider|recommend\w*|tip|advice|advise\w*|worth|make\s+sure|aim|try|best\s+to|ensure|avoid|prefer\w*)\b/i;
const BATTERY_OP_START_RE =
  /^\s*(?:please\s+)?(?:charge|discharge|recharge|top\s+up|stop\s+charging|start\s+charging)\b/i;
const BATTERY_OP_OBJECT_RE =
  /\b(?:charge|discharge|recharge)\s+(?:the\s+|your\s+)?battery\b/i;

export function guardNoBatteryAdvice(text) {
  const problems = [];
  for (const sentence of splitSentences(text)) {
    const marker = RECOMMENDATION_MARKER_RE.exec(sentence);
    if (marker !== null) {
      problems.push(
        `gives a recommendation ("${marker[0]}") - this box states facts only, no advice`
      );
    }
    const operation = BATTERY_OP_START_RE.exec(sentence) ?? BATTERY_OP_OBJECT_RE.exec(sentence);
    if (operation !== null) {
      problems.push(
        `instructs battery operation ("${operation[0]}") - this box never advises on charging or discharging`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

// Guard 3: the band-consistency guard, the same logic as the weather
// box but evaluated over the served solar_forecast bands. The served
// per-day band labels (solarScoreBand in advisory-constants.mjs) carry
// the meaning of a score, so a positive evaluative claim is grounded
// only when at least one served day has band "good". The band
// vocabulary itself ("little sun", "moderate", "good") is allowed
// exactly as served.
const POSITIVE_EVALUATIVE_RE =
  /\b(?:very|really|pretty|extremely)\s+(?:good|great|excellent|strong)\b|\b(?:good|great|excellent|strong|fantastic|amazing|superb|brilliant|wonderful|awesome)\b/gi;

export function guardBandConsistency(text, context) {
  const problems = [];
  const forecast = Array.isArray(context?.solar_forecast)
    ? context.solar_forecast
    : [];
  const anyGoodDay = forecast.some((day) => day?.solar_band === "good");
  if (anyGoodDay) return { ok: true, problems };
  const seen = new Set();
  for (const match of String(text ?? "").matchAll(POSITIVE_EVALUATIVE_RE)) {
    const phrase = match[0];
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(
      `uses the positive evaluative phrase "${phrase}" while no served day has band "good"; use the served band labels only`
    );
  }
  return { ok: problems.length === 0, problems };
}

// Guard 4: the figure-grounding guard. This context serves price facts,
// so a monetary amount is allowed only when it matches a served price
// value (current_price or cheapest_window.average_price) exactly as
// served; a kWh figure only when it matches a served kWh value (today,
// week or month in and out, or a flow_hourly entry). Power is served in
// watts only, so any power mention in kW (never kWh) rejects: the
// model must not convert units. Display tolerance is half a unit at
// the served two-decimal display, the same tolerance the advisory
// guards use.
const FIGURE_TOLERANCE = 0.005;
const FLOAT_GUARD = 1e-9;

function parseFigure(raw) {
  // A sentence-ending period rides along in the captured digits
  // ("€0.24."), and a decimal comma is normalized to a point.
  return Number(String(raw).replace(",", ".").replace(/\.+$/, ""));
}

function finiteNumbers(values) {
  return values.filter(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
}

function servedPriceValues(context) {
  return finiteNumbers([
    context?.current_price,
    context?.cheapest_window?.average_price,
  ]);
}

function servedKwhValues(context) {
  const flow = Array.isArray(context?.flow_hourly) ? context.flow_hourly : [];
  return finiteNumbers([
    context?.today_in_kwh,
    context?.today_out_kwh,
    context?.week_in_kwh,
    context?.week_out_kwh,
    context?.month_in_kwh,
    context?.month_out_kwh,
    ...flow.map((hour) => hour?.in_kwh),
    ...flow.map((hour) => hour?.out_kwh),
  ]);
}

const CURRENCY_AMOUNT_RE = /(?:€|EUR)\s*([\d.,]+)/gi;
const KWH_AMOUNT_RE = /([\d.,]+)\s*kWh/gi;
const KW_POWER_RE = /([\d.,]+)\s*kW(?!h)/gi;

function matchesServed(value, served) {
  return served.some(
    (servedValue) =>
      Math.abs(servedValue - value) <= FIGURE_TOLERANCE + FLOAT_GUARD
  );
}

export function guardFigureGrounding(text, context) {
  const problems = [];
  const t = String(text ?? "");
  const prices = servedPriceValues(context);
  const kwhValues = servedKwhValues(context);
  for (const match of t.matchAll(CURRENCY_AMOUNT_RE)) {
    const value = parseFigure(match[1]);
    if (!matchesServed(value, prices)) {
      problems.push(
        `states the amount "${match[0]}" which matches no served price fact; prices may be stated only exactly as served`
      );
    }
  }
  for (const match of t.matchAll(KWH_AMOUNT_RE)) {
    const value = parseFigure(match[1]);
    if (!matchesServed(value, kwhValues)) {
      problems.push(
        `states the kWh figure "${match[0]}" which matches no served kWh fact; figures are stated only exactly as served`
      );
    }
  }
  for (const match of t.matchAll(KW_POWER_RE)) {
    problems.push(
      `states power as "${match[0]}" in kW; power is served in watts only and is never converted`
    );
  }
  return { ok: problems.length === 0, problems };
}

// The battery box validator: the non-finite guard plus the four battery
// guards above, over the served context the text was generated against.
// Returns { ok, problems } with every named reason.
export function validateBatteryInsight(text, context) {
  const guards = [
    guardNonFiniteText(text),
    guardNoApplianceAdvice(text),
    guardNoBatteryAdvice(text),
    guardBandConsistency(text, context),
    guardFigureGrounding(text, context),
  ];
  const problems = guards.flatMap((guard) => guard.problems);
  return { ok: problems.length === 0, problems };
}
