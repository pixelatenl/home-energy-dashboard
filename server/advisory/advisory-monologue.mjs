// The advisory monologue (STEP 2 retry/fallback + STEP 3 composition).
// One facts layer in, one monologue out: sections labeled TODAY, TOMORROW
// or a weekday, each carrying a short flowing narrative written by the
// model from that section's own facts. Facts stay server-owned: every
// figure string served to the model is pre-formatted here, and the
// figure-verbatim module (figure-verbatim.mjs) makes the model copy those
// strings exactly. A section narrative that fails validation gets exactly
// one retry, and the retry prompt carries the rejection reasons verbatim
// as feedback; after a second failure the section is served with its
// deterministic fallback sentences instead of the failing narrative.
//
// Purity contract: no clock reads, no network, no environment reads. `now`
// is an ISO-8601 local timestamp string with an explicit offset, carried
// as pure data (the same contract as advisory-core.mjs).

import {
  NO_OPPORTUNITY_STATEMENT,
  formatEur,
  parseLocalTime,
  sanitizeFacts,
  shiftDay,
} from "./advisory-core.mjs";
import {
  ACHIEVEMENT_MIN_BATTERY_EARN_EUR,
  ACHIEVEMENT_MIN_SOLAR_SHARE_PCT,
} from "../advisory-constants.mjs";
import {
  guardTomorrowPrice,
  guardBeyondTomorrowPrice,
  guardArithmetic,
  guardInternalVocabulary,
  guardNonFiniteText,
  guardRegister,
  guardNoOpportunityPhrasing,
  guardWeekBestFraming,
} from "./narrative-guards.mjs";
import { validateSectionFigures } from "./figure-verbatim.mjs";

// The style brief, embedded verbatim in the model prompt builder
// (buildSectionPrompt). Exported so the tests can pin it word for word.
// Micro-tuning: a run instruction names the window and the price
// advantage and never the saving (the saving lives once, in the
// supporting baseline sentence), and served notes are woven verbatim.
// Habit-close tuning: a TODAY section with a real action and a small
// saving may close with one meaning-only habit sentence. Window-price
// tuning: a price is attributed to a window only from the window's own
// average fact, never from the day average, and no difference or total
// is ever computed between served amounts. Self-containment: the brief
// never carries a concrete figure - the supporting-sentence example is a
// form with bracketed slots, not figures - and never invites cross-day
// mentions; a section's fact set is self-contained by design, and no
// calendar dates are written in prose (the weekday label anchors the
// day). Weekday sections speak of their day by weekday name only, and
// the register stays uncontracted.
export const MONOLOGUE_STYLE_BRIEF =
  "You write the energy advisory for a household. You see one section at a time, with its facts. Write 2 to 5 flowing sentences in plain household language, second person. Every sentence either carries one of the served facts or makes exactly one honest interpretive step from them; never invent, compute, or round any number, and copy every figure exactly as served, including the currency marker. Never write calendar dates or years; the weekday label already anchors the day. Attribute a price to a window only from the window's own average fact, never from the day average. Never compute a difference or a total between served amounts; state each amount exactly as served and compare by placing them side by side. State a saving exactly as served; never construct a price comparison to explain it. When you tell the household to run something, speak of your large appliances and never name a specific appliance; a run instruction names the window and the price advantage and never the saving. The named appliance, its measured load and the saving belong in one plain supporting sentence, as in 'Your [appliance] used [appliance_load] today; shifting it into that window saves [appliance_saving].' For the battery recharge action, the load is what the recharge will draw, not what it used today; never write that the battery used its load today. When the section is TODAY and there is a real action with a small saving, you may close with one meaning-only sentence that puts the saving in perspective, as in 'On its own that is small, but it is the kind of shift that quietly adds up when it becomes a habit.' It never states a yearly or monthly amount, never carries any figure, and appears at most once. When the facts carry a served note, weave it into your narrative word for word where it fits best. When the facts carry the battery and the day's solar forecast, spend one sentence on that household context. When the facts mark this section as the week's best solar day, keep the forecast framing, with its own score and expected energy. In a weekday section, refer to the day only by its weekday name; never write 'today'. Use the served weekday name for tomorrow; never guess the day of the week. Describe the weather only as the served condition states; add no other weather words. The condition describes the weather, never the production; never conclude from the condition alone that there is nothing worth doing; a rainy day can still deliver strong solar output. No flattery, no exclamation marks, no technical vocabulary such as candidates, thresholds, payloads, or budgets. No contractions: write 'it is', not 'it's'. If the facts say there is nothing worth doing, say so plainly and briefly.";

// Server-owned strings, served verbatim and never rephrased with different
// figures: the horizon note, the tomorrow-unpublished sentence, the
// low-solar hedged grid note (a clause the narrative attaches to its own
// lead-in) and the rain-day advice line.
// The horizon note is the retired advisory card's pinned note (the owner
// decision of 22 October, monologue parity): the TOMORROW section serves
// it whenever the payload carries sections beyond tomorrow, regardless
// of tomorrow's publication status. It serves as the final sentence of
// the served narrative and of the fallback sentences; the model may
// weave it from the facts but is never required to, and a narrative is
// never rejected for lacking it. Pinned here with the other server-owned
// strings; advisory-constants.mjs (frozen) holds the thresholds only.
export const HORIZON_NOTE =
  "Note: Beyond tomorrow, grid prices are not yet published; there the solar forecast is the deciding signal.";
export const TOMORROW_UNPUBLISHED_SENTENCE =
  "Tomorrow's prices are not published yet.";
export const LOW_SOLAR_GRID_NOTE =
  "so the house will lean on the grid and prices are usually firmer in that case; a better picture follows once tomorrow's prices are published";
export const RAIN_DAY_ADVICE =
  "With rain expected, it is not a good day to run your large appliances.";
// The positive solar advice (the owner decision of 22 October, from the
// live finding that a strong weekday was narrated as "nothing worth
// doing" because of the rain condition): a weekday section whose solar
// score reaches the threshold serves the pinned advice, with the figure
// identical to the served solar_kwh fact. Judgments are server-owned
// facts; the model narrates them. The negative rain advice keeps
// precedence - a section never carries both. The threshold is pinned
// here; advisory-constants.mjs (frozen) holds the card pipeline's
// thresholds only.
export const POSITIVE_ADVICE_MIN_SOLAR_SCORE = 20;

function positiveSolarAdvice(solarKwhFact) {
  return `With ${solarKwhFact} expected, it is a good day to run your large appliances on solar.`;
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== "");
}

// ---------------------------------------------------------------------------
// Deterministic formatting of the served fact strings. The standard
// amounts reuse advisory-core's formatEur (euro sign flush against the
// amount, two decimals when nonzero at two decimals). A candidate saving
// of a cent or more renders naturally at two decimals (0.1217 serves as
// "€0.12" - the form the household and the model both reach for); only a
// sub-cent saving keeps the minimal-precision display, the first decimal
// rendering that reads back exactly, so -€0.0036 serves as "-€0.0036".
// ---------------------------------------------------------------------------

export function formatSavingEur(value) {
  if (!isNum(value)) return null;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 0.01) {
    return `${sign}€${abs.toFixed(2)}`;
  }
  for (const decimals of [2, 3, 4, 5, 6]) {
    const rendered = abs.toFixed(decimals);
    if (Math.abs(Number(rendered) - abs) <= 1e-9) {
      return `${sign}€${rendered}`;
    }
  }
  return `${sign}€${abs.toFixed(6)}`;
}

function kwhString(value) {
  return isNum(value) ? `${value} kWh` : null;
}

function pctString(value) {
  return isNum(value) ? `${value}%` : null;
}

// A window label is served as one string plus its two boundary hours, so
// the model may write the range ("11:00-14:00") or the word form
// ("between 11:00 and 14:00") with both figures verbatim.
function addWindow(facts, key, label) {
  facts[key] = label;
  const m = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(label);
  if (m !== null) {
    const pad = (hour) => {
      const [hh, mm] = hour.split(":");
      return `${hh.padStart(2, "0")}:${mm}`;
    };
    facts[`${key}_start`] = pad(m[1]);
    facts[`${key}_end`] = pad(m[2]);
  }
}

// ---------------------------------------------------------------------------
// Section building: label, pre-formatted facts, fallback sentences and
// the advisory sentence budget (logged by the runner, never asserted).
// Budgets: TODAY 5 on an action day, 3 on a quiet day, 4 in recap mode
// (5 when a recap day composes a battery action); TOMORROW at most 3;
// days beyond tomorrow 1 sentence.
// ---------------------------------------------------------------------------

function priceFallback(facts) {
  if (facts.low_price && facts.peak_price) {
    return `Today's lowest price is ${facts.low_price} at ${facts.low_hour} and the peak is ${facts.peak_price} at ${facts.peak_hour}.`;
  }
  if (facts.low_price) {
    return `The lowest price so far is ${facts.low_price} at ${facts.low_hour}.`;
  }
  if (facts.peak_price) {
    return `The peak price so far is ${facts.peak_price} at ${facts.peak_hour}.`;
  }
  return null;
}

// The battery action's appliance: the facts layer labels it "Battery
// recharge", fixtures may call it "battery". The battery is never a
// large-appliance run, so its fallback sentence is its own deterministic
// form - the generic large-appliances imperative stays reserved for
// appliance actions.
function isBatteryAppliance(label) {
  return /^battery\b/i.test(String(label ?? "").trim());
}

function batteryActionSentence(facts) {
  const where = facts.appliance_window
    ? `in ${facts.appliance_window}`
    : "in the cheap hours";
  return `The battery can recharge ${where} and save ${facts.appliance_saving}.`;
}

function buildTodaySection(todaySection, eveningSection, rawFacts) {
  const tf = todaySection.facts ?? {};
  const recap = todaySection.mode === "recap";
  const actionAvailable = tf.candidate?.worthwhile === true;

  // The best candidate the facts layer knows about, worthwhile or not:
  // the section serves its figures honestly either way, and
  // action_available marks whether it clears the bar worth acting on.
  // buildSections selects only worthwhile candidates into the section,
  // so the best below-threshold offer comes from the raw facts (largest
  // saving first, the card's candidate order).
  let candidate = tf.candidate ?? null;
  if (candidate === null) {
    const list = Array.isArray(rawFacts?.candidates) ? rawFacts.candidates : [];
    if (list.length > 0) {
      const best = [...list].sort(
        (a, b) => (b.savingEur ?? 0) - (a.savingEur ?? 0)
      )[0];
      if (best != null) candidate = { ...best, worthwhile: false };
    }
  }
  // A battery action never takes the large-appliances imperative; it
  // composes its own deterministic fallback sentence instead.
  const batteryAction =
    actionAvailable && candidate !== null && isBatteryAppliance(candidate.label);

  const facts = {};
  facts.action_available = actionAvailable;
  if (tf.low) {
    facts.low_price = formatEur(tf.low.eur);
    facts.low_hour = tf.low.hour;
  }
  if (tf.peak) {
    facts.peak_price = formatEur(tf.peak.eur);
    facts.peak_hour = tf.peak.hour;
    facts.peak_ahead = tf.peak_ahead === true;
  }
  if (tf.cheapest_window) {
    addWindow(
      facts,
      "cheap_window",
      `${tf.cheapest_window.start}-${tf.cheapest_window.end}`
    );
    facts.cheap_window_average = formatEur(tf.cheapest_window.average_eur);
  }
  if (isNum(tf.day_average_eur)) facts.day_average = formatEur(tf.day_average_eur);
  if (tf.solar_today) {
    const solar = kwhString(tf.solar_today.actual_kwh);
    const forecast = kwhString(tf.solar_today.forecast_kwh);
    if (solar !== null) facts.solar_today = solar;
    if (forecast !== null) facts.solar_forecast = forecast;
  }
  if (tf.battery) {
    const level = pctString(tf.battery.soc_pct);
    if (level !== null) facts.battery_level = level;
    if (typeof tf.battery.state === "string") facts.battery_state = tf.battery.state;
  }
  if (typeof tf.day_cheapest_window === "string" && tf.day_cheapest_window !== "") {
    addWindow(facts, "day_cheap_hours", tf.day_cheapest_window);
    facts.day_cheap_hours_passed = tf.day_cheapest_passed === true;
  }
  if (candidate !== null) {
    // Section candidates carry the section shape (saving_eur); raw
    // facts-layer candidates carry the facts shape (savingEur).
    facts.appliance = candidate.label;
    facts.appliance_load = kwhString(candidate.kwh);
    facts.appliance_saving = formatSavingEur(
      candidate.saving_eur ?? candidate.savingEur
    );
    if (typeof candidate.window === "string" && candidate.window !== "") {
      addWindow(facts, "appliance_window", candidate.window);
    }
  }
  if (recap) {
    // The recap-only facts, at the served display precision the
    // achievement lines use.
    if (isNum(tf.solar_share_pct)) {
      facts.solar_share = `${Math.round(tf.solar_share_pct)}%`;
    }
    if (isNum(tf.battery_earned_eur)) {
      facts.battery_earned = formatEur(tf.battery_earned_eur);
    }
  }
  // The evening section's facts fold into TODAY: the evening window is
  // part of today's story, and its figures belong to TODAY's fact set.
  const ef = eveningSection?.facts ?? {};
  const rw = ef.remaining_window ?? null;
  if (rw) {
    addWindow(facts, "evening_window", `${rw.start}-${rw.end}`);
    if (isNum(rw.average_eur)) {
      facts.evening_window_average = formatEur(rw.average_eur);
    }
    facts.evening_worth_using = rw.practical === true;
  }
  if (isNum(ef.remaining_average_eur)) {
    facts.evening_average = formatEur(ef.remaining_average_eur);
  }
  if (isNum(ef.day_usage_kwh)) facts.day_usage = kwhString(ef.day_usage_kwh);
  if (isNum(ef.day_cost_eur)) facts.day_cost = formatEur(ef.day_cost_eur);

  // Deterministic fallback sentences (served when the narrative fails
  // twice, and always present in the payload). Quiet plan days lead with
  // the pinned no-opportunity statement; recap days carry the
  // achievement lines only when they clear their thresholds.
  // `notes` collects the server-owned strings this section serves: each
  // must appear verbatim in the final narrative (content parity); the
  // orchestrator appends the ones the model did not weave.
  const fallbacks = [];
  const notes = [];
  if (recap) {
    if (isNum(tf.solar_share_pct) && tf.solar_share_pct >= ACHIEVEMENT_MIN_SOLAR_SHARE_PCT) {
      const line = `Your own solar covered ${facts.solar_share} of today's usage.`;
      fallbacks.push(line);
      notes.push({ required: line, append: line });
    }
    if (
      isNum(tf.battery_earned_eur) &&
      tf.battery_earned_eur >= ACHIEVEMENT_MIN_BATTERY_EARN_EUR
    ) {
      const line = `Your battery earned ${facts.battery_earned} today.`;
      fallbacks.push(line);
      notes.push({ required: line, append: line });
    }
    if (facts.evening_window) {
      fallbacks.push(
        facts.evening_worth_using
          ? `The remaining window is ${facts.evening_window}, averaging ${facts.evening_window_average}, which is worth using.`
          : `The remaining window is ${facts.evening_window}, averaging ${facts.evening_window_average}, which is not worth acting on.`
      );
    }
    if (facts.day_usage && facts.day_cost) {
      fallbacks.push(
        `Today's usage came to ${facts.day_usage} at a cost of ${facts.day_cost}.`
      );
    }
    const price = priceFallback(facts);
    if (price !== null) fallbacks.push(price);
    // The recap budget is 4 sentences; the deterministic priorities are
    // achievements, the evening window, the day's usage and cost, and
    // only then the price recap.
    fallbacks.length = Math.min(fallbacks.length, 4);
    // A battery action survives the recap composition: when the day's
    // cheap hours have passed and the section still carries a worthwhile
    // battery action, its sentence composes with the recap sentences
    // (recap budget 5), so the fallback never reports the day without it.
    if (batteryAction) {
      fallbacks.push(batteryActionSentence(facts));
    }
  } else {
    const price = priceFallback(facts);
    if (price !== null) fallbacks.push(price);
    if (facts.cheap_window) {
      fallbacks.push(
        facts.day_average
          ? `The cheapest window is ${facts.cheap_window}, averaging ${facts.cheap_window_average} against a day average of ${facts.day_average}.`
          : `The cheapest window is ${facts.cheap_window}, averaging ${facts.cheap_window_average}.`
      );
    }
    if (actionAvailable) {
      if (batteryAction) {
        // The battery action's own deterministic sentence: the window and
        // the saving from the appliance facts verbatim. The generic
        // large-appliances imperative stays reserved for appliance
        // actions, and no supporting baseline sentence is needed - the
        // saving appears exactly once, here.
        fallbacks.push(batteryActionSentence(facts));
      } else {
        // The imperative register: the command speaks of the household's
        // large appliances, never names the specific appliance and never
        // carries the saving; it names the window and the price advantage.
        // The saving appears exactly once, in the supporting baseline
        // sentence with the named appliance and its measured load.
        const where =
          facts.appliance_window_start && facts.appliance_window_end
            ? `between ${facts.appliance_window_start} and ${facts.appliance_window_end}`
            : "in the cheap hours";
        const priceClause = facts.low_price
          ? `today's lowest price, about ${facts.low_price}/kWh`
          : facts.cheap_window_average
            ? `about ${facts.cheap_window_average}/kWh`
            : null;
        const averageClause = facts.day_average
          ? ` against a day average of ${facts.day_average}`
          : "";
        fallbacks.push(
          priceClause !== null
            ? `Run your large appliances ${where} to pay ${priceClause}${averageClause}.`
            : `Run your large appliances ${where}.`
        );
        fallbacks.push(
          facts.appliance_window
            ? `Your ${facts.appliance} used ${facts.appliance_load} today; shifting it into that window saves ${facts.appliance_saving}.`
            : `Your ${facts.appliance} used ${facts.appliance_load} today; shifting it saves ${facts.appliance_saving}.`
        );
      }
    } else {
      fallbacks.push(NO_OPPORTUNITY_STATEMENT);
      // The model never writes the pinned statement (the register guard
      // rejects it), so the composition always appends it to a quiet
      // day's accepted narrative.
      notes.push({
        required: NO_OPPORTUNITY_STATEMENT,
        append: NO_OPPORTUNITY_STATEMENT,
      });
    }
  }

  return {
    key: "today",
    label: "TODAY",
    mode: recap ? "recap" : "plan",
    facts,
    fallback_sentences: fallbacks,
    notes,
    budget: recap ? (batteryAction ? 5 : 4) : actionAvailable ? 5 : 3,
  };
}

function tomorrowSolarSentence(facts) {
  return facts.solar_today
    ? `The forecast is ${facts.solar_forecast} of sun, against ${facts.solar_today} today.`
    : `The forecast is ${facts.solar_forecast} of sun.`;
}

function buildTomorrowSection(tomorrowSection, rawFacts, beyondTomorrow) {
  const tmf = tomorrowSection.facts ?? {};
  const published = tmf.prices_published === true;

  const facts = { prices_published: published };
  // Tomorrow's weekday name, from the facts layer: the narrative uses it
  // verbatim and never guesses the day of the week.
  if (
    typeof rawFacts.tomorrow?.weekday === "string" &&
    rawFacts.tomorrow.weekday !== ""
  ) {
    facts.weekday = rawFacts.tomorrow.weekday;
  }
  const solar = kwhString(tmf.solar_kwh);
  if (solar !== null) facts.solar_forecast = solar;
  if (isNum(tmf.solar_score)) facts.solar_score = `${tmf.solar_score}`;
  if (typeof tmf.low_solar === "boolean") facts.low_solar = tmf.low_solar;
  const compare = kwhString(tmf.compare_solar_kwh);
  if (compare !== null) facts.solar_today = compare;
  // A low-solar tomorrow while prices are unpublished carries the hedged
  // grid-reliance note as a server-owned string the narrative may weave.
  const lowSolar = tmf.low_solar === true;
  if (lowSolar && !published) facts.grid_note = LOW_SOLAR_GRID_NOTE;
  if (published) {
    // The published day-ahead averages and window are facts-layer values,
    // served pre-formatted for a plain comparison with today.
    if (isNum(rawFacts.tomorrow?.averageEur)) {
      facts.average_price = formatEur(rawFacts.tomorrow.averageEur);
    }
    if (
      typeof rawFacts.tomorrow?.window === "string" &&
      rawFacts.tomorrow.window !== ""
    ) {
      addWindow(facts, "cheap_window", rawFacts.tomorrow.window);
    }
    // The cheapest window's own average, so a narrative never attaches
    // the day average to the window (formatted like the TODAY
    // equivalent).
    if (isNum(rawFacts.tomorrow?.windowAverageEur)) {
      facts.cheap_window_average = formatEur(
        rawFacts.tomorrow.windowAverageEur
      );
    }
    if (isNum(rawFacts.dayAverageEur)) {
      facts.today_average = formatEur(rawFacts.dayAverageEur);
    }
  }

  const fallbacks = [];
  // The hedged fallback sentence carrying the grid note, composed once
  // so the fallback and the parity append serve the identical string.
  const hedgedSolar = lowSolar
    ? facts.solar_forecast
      ? `${facts.solar_today
          ? `Little sun is forecast tomorrow: ${facts.solar_forecast} against ${facts.solar_today} today`
          : `Little sun is forecast tomorrow: ${facts.solar_forecast}`}, ${LOW_SOLAR_GRID_NOTE}.`
      : `Little sun is expected tomorrow, ${LOW_SOLAR_GRID_NOTE}.`
    : null;
  const notes = [];
  if (published) {
    if (facts.average_price && facts.today_average) {
      fallbacks.push(
        `Tomorrow averages ${facts.average_price} per kWh against ${facts.today_average} today.`
      );
    } else if (facts.average_price) {
      fallbacks.push(`Tomorrow averages ${facts.average_price} per kWh.`);
    } else {
      fallbacks.push("Tomorrow's prices are published.");
    }
    if (facts.solar_forecast) fallbacks.push(tomorrowSolarSentence(facts));
  } else {
    fallbacks.push(TOMORROW_UNPUBLISHED_SENTENCE);
    if (hedgedSolar !== null) {
      fallbacks.push(hedgedSolar);
    } else if (facts.solar_forecast) {
      fallbacks.push(tomorrowSolarSentence(facts));
    }
    // Content parity: the grid note must appear verbatim in the final
    // narrative. The grid note is a clause, so its append is the
    // composed sentence that carries it verbatim.
    if (lowSolar) {
      notes.push({ required: LOW_SOLAR_GRID_NOTE, append: hedgedSolar });
    }
  }
  // The horizon note (the owner decision of 22 October): the TOMORROW
  // section serves it whenever the payload carries sections beyond
  // tomorrow, regardless of tomorrow's publication status. It serves as
  // the final sentence of the fallback list, and the parity append
  // guarantees it as the final sentence of the served narrative; the
  // model may weave it from the facts, and a narrative is never
  // rejected for lacking it.
  if (beyondTomorrow) {
    facts.horizon_note = HORIZON_NOTE;
    fallbacks.push(HORIZON_NOTE);
    notes.push({ required: HORIZON_NOTE, append: HORIZON_NOTE });
  }

  return {
    key: "tomorrow",
    label: "TOMORROW",
    mode: "plan",
    facts,
    fallback_sentences: fallbacks,
    notes,
    budget: 3,
  };
}

function buildDaySections(comingDaysSection, tomorrowDate) {
  // A coming day dated tomorrow belongs to the TOMORROW section, never to
  // both (the outlook's "tomorrow wins" rule).
  const days = (comingDaysSection.days ?? []).filter(
    (d) => d.date !== tomorrowDate
  );
  const withSolar = days.filter((d) => isNum(d.solar_kwh));
  const maxSolar = withSolar.length > 0 ? Math.max(...withSolar.map((d) => d.solar_kwh)) : null;
  const minSolar = withSolar.length > 0 ? Math.min(...withSolar.map((d) => d.solar_kwh)) : null;

  return days.map((d) => {
    const label = String(d.weekday).slice(0, 3).toUpperCase();
    const facts = { weekday: d.weekday, date: d.date };
    if (typeof d.condition === "string" && d.condition !== "") {
      facts.condition = d.condition;
    }
    const solar = kwhString(d.solar_kwh);
    if (solar !== null) facts.solar_kwh = solar;
    if (isNum(d.solar_score)) facts.solar_score = `${d.solar_score}`;
    const isBest = isNum(d.solar_kwh) && d.solar_kwh === maxSolar;
    const isPoorest = isNum(d.solar_kwh) && d.solar_kwh === minSolar;
    facts.week_best = isBest;
    facts.week_poorest = isPoorest;

    const fallbacks = [];
    if (!isNum(d.solar_kwh)) {
      fallbacks.push(`${d.weekday} has no solar forecast yet.`);
    } else if (isBest && isPoorest && withSolar.length === 1) {
      fallbacks.push(`${d.weekday} brings ${facts.solar_kwh} of sun.`);
    } else if (isBest) {
      // The forecast framing stays: the figures are what is expected.
      fallbacks.push(
        facts.solar_score
          ? `${d.weekday} looks the best for solar: score ${facts.solar_score} and ${facts.solar_kwh} expected.`
          : `${d.weekday} looks the best for solar: ${facts.solar_kwh} expected.`
      );
    } else if (isPoorest) {
      fallbacks.push(
        `${d.weekday} looks like the week's weakest solar day at ${facts.solar_kwh}.`
      );
    } else {
      fallbacks.push(`${d.weekday} brings ${facts.solar_kwh} of sun.`);
    }
    // The day's advice (the owner decision of 22 October): judgments are
    // server-owned facts and the model narrates them. A rain-poorest day
    // carries the negative rain advice; any other weekday section whose
    // solar score reaches the threshold carries the positive advice,
    // the figure identical to the served solar_kwh fact. The negative
    // advice keeps precedence - a section never serves both. Parity
    // applies exactly as for the rain advice: the served advice must
    // appear verbatim in the narrative, and in the fallback it rides
    // as a sentence.
    const rainPoorest = facts.condition === "rain" && isPoorest;
    const positiveEligible =
      !rainPoorest &&
      isNum(d.solar_kwh) &&
      isNum(d.solar_score) &&
      d.solar_score >= POSITIVE_ADVICE_MIN_SOLAR_SCORE;
    const advice = rainPoorest
      ? RAIN_DAY_ADVICE
      : positiveEligible
        ? positiveSolarAdvice(facts.solar_kwh)
        : null;
    if (advice !== null) {
      facts.advice = advice;
      fallbacks.push(advice);
    }

    return {
      key: label.toLowerCase(),
      label,
      mode: "day",
      facts,
      fallback_sentences: fallbacks,
      notes: advice !== null ? [{ required: advice, append: advice }] : [],
      budget: advice !== null ? 2 : 1,
    };
  });
}

// Builds the monologue sections from the built sections (buildSections
// output) plus the raw facts. The payload facts carry pre-formatted
// figure strings only - the model copies, never computes.
export function buildMonologueSections(sections, rawFacts, now) {
  const list = Array.isArray(sections) ? sections : [];
  const f = sanitizeFacts(rawFacts ?? {});
  const t = parseLocalTime(now);
  const tomorrowDate = shiftDay(t, 1).dateStr;
  const out = [];
  const todaySection = list.find((s) => s.id === "today");
  const eveningSection = list.find((s) => s.id === "today_evening");
  const tomorrowSection = list.find((s) => s.id === "tomorrow");
  const comingDaysSection = list.find((s) => s.id === "coming_days");
  if (todaySection) {
    out.push(buildTodaySection(todaySection, eveningSection, f));
  }
  // The horizon note's serving condition (the owner decision of 22
  // October): the payload carries sections beyond tomorrow when the
  // coming days hold at least one day past tomorrow - the same
  // tomorrow-wins filter the day sections apply, so a coming day
  // dated tomorrow never counts.
  const comingDaysList = Array.isArray(comingDaysSection?.days)
    ? comingDaysSection.days
    : [];
  const beyondTomorrow = comingDaysList.some((d) => d.date !== tomorrowDate);
  if (tomorrowSection) {
    out.push(buildTomorrowSection(tomorrowSection, f, beyondTomorrow));
  }
  if (comingDaysSection) out.push(...buildDaySections(comingDaysSection, tomorrowDate));
  return out;
}

// ---------------------------------------------------------------------------
// The model prompt: the style brief verbatim, one section at a time with
// its own facts - and nothing else. No other section's facts, no wider
// day or week context: a section's fact set is self-contained by
// design. On a retry the prompt adds one feedback line carrying the
// previous attempt's rejection reasons verbatim (identical reasons
// deduplicated, order preserved), so the retry corrects instead of
// re-rolling blind. The stub is a parameter, never a network call.
// ---------------------------------------------------------------------------

export function buildSectionPrompt(section, rejectionReasons = null) {
  const lines = [
    MONOLOGUE_STYLE_BRIEF,
    "",
    `Write the ${section.label} section of the advisory.`,
    `Facts: ${JSON.stringify(section.facts)}`,
  ];
  const reasons = [
    ...new Set(Array.isArray(rejectionReasons) ? rejectionReasons : []),
  ];
  if (reasons.length > 0) {
    lines.push(
      `Your previous attempt was rejected for these reasons: ${reasons.join("; ")}. Write the section again, correcting exactly these issues; every figure must be a verbatim copy of a served fact of this section.`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Validation of one section narrative: the figure-verbatim check (figure
// membership in this section's fact set, plus the framing rule) replaces
// the figure ban for narrative text; every other narrative guard stays.
// ---------------------------------------------------------------------------

export function validateSectionNarrative(
  narrative,
  section,
  { tomorrowPublished = false } = {}
) {
  const text =
    typeof narrative === "string" && narrative.trim() !== "" ? narrative : null;
  if (text === null) return { ok: true, reasons: [] };
  const reasons = [...validateSectionFigures(text, section.facts).problems];
  for (const guard of [
    guardTomorrowPrice(text, { tomorrowPublished }),
    guardBeyondTomorrowPrice(text),
    guardArithmetic(text),
    guardInternalVocabulary(text),
    guardNonFiniteText(text),
    guardRegister(text),
    guardNoOpportunityPhrasing(text, {
      // The weekday-only no-opportunity ban (the owner decision of 22
      // October): a weekday narrative may never conclude there is
      // nothing worth doing from the condition alone, unless the
      // section's facts carry the served negative advice. TODAY and
      // TOMORROW are never touched by the ban.
      weekdaySection: section.mode === "day",
      negativeAdviceServed: section.facts?.advice === RAIN_DAY_ADVICE,
    }),
    guardWeekBestFraming(text, section.facts),
  ]) {
    reasons.push(...guard.problems);
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Orchestration: per section, one model call, validation, at most one
// retry, then the fallback sentences instead of a failing narrative.
// ---------------------------------------------------------------------------

async function narrativeFromStub(modelStub, prompt, key) {
  let output = null;
  try {
    output = await modelStub(prompt);
  } catch {
    return null; // a stub failure serves the fallback, never a crash
  }
  const narrative = output?.narratives?.[key];
  if (typeof narrative !== "string" || narrative.trim() === "") return null;
  // Whitespace collapse before storing and serving: a multi-line model
  // output becomes one flowing line (newlines, tabs and runs of spaces
  // all read as single spaces).
  return narrative.replace(/\s+/g, " ").trim();
}

// Content parity for server-owned notes: every note a section serves
// (grid_note, advice, the horizon statement, achievement lines, the
// no-opportunity statement) must appear verbatim in the final narrative.
// The model may weave a note in its own position; anything it did not
// weave is appended verbatim, so the narrative never carries less
// content than the fallback sentences. A note's `append` is the
// audit-safe sentence that carries it (the grid note is a clause, so it
// rides the composed hedged sentence).
function narrativeWithNotes(narrative, notes) {
  let text = narrative;
  for (const note of notes ?? []) {
    if (note.append !== null && !text.includes(note.required)) {
      text = `${text}${text.endsWith(" ") ? "" : " "}${note.append}`;
    }
  }
  return text;
}

export async function generateMonologue(sections, rawFacts, now, modelStub) {
  const monologueSections = buildMonologueSections(sections, rawFacts, now);
  const tomorrowPublished =
    (Array.isArray(sections) ? sections : []).find((s) => s.id === "tomorrow")
      ?.facts?.prices_published === true;

  const payload = [];
  const report = [];
  for (const section of monologueSections) {
    let offered = null;
    let verdict = { ok: true, reasons: [] };
    let served = false;
    let retried = false;
    // One entry per rejected attempt, so a fallback's log line can name
    // why each attempt was rejected, not just count them. The retry's
    // prompt carries the previous attempt's reasons verbatim, so the
    // second attempt corrects exactly what was rejected.
    const rejectedAttempts = [];
    for (let attempt = 0; attempt < 2 && !served; attempt += 1) {
      const feedback =
        attempt > 0 && rejectedAttempts.length > 0
          ? rejectedAttempts[rejectedAttempts.length - 1].reasons
          : null;
      const prompt = buildSectionPrompt(section, feedback);
      offered = await narrativeFromStub(modelStub, prompt, section.key);
      if (offered === null) break; // nothing offered: serve the fallback
      if (attempt > 0) retried = true;
      verdict = validateSectionNarrative(offered, section, {
        tomorrowPublished,
      });
      if (verdict.ok) {
        served = true;
      } else {
        rejectedAttempts.push({
          attempt: attempt + 1,
          reasons: [...verdict.reasons],
        });
      }
    }
    const narrative =
      served && offered !== null
        ? narrativeWithNotes(offered, section.notes)
        : null;
    const servedText =
      narrative ?? section.fallback_sentences.join(" ");
    payload.push({
      label: section.label,
      narrative,
      fallback_sentences: section.fallback_sentences,
      facts: section.facts,
    });
    report.push({
      key: section.key,
      label: section.label,
      mode: section.mode,
      budget: section.budget,
      offered: offered !== null,
      ok: offered === null ? true : verdict.ok,
      reasons: offered === null ? [] : verdict.reasons,
      rejected_attempts: rejectedAttempts,
      retried,
      sentenceCount: splitSentences(servedText).length,
    });
  }
  return { payload, sections: report };
}
