// The advisory facts layer (contract section 2): one consolidation of the
// computed facts the AI Advisory card consumes. Thin and additive - it
// calls the existing builders in context.mjs and shapes their outputs into
// the facts object the advisory core takes (contract section 3), including
// every null encoding: a missing or thin input is null, never a guess, and
// the core's own sanitization drops a fact whose number is missing. No
// behavior change to any builder, no re-implementation of any figure. No
// environment access: the switch and every env read live in the adapter
// and the index layer.

import {
  buildAdvisory,
  buildFacts,
  buildGuidance,
  buildOutlook,
} from "./context.mjs";
import { getBatteryFlow } from "./battery-flow.mjs";
import { getPriceSummary } from "./prices.mjs";
import {
  localDateKey,
  localDayStartUtcMs,
  localHourLabel,
  nextDateKey,
  weekdayName,
} from "./time.mjs";

// Today's own-solar share of home usage (contract section 3, the recap
// fact solar_share_pct): the same verified totals and the same method the
// hub's self-consumption figures use - production minus export, the hub's
// own numerator for its Self usage share - measured against today's home
// usage. The numerator is clamped to [0, usage]: the evening battery
// export can push production minus export below zero, and solar beyond
// usage charged the battery instead of covering it. Null when the totals
// are thin (no production figure or no positive usage).
function solarSharePct(today) {
  const pvKwh = today?.pv_kwh ?? null;
  const exportKwh = today?.export_kwh ?? null;
  const usageKwh = today?.total_usage_kwh ?? null;
  if (
    pvKwh === null ||
    exportKwh === null ||
    usageKwh === null ||
    usageKwh <= 0
  ) {
    return null;
  }
  const ownSolarKwh = Math.min(Math.max(pvKwh - exportKwh, 0), usageKwh);
  return Math.round((ownSolarKwh / usageKwh) * 100);
}

// Today's battery result (the recap fact battery_earned_eur): the same
// valuation the battery flow endpoint serves - the discharge value minus
// the charge cost, priced bottom-up per hour at the dynamic price - so the
// achievement line can never contradict the Battery tab's arbitrage
// figure. Null when the battery is unavailable; the flow's own null rule
// (a flow hour without a known price makes the money total null)
// propagates unchanged.
async function batteryArbitrageToday() {
  const startMs = localDayStartUtcMs(localDateKey(new Date()));
  const flow = await getBatteryFlow(startMs, Date.now(), "hour");
  return flow.battery_available === true ? flow.totals.arbitrage_eur : null;
}

// Tomorrow's hourly prices from the same merged, cached curve the price
// context reads - the exact published rows, never a reconstruction from
// the day statistics.
async function tomorrowHourlyPrices() {
  const summary = await getPriceSummary(2);
  return summary.tomorrow.hours.map((hour) => hour.price_eur);
}

// The consolidated facts object for the advisory core. `snapshot` is the
// context snapshot ({ summary, weatherDaily, priceParts, extras }); the
// candidate rows are buildCandidates' output from the snapshot extras -
// its database inputs are not part of the snapshot, so the builder is not
// re-run. `loaders` carries the two pulls the snapshot does not hold
// (today's priced battery flow and tomorrow's hourly curve); production
// defaults fetch them, tests inject them. Every missing source is null,
// and a loader failure is a missing fact, never a crash.
export async function buildAdvisoryFacts(snapshot, loaders = {}) {
  const { summary, weatherDaily, priceParts, extras } = snapshot ?? {};
  const loadBatteryArbitrageEur =
    loaders.batteryArbitrageEur ?? batteryArbitrageToday;
  const loadTomorrowHourlyPrices =
    loaders.tomorrowHourlyPrices ?? tomorrowHourlyPrices;

  // The existing builders, called with the snapshot's own inputs; their
  // outputs are shaped below, never recomputed.
  const guidance = buildGuidance(priceParts);
  const advisory = buildAdvisory(priceParts, weatherDaily);
  const outlook = buildOutlook(weatherDaily, priceParts);
  const grounding = buildFacts(priceParts, summary);
  const today = summary?.today ?? null;

  // The cheapest remaining window, from the guidance builder's own output:
  // its label carries the trailing " today", the core's facts carry the
  // bare HH:MM-HH:MM form the fixtures pin.
  const windowParts =
    guidance !== null ? guidance.window.replace(" today", "").split("-") : null;
  const cheapestWindow =
    windowParts !== null
      ? {
          start: windowParts[0],
          end: windowParts[1],
          averageEur: guidance.cheapest_window_average_eur,
        }
      : null;

  // The evening recap's remaining window is the same cheapest remaining
  // window with its expected benefit against the day's average.
  const remainingWindow =
    cheapestWindow !== null
      ? {
          start: cheapestWindow.start,
          end: cheapestWindow.end,
          averageEur: cheapestWindow.averageEur,
          practicalBenefitEur: guidance.expected_benefit_eur,
        }
      : null;

  const todayKey = localDateKey(new Date());
  const tomorrowKey = nextDateKey(todayKey, 1);

  // Today's solar actual and forecast from the same sources the summary
  // context uses: the summary's PV actual, the daily forecast's today
  // entry. Null when neither exists.
  const actualKwh = today?.pv_kwh ?? null;
  const forecastKwh = Array.isArray(weatherDaily)
    ? (weatherDaily.find((day) => day.date === todayKey)?.estimated_kwh ??
      null)
    : null;
  const solarToday =
    actualKwh !== null || forecastKwh !== null
      ? { actualKwh, forecastKwh }
      : null;

  // The battery fact: the grounding builder's verified state plus today's
  // throughput, in the core's field naming. Null when the builder nulls
  // it (missing SOC or unknown state), never guessed.
  const battery =
    grounding.battery !== null
      ? {
          socPct: grounding.battery.soc_pct,
          state: grounding.battery.state,
          todayInKwh: today?.battery_charged_kwh ?? null,
          todayOutKwh: today?.battery_discharged_kwh ?? null,
        }
      : null;

  // The candidate rows in the core's shape: worthwhile is the inverse of
  // the builder's below_threshold mark, so selection keeps the exact
  // semantics of the existing candidates.
  const candidates = (Array.isArray(extras?.candidates)
    ? extras.candidates
    : []
  ).map((candidate) => ({
    label: candidate.label,
    kwh: candidate.load_kwh,
    savingEur: candidate.saving_eur,
    window: candidate.window,
    worthwhile: candidate.below_threshold !== true,
  }));

  const solar_share_pct = solarSharePct(today);
  let battery_earned_eur = null;
  try {
    battery_earned_eur = await loadBatteryArbitrageEur();
  } catch {
    // A failed pull is a missing fact, never a crash.
    battery_earned_eur = null;
  }

  // The tomorrow block, from the advisory builder's output: it is null
  // when the builder produced no advisory (no forecast data for tomorrow
  // and no trigger), matching the served absence of the advisory row.
  const published = priceParts?.tomorrowPricesAvailable === true;
  const tomorrowWindow = priceParts?.cheapestByDay?.tomorrow ?? null;
  let prices = null;
  if (published) {
    try {
      prices = await loadTomorrowHourlyPrices();
    } catch {
      prices = null;
    }
  }
  const tomorrowCondition =
    (outlook?.days ?? []).find((day) => day.date === tomorrowKey)?.condition ??
    null;
  const tomorrow =
    advisory === null
      ? null
      : {
          pricesPublished: published,
          // Tomorrow's weekday name, derived from tomorrow's date in the
          // same formatting as the weekday sections, so a narrative never
          // guesses the day of the week.
          weekday: weekdayName(tomorrowKey),
          // Unpublished prices are null with the reason in the section
          // guidance note; the model is never offered a slot to fill.
          prices,
          averageEur: published
            ? (priceParts?.priceData?.tomorrow?.average ?? null)
            : null,
          window:
            published && tomorrowWindow !== null
              ? `${localHourLabel(tomorrowWindow.start)}-${localHourLabel(
                  tomorrowWindow.end
                )}`
              : null,
          // The cheapest window's own average, so a tomorrow narrative
          // attributes a price to the window from this value and never
          // from the day average.
          windowAverageEur:
            published && tomorrowWindow !== null
              ? tomorrowWindow.average_price
              : null,
          condition: tomorrowCondition,
          solarKwh: advisory.tomorrow_solar_kwh,
          solarScore: advisory.tomorrow_solar_score,
          lowSolar: advisory.tomorrow_low_solar === true,
          compareSolarKwh: advisory.compare_solar_kwh,
        };

  // The forecast days beyond today from the outlook builder's output;
  // the core deduplicates tomorrow's date in the composer, tomorrow wins.
  const comingDays = (outlook?.days ?? []).map((day) => ({
    weekday: day.weekday,
    date: day.date,
    solarKwh: day.solar_kwh,
    solarScore: day.solar_score,
    condition: day.condition,
  }));

  return {
    lowPrice: grounding.lowPrice,
    peakPrice: grounding.peakPrice,
    battery,
    dayAverageEur:
      guidance?.day_average_eur ??
      priceParts?.priceData?.today?.average ??
      null,
    cheapestWindow,
    spreadPerKwhEur: guidance?.spread_per_kwh_eur ?? null,
    practicalBenefitEur: guidance?.expected_benefit_eur ?? null,
    co2IntensityGPerKwh: extras?.co2Intensity ?? null,
    solarToday,
    candidates,
    dayCheapestWindow: guidance?.day_cheapest_window ?? null,
    dayCheapestPassed: guidance?.day_cheapest_passed === true,
    // The whole-day cheapest window's average, already computed server-side
    // by the guidance builder: the facts layer supplies it so the adapter
    // can complete the served guidance (the contract's known limitation:
    // served null until the facts layer supplies it).
    dayCheapestAverageEur: guidance?.day_cheapest_average_eur ?? null,
    // The recap facts (contract section 3): read by the core only in
    // recap mode, null when the inputs are thin.
    solar_share_pct,
    battery_earned_eur,
    remainingWindow,
    remainingAverageEur: guidance?.remaining_average_eur ?? null,
    dayUsageKwh: today?.total_usage_kwh ?? null,
    dayCostEur: today?.cost_eur ?? null,
    tomorrow,
    comingDays,
  };
}
