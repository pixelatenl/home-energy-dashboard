import type { SummaryInsight } from "@/lib/api"
import {
  delaySentence,
  eveningPriceSentence,
  humanEur,
  humanNumber,
  humanizeEurInText,
  LOW_SOLAR_MARKET_NOTE,
  peakAvoidanceLine,
  sentenceForAdvisory,
  todayImperative,
  windowIsDayCheapest,
} from "./advisoryText.ts"

// The advisory card's row builder: pure data in, row list out. The
// renderer stays generic and the wording lives here and in the
// sentence helpers - so the composition is testable without JSX.

// The advisory row's day chip: the recommended day - tomorrow for an
// advance, the compare day (today or the weekday) for a defer.
function advisoryDayChipLabel(advisory: {
  type: "defer" | "advance"
  compare_day: string
}): string {
  if (advisory.type === "advance") {
    return "Tomorrow"
  }
  if (advisory.compare_day === "today") {
    return "Today"
  }
  return advisory.compare_day.slice(0, 3)
}

// The advisory row's day-level numbers at human precision, skipping
// unavailable parts.
function advisoryNumbers(avg: number | null, solar: number | null): string {
  return [
    avg !== null ? `${humanEur(avg)} avg` : null,
    solar !== null ? `${humanNumber(solar)} kWh solar` : null,
  ]
    .filter((part) => part !== null)
    .join(" \u00b7 ")
}

// One piece of advice inside a day card: the lead sentence with its
// right-side value chip, its supporting lines and optional trailing
// furniture. The muted flag marks guidance-class items - the
// foundation for the composition modes; the current renderer applies
// one style to every item.
export type AdvisorySupport = { text: string; tabular?: boolean }

export type AdvisoryFooter =
  | { kind: "confidence"; label: string }
  | { kind: "note"; text: string }

export type AdvisoryItem = {
  valueChip: string | null
  sentence: string
  supporting: AdvisorySupport[]
  muted: boolean
  footer?: AdvisoryFooter
}

// One day of the advisory timeline: every piece of advice for that
// day grouped inside a single card, the day chip carrying the
// timeline position.
export type AdvisoryDayCard = {
  chip: string
  items: AdvisoryItem[]
}

export type AdvisoryContent = {
  // The day cards in calendar order: today, tomorrow, then the
  // noteworthy days beyond, one card per day - never two cards for
  // the same day.
  cards: AdvisoryDayCard[]
  // The horizon note renders exactly when the outlook extends beyond
  // tomorrow.
  showOutlookNote: boolean
}

// Builds the advisory card's content for the current insight: the
// day cards in calendar order. Every wording rule lives here or in
// the sentence helpers it calls - the renderer stays generic. The
// composition reads as a timeline of days: the TODAY card (the action
// item, the card's only imperative when a real action exists, then
// the guidance item - suppressed when the action already carries its
// window - and, on quiet days, the largest-opportunity and context
// items), then one card per future day - tomorrow's advisory and the
// noteworthy best and poor days merged into a single card when they
// name the same day, ordered by calendar date, earliest first. The
// best-day designation travels with whichever day earns it, wherever
// it falls in the order.
export function buildAdvisoryContent(
  insight: SummaryInsight,
): AdvisoryContent {
  const primary = insight.primary_action ?? null
  // The honest no-opportunity signal comes from the payload flag, also
  // when the advisory core serves no primary action at all (a quiet day
  // carries no action to render, but the quiet-day rows still do).
  const noOpportunity =
    insight.no_opportunity === true ||
    (primary !== null && (insight.no_opportunity ?? primary.saving_eur === 0))
  const belowThreshold = (insight.candidates ?? []).filter(
    (candidate) => candidate.below_threshold,
  )
  const largestBelowThreshold =
    belowThreshold.length > 0
      ? belowThreshold.reduce((best, candidate) =>
          candidate.saving_eur > best.saving_eur ? candidate : best,
        )
      : null
  const advisory = insight.advisory ?? null
  const guidanceLine = insight.guidance ?? null
  const outlook = insight.outlook ?? null
  const tomorrowOutlook = outlook?.days[0] ?? null
  const bestDay = outlook?.best_solar_day ?? null
  const poorDay = outlook?.poor_day ?? null
  const showBestDay =
    bestDay !== null &&
    tomorrowOutlook !== null &&
    bestDay.weekday !== tomorrowOutlook.weekday &&
    bestDay.solar_kwh >= tomorrowOutlook.solar_kwh * 1.2
  const showOutlookNote = (outlook?.days.length ?? 0) > 1

  // The action row renders when a real action exists, or when the card
  // has nothing else to say: with guidance or advisory content present
  // the honest no-opportunity box is omitted entirely.
  const showActionRow = !noOpportunity || (!guidanceLine && !advisory)
  const actionCandidate = noOpportunity
    ? largestBelowThreshold
    : ((insight.candidates ?? []).find(
        (candidate) =>
          primary !== null &&
          Math.abs(candidate.saving_eur - primary.saving_eur) < 0.005,
      ) ?? null)
  const actionDescription =
    actionCandidate?.basis ??
    (noOpportunity && (insight.candidates ?? []).length === 0
      ? "no appliance loads measured today"
      : (primary?.when ?? ""))
  // Single imperative: with a real action the action row is the card's
  // only command. Its title composes deterministically in appliance
  // classes; the specific appliance and its measured load live in the
  // server-computed basis line.
  const actionCommand = !noOpportunity && actionCandidate !== null
  const actionTitle = actionCommand
    ? todayImperative(actionCandidate.window, guidanceLine)
    : (primary?.what ?? "")
  // The generic guidance row then drops its imperative: it does not
  // render when the action already carries its window.
  const guidanceSuppressed =
    actionCommand &&
    guidanceLine !== null &&
    actionCandidate.window.replace(" today", "") ===
      guidanceLine.window.replace(" today", "")

  const todayItems: AdvisoryItem[] = []

  // The grounded price facts lead the Today block: the served price
  // sentence, verbatim - the frontend composes nothing - at full
  // description weight in the card's fact register (muted), no
  // chip, no supporting lines. Omitted cleanly when the price
  // fields are missing.
  if (insight.priceSentence) {
    todayItems.push({
      valueChip: null,
      sentence: insight.priceSentence,
      supporting: [],
      muted: true,
    })
  }

  if (showActionRow && primary !== null) {
    todayItems.push({
      valueChip: !noOpportunity
        ? `${humanEur(primary.saving_eur)} potential savings`
        : null,
      sentence: actionTitle,
      supporting: [
        { text: humanizeEurInText(actionDescription) },
        // The peak-avoidance line while the day's peak is still ahead
        // (Phase E): a live reference, gone once the peak has passed.
        ...(actionCommand && guidanceLine !== null && guidanceLine.peak_ahead
          ? [{ text: peakAvoidanceLine(guidanceLine), tabular: true }]
          : []),
      ],
      muted: false,
      footer: { kind: "confidence", label: primary.confidence },
    })
  }

  if (guidanceLine && !guidanceSuppressed) {
    const windowAvg = guidanceLine.practical
      ? guidanceLine.cheapest_window_average_eur
      : (guidanceLine.day_cheapest_average_eur ??
        guidanceLine.cheapest_window_average_eur)
    const valueChip = `${humanEur(windowAvg)}/kWh in the cheap hours`
    // The peak-avoidance line joins the commanding row (Phase E).
    const peakLine = guidanceLine.peak_ahead
      ? [{ text: peakAvoidanceLine(guidanceLine), tabular: true }]
      : []
    if (actionCommand) {
      // With a real action the guidance item carries no command - the
      // plain timing fact, labeled by whether the window is the day's
      // absolute cheapest.
      todayItems.push({
        valueChip,
        sentence: `${windowIsDayCheapest(guidanceLine.window, guidanceLine) ? "Cheapest window today: " : "Cheapest remaining window: "}${guidanceLine.window.replace(" today", "")} at ${humanEur(guidanceLine.cheapest_window_average_eur)} average`,
        supporting: [],
        muted: true,
      })
    } else if (guidanceLine.practical) {
      todayItems.push({
        valueChip,
        sentence: todayImperative(guidanceLine.window, guidanceLine),
        supporting: [
          {
            text: `Cheapest remaining window \u00b7 ${
              guidanceLine.day_average_eur !== null
                ? `${humanEur(
                    guidanceLine.day_average_eur -
                      guidanceLine.cheapest_window_average_eur,
                  )}/kWh below the day's average of ${humanEur(
                    guidanceLine.day_average_eur,
                  )}`
                : "The best hours left"
            }`,
            tabular: true,
          },
          ...peakLine,
        ],
        muted: false,
      })
    } else if (guidanceLine.day_cheapest_passed) {
      // The day's cheap hours are actually gone: the plain fact in
      // muted planning register.
      todayItems.push({
        valueChip,
        sentence: `Today's cheap hours (${guidanceLine.day_cheapest_window}) have passed`,
        supporting: [],
        muted: true,
      })
    } else {
      // The evening price situation (Phase E): the day's cheap hours
      // are still ahead tonight but the pivot blocks the command, so
      // the item states the evening honestly against live
      // references. The number lives in the sentence; no value chip.
      todayItems.push({
        valueChip: null,
        sentence: eveningPriceSentence(guidanceLine),
        supporting: [],
        muted: true,
      })
    }
  }

  // The deterministic achievement sentences (contract section 4):
  // recap mode only, served verbatim - the sentences carry their own
  // periods. Muted recap rows in the Today block, in the existing
  // glass row language: no chip, no icons, no punctuation changes. An
  // empty or absent array renders nothing, with no layout shift.
  for (const sentence of insight.achievements ?? []) {
    todayItems.push({
      valueChip: null,
      sentence,
      supporting: [],
      muted: true,
    })
  }

  // The quiet-day summary as full items on the Today card, in the
  // same glass register as the rest - not loose fine print below the
  // rows: the largest below-threshold candidate with its true amount,
  // then the context explaining.
  if (noOpportunity) {
    if (largestBelowThreshold !== null) {
      todayItems.push({
        valueChip: humanEur(largestBelowThreshold.saving_eur),
        sentence: `Largest opportunity today: ${largestBelowThreshold.label}`,
        supporting: [],
        muted: true,
      })
    }
    const contextNote = insight.context_note ?? null
    if (contextNote !== null) {
      todayItems.push({
        valueChip: null,
        sentence: humanizeEurInText(contextNote),
        supporting: [],
        muted: true,
      })
    }
  }

  // The future days' advice, keyed by calendar date so every piece of
  // advice naming one day lands in that day's single card.
  type PendingDay = { key: string; chip: string; item: AdvisoryItem }
  const pending: PendingDay[] = []

  if (advisory) {
    // The TOMORROW item always renders when the advisory object
    // exists (forecast data present); the prefer chip appears only
    // when a trigger fired. The informational item carries no
    // command: no recommendation, no imperative.
    const informational = advisory.triggered === false
    const unpublished = advisory.tomorrow_average_eur === null
    // The hedged low-solar mode (Phase E): the forecast fact is the
    // sentence, the hedged market expectation the second line, and
    // the horizon note is subsumed by it.
    const lowSolar =
      informational && unpublished && advisory.tomorrow_low_solar
    // Today commands through the action item or the guidance item;
    // the evening delay advice (Phase E) is the imperative
    // transferred to tomorrow, so it renders only when today offers
    // nothing - and a defer trigger (an even better later day)
    // supersedes it.
    const todayCommands =
      actionCommand || (guidanceLine !== null && guidanceLine.practical)
    const delayData =
      todayCommands || (advisory.triggered && advisory.type === "defer")
        ? null
        : (guidanceLine?.delay ?? null)
    const delayFires = delayData !== null
    const numbersLine = {
      text:
        advisory.type === "defer"
          ? `${advisoryNumbers(advisory.compare_average_eur, advisory.compare_solar_kwh)} vs tomorrow ${advisoryNumbers(advisory.tomorrow_average_eur, advisory.tomorrow_solar_kwh)}`
          : `Tomorrow ${advisoryNumbers(advisory.tomorrow_average_eur, advisory.tomorrow_solar_kwh)} vs today ${advisoryNumbers(advisory.compare_average_eur, advisory.compare_solar_kwh)}`,
      tabular: true,
    }
    // The description line: the server-composed narrative is the
    // single writer - one sentence about what the figures MEAN
    // (cheaper or pricier, more or less solar), complementing the
    // numbers line, which carries the exact comparison. The local
    // composer is only the fallback for payloads that carry no
    // narrative (never two writers for one sentence), and the delay
    // advice keeps its imperative - it is the transferred command,
    // not the description.
    const narrative =
      typeof advisory.line === "string" && advisory.line.trim() !== ""
        ? advisory.line
        : null
    const advisoryItem: AdvisoryItem = {
      valueChip: delayFires
        ? "prefer tomorrow"
        : informational
          ? null
          : advisory.type === "defer" &&
              advisory.price_difference_per_kwh !== null
            ? `${humanEur(Math.abs(advisory.price_difference_per_kwh))}/kWh cheaper`
            : advisory.type === "defer"
              ? "prefer this day"
              : "prefer tomorrow",
      sentence: delayFires
        ? delaySentence(delayData)
        : (narrative ??
          sentenceForAdvisory(
            advisory,
            !actionCommand &&
              (!guidanceLine || guidanceLine.practical === false),
          )),
      // The narrative never restates the figures, so the compact
      // comparison always carries them - the exact numbers line,
      // unchanged - with the hedged market note above it on the
      // low-solar card.
      supporting: lowSolar
        ? [{ text: LOW_SOLAR_MARKET_NOTE }, numbersLine]
        : [numbersLine],
      muted: true,
      footer:
        advisory.horizon_note && !lowSolar
          ? { kind: "note", text: advisory.horizon_note }
          : undefined,
    }
    const advisoryChip =
      informational || delayFires ? "Tomorrow" : advisoryDayChipLabel(advisory)
    if (advisoryChip === "Today") {
      // A defer comparing against today belongs to the Today card.
      todayItems.push(advisoryItem)
    } else {
      // Tomorrow sorts first among the dated days; a defer's
      // comparison day takes its own calendar date from the outlook.
      pending.push({
        key:
          advisoryChip === "Tomorrow"
            ? "0 tomorrow"
            : ((outlook?.days ?? []).find(
                (day) => day.weekday === advisory.compare_day,
              )?.date ?? `~${advisoryChip}`),
        chip: advisoryChip,
        item: advisoryItem,
      })
    }
  }

  // The noteworthy days beyond tomorrow: the best-day designation and
  // the poor day keep their own dates, merging into the same card as
  // any defer advice naming the same day.
  if (showBestDay && bestDay) {
    pending.push({
      key: bestDay.date,
      chip: bestDay.weekday_short,
      item: {
        valueChip: null,
        // The server-composed narrative description, rendered
        // verbatim - the single writer. The local composition is only
        // the fallback for payloads that carry no line.
        sentence:
          bestDay.line ??
          (bestDay.solar_score !== null
            ? bestDay.good
              ? `${bestDay.weekday} looks good for solar: score ${bestDay.solar_score}, ${humanNumber(bestDay.solar_kwh)} kWh expected`
              : `${bestDay.weekday} brings the week's best solar: score ${bestDay.solar_score}, ${humanNumber(bestDay.solar_kwh)} kWh expected`
            : `${bestDay.weekday} looks even better: ${humanNumber(bestDay.solar_kwh)} kWh of your own solar expected`),
        supporting: [],
        muted: true,
      },
    })
  }
  if (poorDay) {
    pending.push({
      key: poorDay.date,
      chip: poorDay.weekday_short,
      item: {
        valueChip: null,
        // The server-composed narrative description, rendered
        // verbatim - the single writer. The local composition is only
        // the fallback for payloads that carry no line.
        sentence:
          poorDay.line ??
          `${poorDay.weekday} brings ${poorDay.condition} and ${
            bestDay !== null &&
            bestDay.solar_kwh > 0 &&
            poorDay.solar_kwh < bestDay.solar_kwh * 0.35
              ? `almost no solar of your own, ${humanNumber(poorDay.solar_kwh)} kWh`
              : `${humanNumber(poorDay.solar_kwh)} kWh of your own solar`
          }`,
        // The advice line is served server-composed - reason and
        // guidance in one narrative sentence, deterministic from the
        // outlook data; the capitalized fragment stays only as the
        // fallback for payloads that carry no advice line.
        supporting: [
          { text: poorDay.advice ?? "Avoid planning large appliances then" },
        ],
        muted: true,
      },
    })
  }

  // Calendar order, earliest first - never by prominence: the sort
  // keys are dates (tomorrow's "0 tomorrow" prefix sorts before the
  // ISO dates; a defer day missing from the outlook sorts last), and
  // consecutive entries naming the same day merge into one card.
  pending.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const cards: AdvisoryDayCard[] = []
  if (todayItems.length > 0) {
    cards.push({ chip: "Today", items: todayItems })
  }
  let current: AdvisoryDayCard | null = null
  for (const entry of pending) {
    if (current === null || current.chip !== entry.chip) {
      current = { chip: entry.chip, items: [] }
      cards.push(current)
    }
    current.items.push(entry.item)
  }

  return {
    cards,
    showOutlookNote,
  }
}
