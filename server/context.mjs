// One context snapshot per /api/summary request: the materialized fields
// the AI insight is based on - day totals from energy_delta, prices past
// and forecast, the PV forecast and the battery state - plus the stable
// signature over them. The insight gating (cache, throttle, stale
// markers) is driven by this snapshot, so the kiosk can always compare
// the served insight against the data shown next to it.

import { buildSummaryContext, dayLabel, summarySignature } from "./ai.mjs";
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
  localHourLabel,
  nextDateKey,
} from "./time.mjs";

const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10_000) / 10_000;

// Generic timing guidance, exactly computable from the price data
// alone: today's cheapest remaining window, today's peak hour, and the
// spread per kWh between them. Unlike candidates it is generic and
// honest per kWh - never attached to an appliance load or an EUR
// total. Omitted on flat-price days (spread under 0.03 EUR/kWh),
// which have no advice to give.
const GUIDANCE_MIN_SPREAD_EUR = 0.03;

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
  // The rain day: the lowest-solar rain day, rendered whenever the
  // forecast shows rain - plainly the day to avoid.
  const rainDays = outlookDays.filter((day) => day.condition === "rain");
  const poor =
    rainDays.length > 0
      ? rainDays.reduce((low, day) => (day.solar_kwh < low.solar_kwh ? day : low))
      : null;
  return {
    days: outlookDays,
    best_solar_day:
      best.solar_kwh > 0
        ? {
            weekday: best.weekday,
            weekday_short: best.weekday_short,
            solar_kwh: best.solar_kwh,
          }
        : null,
    poor_day:
      poor !== null
        ? {
            weekday: poor.weekday,
            weekday_short: poor.weekday_short,
            solar_kwh: poor.solar_kwh,
            condition: poor.condition,
          }
        : null,
  };
}

function buildGuidance(priceParts) {
  const cheapest = priceParts?.cheapestByDay?.today ?? null;
  const today = priceParts?.priceData?.today ?? null;
  if (!cheapest || !today || today.max == null) {
    return null;
  }
  const spread = today.max - cheapest.average_price;
  if (spread < GUIDANCE_MIN_SPREAD_EUR) {
    return null;
  }
  return {
    window: `${localHourLabel(cheapest.start)}-${localHourLabel(
      cheapest.end
    )} today`,
    cheapest_window_average_eur: round4(cheapest.average_price),
    peak_hour: today.peak_hour ?? null,
    peak_price_eur: round4(today.max),
    spread_per_kwh_eur: round4(spread),
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
  if (!deferDay && !advance) {
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
  // The honest horizon note, defer-only: it matters exactly when the
  // advisory recommends waiting for a cheaper day whose successor is
  // not yet priced. It names the referent - the cheapest known day
  // with its average. An advance advisory compares fully priced days
  // and carries no note.
  const horizonNote =
    type === "defer" &&
    tomorrowAvg !== null &&
    compare.average_eur !== null &&
    !dayAfterKnown
      ? `Cheapest day known so far is ${compare.label} at ${round4(
          compare.average_eur
        )} average; the day after is not yet published`
      : null;
  return {
    type,
    tomorrow_average_eur: tomorrowAvg,
    tomorrow_solar_kwh: tomorrowSolar,
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
      basis: `${round2(kwh)} kWh today at an average of EUR ${round4(
        avgPaid
      )}/kWh versus EUR ${round4(cheapest.average_price)}/kWh in the cheapest remaining window`,
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
      basis: `${round2(outTotal)} kWh discharged today covering hours at EUR ${round4(
        outTotal > 0 ? avoided / outTotal : 0
      )}/kWh average versus EUR ${round4(
        cheapest.average_price
      )}/kWh in the cheapest remaining window`,
    });
  }
  return candidates;
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
  return { topAppliances, co2Intensity, candidates, guidance, advisory, outlook };
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
