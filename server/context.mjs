// One context snapshot per /api/summary request: the materialized fields
// the AI insight is based on - day totals from energy_delta, prices past
// and forecast, the PV forecast and the battery state - plus the stable
// signature over them. The insight gating (cache, throttle, stale
// markers) is driven by this snapshot, so the kiosk can always compare
// the served insight against the data shown next to it.

import {
  buildSummaryContext,
  capSentence,
  dayLabel,
  eurFactText,
  summarySignature,
} from "./ai.mjs";
import {
  GUIDANCE_MIN_SPREAD_EUR,
  PRACTICAL_MIN_ADVANTAGE_EUR,
} from "./advisory-constants.mjs";
import { getPriceContextData } from "./prices.mjs";
import {
  applianceTotals,
  dbHourlyPrices,
  getCo2Intensity,
  getSummary,
} from "./queries.mjs";
import { dailyForecast } from "./solar.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  localHourIndex,
  localHourLabel,
  nextDateKey,
} from "./time.mjs";

const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10_000) / 10_000;

// The price-spread thresholds live in advisory-constants.mjs, defined
// once with the distinction (0.03 = minimum detectable spread;
// 0.05 = minimum benefit worth acting on).

// Generic timing guidance, exactly computable from the price data
// alone: today's cheapest remaining window, today's peak hour, and the
// spread per kWh between them. Unlike candidates it is generic and
// honest per kWh - never attached to an appliance load or an EUR
// total. Omitted on flat-price days (spread under the minimum
// detectable spread, GUIDANCE_MIN_SPREAD_EUR in
// advisory-constants.mjs), which have no advice to give.

// WMO weather codes mapped to home-language condition summaries for
// the week outlook.
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
function conditionSummary(code) {
  if (RAIN_CODES.has(code)) {
    return "rain";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return "snow";
  }
  if ([95, 96, 99].includes(code)) {
    return "thunderstorms";
  }
  if (code === 45 || code === 48) {
    return "fog";
  }
  if (code === 3) {
    return "cloudy";
  }
  if (code === 1 || code === 2) {
    return "partly cloudy";
  }
  if (code === 0) {
    return "clear";
  }
  return "variable";
}

// The week outlook from the five-day forecast: every day after today
// with its weekday, expected solar and condition, plus the best solar
// day and any notably poor rain day. Grid prices beyond tomorrow are
// not yet published, so beyond tomorrow the solar forecast is the
// deciding signal - the outlook says so honestly. Pure forecast data,
// no predictions of appliance runs.
export function buildOutlook(weatherDaily, priceParts) {
  const days = Array.isArray(weatherDaily) ? weatherDaily : [];
  const todayKey = localDateKey(new Date());
  const tomorrowKey = nextDateKey(todayKey, 1);
  // Price honesty: only tomorrow's grid price is published; every
  // later day carries null, so no user-facing text can state a price
  // that does not exist in the data.
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const tomorrowAverage =
    tomorrowAvailable
      ? (priceParts?.priceData?.tomorrow?.average ?? null)
      : null;
  const outlookDays = days
    .filter((day) => day.date > todayKey)
    .map((day) => {
      const date = new Date(`${day.date}T12:00:00Z`);
      const weekday = date.toLocaleDateString("en-GB", {
        timeZone: "UTC",
        weekday: "long",
      });
      return {
        date: day.date,
        weekday,
        weekday_short: weekday.slice(0, 3),
        solar_kwh: day.estimated_kwh,
        // The solar score (0 to 100 versus the annual peak) grounds
        // the week outlook's qualitative wording.
        solar_score: day.solar_score ?? null,
        condition: conditionSummary(day.weather_code ?? -1),
        average_price_eur:
          day.date === tomorrowKey ? tomorrowAverage : null,
      };
    });
  if (outlookDays.length === 0) {
    return null;
  }
  const best = outlookDays.reduce((top, day) =>
    day.solar_kwh > top.solar_kwh ? day : top
  );
  // A notably poor day - named plainly as the day to avoid: its
  // condition maps to rain or showers (the summary maps both to
  // "rain"), or its expected solar is under 40 percent of the best
  // known day's. The row names the worst qualifying day, the lowest
  // solar among them; a rainy day with good solar is never the avoid
  // day while a poorer one exists.
  const POOR_SOLAR_FACTOR = 0.4;
  const poorCandidates = outlookDays.filter(
    (day) =>
      day.condition === "rain" ||
      day.solar_kwh < best.solar_kwh * POOR_SOLAR_FACTOR
  );
  const poor =
    poorCandidates.length > 0
      ? poorCandidates.reduce((low, day) =>
          day.solar_kwh < low.solar_kwh ? day : low
        )
      : null;
  // The sibling outlook cards' descriptions, composed server-side in
  // household voice: meaning first, never opening with the weekday
  // (the card's own chip already names the day), with the grounding
  // figures kept - their subtexts carry no numbers, so nothing is
  // duplicated. Deterministic single writer, derived from the
  // computed figures; missing scores fall back to the plain solar
  // fact rather than guessing a quality.
  const bestLine = (day) =>
    day.solar_score !== null
      ? day.good
        ? `A genuinely good solar day: score ${day.solar_score}, ${day.solar_kwh} kWh expected.`
        : `The week's best solar day, though nothing special: score ${day.solar_score}, ${day.solar_kwh} kWh expected.`
      : `The week's sunniest day: ${day.solar_kwh} kWh of your own solar expected.`;
  const poorLine = (day) =>
    capSentence(
      best.solar_kwh > 0 && day.solar_kwh < best.solar_kwh * 0.35
        ? `${day.condition === "rain" ? "Rain and " : ""}almost no solar of your own: ${day.solar_kwh} kWh expected.`
        : `${capSentence(day.condition)} that day, with ${day.solar_kwh} kWh of your own solar.`
    );
  // The poor day's advice line, composed server-side in the household
  // register: reason and guidance together, one short narrative
  // sentence instead of a clipped fragment - deterministic from the
  // outlook data, never model output, so all narrative voice stays in
  // one place.
  const poorAdvice = (day) => {
    if (best.solar_kwh > 0 && day.solar_kwh < best.solar_kwh * 0.35) {
      return "With little solar expected, it is not a good day to run your large appliances.";
    }
    if (day.condition === "rain") {
      return "With rain expected, it is not a good day to run your large appliances.";
    }
    return "With the week's weakest solar expected, it is not a good day to run your large appliances.";
  };
  // "Looks good for solar" only when the score backs it.
  const bestGood =
    best.solar_score !== null && best.solar_score >= GOOD_SOLAR_SCORE;
  const bestDescribed = { ...best, good: bestGood };
  return {
    days: outlookDays,
    best_solar_day:
      best.solar_kwh > 0
        ? {
            date: best.date,
            weekday: best.weekday,
            weekday_short: best.weekday_short,
            solar_kwh: best.solar_kwh,
            solar_score: best.solar_score,
            good: bestGood,
            line: bestLine(bestDescribed),
          }
        : null,
    poor_day:
      poor !== null
        ? {
            date: poor.date,
            weekday: poor.weekday,
            weekday_short: poor.weekday_short,
            solar_kwh: poor.solar_kwh,
            condition: poor.condition,
            line: poorLine(poor),
            advice: poorAdvice(poor),
          }
        : null,
  };
}

// The practicality gate for the today imperative: the command renders
// only when the remaining window is a real opportunity. Three named
// conditions, tunable together (recorded in docs/advisory-spec.md):
// the window starts before the evening pivot hour (default 18:00,
// EMS_EVENING_PIVOT_HOUR), at least PRACTICAL_MIN_HOURS of it remain,
// and its average sits at least PRACTICAL_MIN_ADVANTAGE_EUR below the
// day's average - a live reference comparison (the threshold itself
// lives in advisory-constants.mjs). Outside the gate the card states
// the passed cheap hours plainly instead of commanding.
const EVENING_PIVOT_HOUR =
  Number.parseInt(process.env.EMS_EVENING_PIVOT_HOUR ?? "", 10) || 18;
const PRACTICAL_MIN_HOURS = 2;
// The evening delay rule (Phase E): tomorrow's cheapest window must be
// at least this much cheaper than the best window remaining today
// before the card advises delaying heavy usage to it.
const DELAY_MIN_ADVANTAGE_EUR_RAW = Number.parseFloat(
  process.env.EMS_DELAY_MIN_ADVANTAGE_EUR ?? ""
);
const DELAY_MIN_ADVANTAGE_EUR =
  Number.isFinite(DELAY_MIN_ADVANTAGE_EUR_RAW) &&
  DELAY_MIN_ADVANTAGE_EUR_RAW > 0
    ? DELAY_MIN_ADVANTAGE_EUR_RAW
    : 0.05;
// The qualitative solar thresholds (Phase E): a forecast day below
// LOW_SOLAR_SCORE reads as little sun (the hedged grid-reliance
// phrasing before tomorrow's prices are published); a day at or
// above GOOD_SOLAR_SCORE reads as looking good for solar in the week
// outlook.
const LOW_SOLAR_SCORE =
  Number.parseInt(process.env.EMS_LOW_SOLAR_SCORE ?? "", 10) || 20;
const GOOD_SOLAR_SCORE =
  Number.parseInt(process.env.EMS_GOOD_SOLAR_SCORE ?? "", 10) || 60;

export function buildGuidance(priceParts) {
  const cheapest = priceParts?.cheapestByDay?.today ?? null;
  const today = priceParts?.priceData?.today ?? null;
  if (!cheapest || !today || today.max == null) {
    return null;
  }
  // The spread and the advantage are rounded to the served precision
  // before the threshold comparisons: raw float subtraction can sit a
  // hair under an exact boundary (0.3 - 0.25 reads as 0.0499... and
  // would fail the 0.05 advantage gate).
  const spread = round4(today.max - cheapest.average_price);
  if (spread < GUIDANCE_MIN_SPREAD_EUR) {
    return null;
  }
  const now = Date.now();
  const startMs = Date.parse(cheapest.start);
  const endMs = Date.parse(cheapest.end);
  // The window's own hours that remain, not the lead time before it.
  const hoursRemaining = Math.max(
    0,
    (endMs - Math.max(now, startMs)) / 3_600_000
  );
  const windowStartHour = localHourIndex(new Date(cheapest.start));
  const dayAverage = today.average ?? null;
  // The C17 evening-window gate inputs: an evening window (starting
  // at or after the evening pivot hour, e.g. 21:00-00:00) carries its
  // expected benefit - the actual curve's day average minus the
  // window's average, the honest live reference that assumes the
  // household's usage would otherwise pay the day's average price,
  // never a fabricated benefit figure. The gate itself compares this
  // against the minimum benefit worth acting on
  // (PRACTICAL_MIN_ADVANTAGE_EUR), never the minimum detectable
  // spread, when the served guidance line picks its voice.
  const eveningWindow = windowStartHour >= EVENING_PIVOT_HOUR;
  const expectedBenefitEur =
    dayAverage === null
      ? null
      : round4(dayAverage - cheapest.average_price);
  // The gate inputs ride the payload so the debug view can show them.
  const practical =
    windowStartHour < EVENING_PIVOT_HOUR &&
    hoursRemaining >= PRACTICAL_MIN_HOURS &&
    dayAverage !== null &&
    round4(dayAverage - cheapest.average_price) >=
      PRACTICAL_MIN_ADVANTAGE_EUR;
  const dayWindow = priceParts?.dayCheapestWindow ?? null;
  const nowHour = localHourIndex(new Date());
  // The peak-avoidance line renders only while the day's peak hour is
  // still ahead of the current hour - the live-reference rule.
  const peakHourNum =
    today.peak_hour != null ? Number.parseInt(today.peak_hour, 10) : null;
  const peakAhead = peakHourNum !== null && peakHourNum > nowHour;
  // Whether the day's actual cheap hours are gone: the passed-hours
  // fact is honest only then. A gate-blocked evening window that is
  // still ahead reads as the evening price situation instead.
  const dayCheapestPassed = dayWindow
    ? nowHour >= localHourIndex(new Date(dayWindow.end))
    : false;
  // The evening delay rule: with tomorrow's prices published, compare
  // tomorrow's cheapest window against the best window remaining
  // today; when tomorrow is meaningfully cheaper the card advises
  // delaying heavy usage to it (rendered only once today no longer
  // commands - the imperative transfer of the voice rules).
  const tomorrowWindow = priceParts?.cheapestByDay?.tomorrow ?? null;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const delay =
    tomorrowAvailable &&
    tomorrowWindow !== null &&
    round4(cheapest.average_price - tomorrowWindow.average_price) >=
      DELAY_MIN_ADVANTAGE_EUR
      ? {
          tomorrow_window: `${localHourLabel(tomorrowWindow.start)}-${localHourLabel(
            tomorrowWindow.end
          )} tomorrow`,
          tomorrow_window_average_eur: round4(tomorrowWindow.average_price),
          today_window_average_eur: round4(cheapest.average_price),
        }
      : null;
  return {
    window: `${localHourLabel(cheapest.start)}-${localHourLabel(
      cheapest.end
    )} today`,
    cheapest_window_average_eur: round4(cheapest.average_price),
    peak_hour: today.peak_hour ?? null,
    peak_price_eur: round4(today.max),
    spread_per_kwh_eur: round4(spread),
    // The gate and its inputs.
    practical,
    window_start_hour: windowStartHour,
    hours_remaining: Math.round(hoursRemaining * 10) / 10,
    day_average_eur: dayAverage === null ? null : round4(dayAverage),
    // The C17 evening-window gate inputs: whether the cheapest
    // remaining window is an evening window (at or after the pivot),
    // and its expected benefit against the day's average.
    evening_window: eveningWindow,
    expected_benefit_eur: expectedBenefitEur,
    // The Phase E today modes: the peak-avoidance line while the peak
    // is ahead, the passed-hours honesty, the evening price situation
    // and the cross-day delay comparison.
    peak_ahead: peakAhead,
    day_cheapest_passed: dayCheapestPassed,
    remaining_average_eur: priceParts?.remainingAverageEur ?? null,
    delay,
    // The day's actual cheapest window, for the passed-hours fact.
    day_cheapest_window: dayWindow
      ? `${localHourLabel(dayWindow.start)}-${localHourLabel(dayWindow.end)}`
      : null,
    day_cheapest_average_eur: dayWindow ? round4(dayWindow.average_price) : null,
  };
}

// Day-ahead advisory, guidance-class: honest, per kWh, never an
// invented appliance total. Fires only on a meaningful difference:
// tomorrow's average price at least 20 percent above the cheapest
// known day (defer heavy usage), or at least 20 percent below today's
// (advance it to tomorrow); or tomorrow's solar forecast at least 40
// percent below the best following day (defer), or at least 40
// percent above today's (advance). Availability-driven: it uses
// whatever days the feed provides and never gates on a time of day;
// while the day-after prices are unpublished the horizon is labeled
// honestly - cheapest day known so far. Returns null when no
// meaningful difference exists.
const PRICE_DEARER_FACTOR = 1.2;
const PRICE_CHEAPER_FACTOR = 0.8;
const SOLAR_POORER_FACTOR = 0.6;
const SOLAR_SUNNIER_FACTOR = 1.4;

export function buildAdvisory(priceParts, weatherDaily) {
  const days = Array.isArray(weatherDaily) ? weatherDaily : [];
  const todayKey = localDateKey(new Date());
  const tomorrowKey = nextDateKey(todayKey, 1);
  const byDate = (key) => days.find((day) => day.date === key) ?? null;
  const todayEntry = byDate(todayKey);
  const tomorrowEntry = byDate(tomorrowKey);
  const todaySolar = todayEntry?.estimated_kwh ?? null;
  const tomorrowSolar = tomorrowEntry?.estimated_kwh ?? null;
  // Tomorrow's solar score (0 to 100 versus the annual peak) and its
  // low-solar flag: the hedged grid-reliance phrasing (Phase E)
  // applies when the score sits below LOW_SOLAR_SCORE.
  const tomorrowScore = tomorrowEntry?.solar_score ?? null;
  const tomorrowLowSolar =
    tomorrowScore !== null && tomorrowScore < LOW_SOLAR_SCORE;
  // The best of the following forecast days, for the solar comparison.
  const following = days.filter((day) => day.date > tomorrowKey);
  const bestFollowing =
    following.length > 0
      ? following.reduce((best, day) =>
          day.estimated_kwh > best.estimated_kwh ? day : best
        )
      : null;

  const todayAvg = priceParts?.priceData?.today?.average ?? null;
  const tomorrowAvailable = priceParts?.tomorrowPricesAvailable === true;
  const tomorrowAvg = tomorrowAvailable
    ? (priceParts?.priceData?.tomorrow?.average ?? null)
    : null;
  const dayAfterKnown = priceParts?.dayAfterPricesAvailable === true;

  // Price triggers: defer when tomorrow is dearer than the cheapest
  // known day, advance when tomorrow is meaningfully cheaper than
  // today. The comparison set is the known priced days - today, and
  // the day after once the feed publishes it.
  let priceDeferDay = null;
  let priceAdvance = false;
  if (tomorrowAvg !== null) {
    const knownPricedDays = [];
    if (todayAvg !== null) {
      knownPricedDays.push({ label: "today", average: todayAvg });
    }
    if (dayAfterKnown) {
      // The day-after average is not exposed by the price context;
      // when the feed grows the horizon, this is where it joins.
    }
    const cheapest = knownPricedDays.reduce(
      (best, day) => (day.average < best.average ? day : best),
      knownPricedDays[0]
    );
    if (cheapest && tomorrowAvg >= cheapest.average * PRICE_DEARER_FACTOR) {
      priceDeferDay = cheapest;
    }
    if (todayAvg !== null && tomorrowAvg <= todayAvg * PRICE_CHEAPER_FACTOR) {
      priceAdvance = true;
    }
  }

  // Solar triggers: defer when a following forecast day is far sunnier
  // than tomorrow, advance when tomorrow is far sunnier than today.
  let solarDeferDay = null;
  let solarAdvance = false;
  if (tomorrowSolar !== null && bestFollowing !== null) {
    if (tomorrowSolar <= bestFollowing.estimated_kwh * SOLAR_POORER_FACTOR) {
      solarDeferDay = bestFollowing;
    }
  }
  if (
    tomorrowSolar !== null &&
    todaySolar !== null &&
    todaySolar > 0 &&
    tomorrowSolar >= todaySolar * SOLAR_SUNNIER_FACTOR
  ) {
    solarAdvance = true;
  }

  // One advisory; the price side leads when both fire, since it
  // carries the exact per-kWh difference.
  const type = priceDeferDay || solarDeferDay ? "defer" : "advance";
  const deferDay =
    priceDeferDay ??
    (solarDeferDay
      ? { label: dayLabel(solarDeferDay.date), average: null }
      : null);
  const advance = !deferDay && (priceAdvance || solarAdvance);
  const triggered = Boolean(deferDay) || advance;
  // The tomorrow row always renders when the forecast carries
  // tomorrow's expected solar: the triggers decide the prefer
  // recommendation, not the row's existence. Without any forecast
  // data for tomorrow the row is omitted - honest absence.
  if (!triggered && tomorrowSolar === null) {
    return null;
  }
  const compare =
    type === "defer"
      ? {
          label: deferDay.label,
          average_eur: deferDay.average,
          solar_kwh:
            solarDeferDay !== null
              ? solarDeferDay.estimated_kwh
              : deferDay.label === "today"
                ? todaySolar
                : null,
        }
      : { label: "today", average_eur: todayAvg, solar_kwh: todaySolar };
  // The honest horizon note. Defer-only when triggered: it matters
  // exactly when the advisory recommends waiting for a cheaper day
  // whose successor is not yet priced. It names the referent - the
  // cheapest known day with its average. An advance advisory compares
  // fully priced days and carries no note. The informational row
  // (no trigger) labels the horizon honestly when tomorrow's prices
  // are not yet published.
  let horizonNote = null;
  if (
    type === "defer" &&
    triggered &&
    tomorrowAvg !== null &&
    compare.average_eur !== null &&
    !dayAfterKnown
  ) {
    horizonNote = `Cheapest day known so far is ${compare.label} at ${eurFactText(
      compare.average_eur
    )} average; the day after is not yet published`;
  } else if (!triggered && tomorrowAvg === null) {
    horizonNote =
      "Grid prices for tomorrow are not yet published; a fuller " +
      "comparison follows once they are available.";
  }
  return {
    type,
    // Whether one of the prefer triggers fired: the row always renders
    // with forecast data, the recommendation (and its chip) only when
    // this is true.
    triggered,
    tomorrow_average_eur: tomorrowAvg,
    tomorrow_solar_kwh: tomorrowSolar,
    // Tomorrow's solar score and its low-solar flag (Phase E).
    tomorrow_solar_score: tomorrowScore,
    tomorrow_low_solar: tomorrowLowSolar,
    compare_day: compare.label,
    compare_average_eur: compare.average_eur,
    compare_solar_kwh: compare.solar_kwh,
    price_difference_per_kwh:
      tomorrowAvg !== null && compare.average_eur !== null
        ? round4(tomorrowAvg - compare.average_eur)
        : null,
    horizon_note: horizonNote,
  };
}

// Candidate actions with exact arithmetic, computed by the server so the
// model only selects and phrases - it never computes. Each appliance
// with at least 0.5 kWh measured today: the saving if that load had
// run in the cheapest remaining window today, kWh times the exact
// difference between the average price the appliance paid (its
// bottom-up hourly cost over its kWh) and the window's average price.
// A battery candidate only when it discharged today: recharging that
// energy in the cheapest window saves the discharged kWh times the
// difference between the hours it covered (at their import prices) and
// the window average. Candidates below 0.05 EUR stay in the list,
// marked belowThreshold, so the model can report them honestly.
// Exported as a pure function so the arithmetic stays verifiable.
// Household register for an appliance label: entity names arrive
// capitalised and sometimes carry a suffix such as "Washing machine
// energy"; the basis line reads "your washing machine used ...".
function householdApplianceName(name) {
  const cleaned = name.replace(/\s+(energy|power|consumption)$/i, "").trim();
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

export function buildCandidates(applianceRows, summary, priceParts, priceRows) {
  const cheapest = priceParts?.cheapestByDay?.today ?? null;
  if (!cheapest) {
    return [];
  }
  const windowLabel = `${localHourLabel(cheapest.start)}-${localHourLabel(
    cheapest.end
  )} today`;
  const candidates = [];
  for (const row of applianceRows) {
    const kwh = Number(row.kwh);
    if (!(kwh >= 0.5)) {
      continue;
    }
    const cost = Number(row.cost_eur ?? 0);
    if (cost <= 0) {
      continue;
    }
    const avgPaid = cost / kwh;
    // Four decimals, so a small nonzero saving survives to the display
    // (0.0035 stays 0.0035; cents never round it to 0.00).
    const savingEur = round4(kwh * (avgPaid - cheapest.average_price));
    candidates.push({
      label: row.appliance,
      load_kwh: round2(kwh),
      window: windowLabel,
      saving_eur: savingEur,
      below_threshold: savingEur < 0.05,
      // A sentence served beneath the card title: capitalized, and
      // every amount carries the flush euro sign. Full precision
      // stays in the payload; the display clamps to the served
      // precision.
      basis: `Your ${householdApplianceName(row.appliance)} used ${round2(
        kwh
      )} kWh so far today at an average of €${round4(
        avgPaid
      )}/kWh versus €${round4(cheapest.average_price)}/kWh in the cheapest remaining window`,
    });
  }
  const flow = summary?.battery_flow_hourly ?? [];
  const outTotal = flow.reduce((total, hour) => total + hour.out_kwh, 0);
  if (outTotal > 0) {
    const priceByHour = new Map(
      priceRows.map((row) => [row.ts.toISOString().slice(0, 13), row.price_eur])
    );
    const avoided = flow.reduce(
      (total, hour) =>
        total + hour.out_kwh * (priceByHour.get(hour.ts.slice(0, 13)) ?? 0),
      0
    );
    const savingEur = round4(avoided - outTotal * cheapest.average_price);
    candidates.push({
      label: "Battery recharge",
      load_kwh: round2(outTotal),
      window: windowLabel,
      saving_eur: savingEur,
      below_threshold: savingEur < 0.05,
      basis: `Your battery discharged ${round2(outTotal)} kWh today covering hours at €${round4(
        outTotal > 0 ? avoided / outTotal : 0
      )}/kWh average versus €${round4(
        cheapest.average_price
      )}/kWh in the cheapest remaining window`,
    });
  }
  return candidates;
}

// The grounding facts for the advisory's price and battery sentences:
// today's lowest and peak price, each with its own timestamp, and the
// battery state (SOC percentage and charging/discharging/idle) verbatim
// from the same summary values the model context line is built from.
// Every fact is null when its data is missing, so the corresponding
// sentence is omitted entirely - never approximated, never filled by
// the model. Exported as a pure function so the pairing stays
// verifiable.
export function buildFacts(priceParts, summary) {
  const today = priceParts?.priceData?.today ?? null;
  const lowPrice =
    today !== null && today.low_hour != null && today.min != null
      ? { timestamp: today.low_hour, price: round4(today.min) }
      : null;
  const peakPrice =
    today !== null && today.peak_hour != null && today.max != null
      ? { timestamp: today.peak_hour, price: round4(today.max) }
      : null;
  const soc = summary?.battery_soc_pct ?? null;
  const state = summary?.battery_state ?? null;
  const battery =
    soc !== null &&
    (state === "charging" || state === "discharging" || state === "idle")
      ? { soc_pct: soc, state }
      : null;
  return { lowPrice, peakPrice, battery };
}

// Decision-insight extras: today's top appliances (names and kWh, for
// grounded recommendations), the live grid CO2 intensity and the
// precomputed candidate actions. All fail soft: empty appliances, a
// null CO2 and an empty candidate list keep the insight serving.
async function buildInsightExtras(summary, priceParts, weatherDaily) {
  const now = new Date();
  const startMs = localDayStartUtcMs(localDateKey(now));
  const [applianceRows, co2Intensity, priceRows] = await Promise.all([
    applianceTotals(startMs, now.getTime()).catch(() => []),
    getCo2Intensity(),
    dbHourlyPrices(startMs, now.getTime()).catch(() => []),
  ]);
  const topAppliances = applianceRows
    .filter((row) => Number(row.kwh) > 0)
    .sort((a, b) => Number(b.kwh) - Number(a.kwh))
    .slice(0, 3)
    .map((row) => ({
      appliance: row.appliance,
      kwh: round2(Number(row.kwh)),
    }));
  const candidates = buildCandidates(
    applianceRows,
    summary,
    priceParts,
    priceRows
  );
  const guidance = buildGuidance(priceParts);
  const advisory = buildAdvisory(priceParts, weatherDaily);
  const outlook = buildOutlook(weatherDaily, priceParts);
  const facts = buildFacts(priceParts, summary);
  return {
    topAppliances,
    co2Intensity,
    candidates,
    guidance,
    advisory,
    outlook,
    facts,
  };
}

// Builds the context snapshot. The summary statistics come from the
// 5-minute server cache, the price context from the 10-minute merged
// curve cache and the PV forecast from the 30-minute weather cache, so
// repeated calls are cheap. The optional sources are omitted from the
// context when unavailable rather than failing the request.
export async function buildContextSnapshot() {
  const summary = await getSummary();
  let weatherDaily = null;
  try {
    weatherDaily = await dailyForecast(5);
  } catch {
    weatherDaily = null;
  }
  let priceParts = null;
  try {
    priceParts = await getPriceContextData();
  } catch {
    priceParts = null;
  }
  const extras = await buildInsightExtras(summary, priceParts, weatherDaily);
  return {
    summary,
    weatherDaily,
    priceParts,
    extras,
    // The materialized context the model receives.
    context: buildSummaryContext(summary, weatherDaily, priceParts, extras),
    // Stable hash over the materialized context fields.
    signature: summarySignature(summary, weatherDaily, priceParts, extras),
    // The moment the underlying summary data was built (the 5-minute
    // cache fill); the insight reports it as the data it is based on.
    asOf: summary.summary_as_of ?? new Date().toISOString(),
  };
}
