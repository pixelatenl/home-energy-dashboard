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

// One row of the advisory card: the eyebrow day chip and the
// right-side value chip, the lead sentence, its supporting lines and
// optional trailing furniture. The muted flag marks guidance-class
// rows - the foundation for the composition modes; the current
// renderer applies one style to every row.
export type AdvisorySupport = { text: string; tabular?: boolean }

export type AdvisoryFooter =
  | { kind: "confidence"; label: string }
  | { kind: "note"; text: string }

export type AdvisoryCardRow = {
  chip: string
  valueChip: string | null
  sentence: string
  supporting: AdvisorySupport[]
  muted: boolean
  footer?: AdvisoryFooter
}

export type AdvisoryContent = {
  rows: AdvisoryCardRow[]
  // The largest belowThreshold candidate in the no-opportunity state,
  // rendered as the single muted fact line with its true amount.
  largestOpportunity: { label: string; savingEur: number } | null
  // The horizon note renders exactly when the outlook extends beyond
  // tomorrow.
  showOutlookNote: boolean
  // The context note is quiet-day explaining: it renders only when no
  // real action exists. On action days the basis line does the
  // explaining and the note is omitted entirely.
  contextNote: string | null
}

// Builds the advisory card's content for the current insight: the
// ordered row list, the largest-opportunity line and the note flags.
// Every wording rule lives here or in the sentence helpers it calls -
// the renderer stays generic. The composition reads as a timeline:
// TODAY (the action row, the card's only imperative when a real
// action exists, then the guidance row - suppressed when the action
// already carries its window, the plain timing fact otherwise),
// TOMORROW (the advisory row), then the noteworthy days beyond
// tomorrow in calendar order, earliest first. The best-day
// designation travels with whichever day earns it, wherever it falls
// in the order.
export function buildAdvisoryContent(
  insight: SummaryInsight,
): AdvisoryContent {
  const primary = insight.primary_action ?? null
  const noOpportunity =
    primary !== null && (insight.no_opportunity ?? primary.saving_eur === 0)
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

  const rows: AdvisoryCardRow[] = []

  if (showActionRow && primary !== null) {
    rows.push({
      chip: "Today",
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
      // With a real action the guidance row carries no command - the
      // plain timing fact, labeled by whether the window is the day's
      // absolute cheapest.
      rows.push({
        chip: "Today",
        valueChip,
        sentence: `${windowIsDayCheapest(guidanceLine.window, guidanceLine) ? "Cheapest window today: " : "Cheapest remaining window: "}${guidanceLine.window.replace(" today", "")} at ${humanEur(guidanceLine.cheapest_window_average_eur)} average`,
        supporting: [],
        muted: true,
      })
    } else if (guidanceLine.practical) {
      rows.push({
        chip: "Today",
        valueChip,
        sentence: todayImperative(guidanceLine.window, guidanceLine),
        supporting: [
          {
            text: `cheapest remaining window \u00b7 ${
              guidanceLine.day_average_eur !== null
                ? `${humanEur(
                    guidanceLine.day_average_eur -
                      guidanceLine.cheapest_window_average_eur,
                  )}/kWh below the day's average of ${humanEur(
                    guidanceLine.day_average_eur,
                  )}`
                : "the best hours left"
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
      rows.push({
        chip: "Today",
        valueChip,
        sentence: `Today's cheap hours (${guidanceLine.day_cheapest_window}) have passed`,
        supporting: [],
        muted: true,
      })
    } else {
      // The evening price situation (Phase E): the day's cheap hours
      // are still ahead tonight but the pivot blocks the command, so
      // the row states the evening honestly against live references.
      // The number lives in the sentence; no value chip.
      rows.push({
        chip: "Today",
        valueChip: null,
        sentence: eveningPriceSentence(guidanceLine),
        supporting: [],
        muted: true,
      })
    }
  }

  if (advisory) {
    // The TOMORROW row always renders when the advisory object exists
    // (forecast data present); the prefer chip appears only when a
    // trigger fired. The informational row carries no command: no
    // recommendation, no imperative.
    const informational = advisory.triggered === false
    const unpublished = advisory.tomorrow_average_eur === null
    // The hedged low-solar mode (Phase E): the forecast fact is the
    // sentence, the hedged market expectation the second line, and
    // the horizon note is subsumed by it.
    const lowSolar =
      informational && unpublished && advisory.tomorrow_low_solar
    // Today commands through the action row or the guidance row; the
    // evening delay advice (Phase E) is the imperative transferred to
    // tomorrow, so it renders only when today offers nothing - and a
    // defer trigger (an even better later day) supersedes it.
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
          : `tomorrow ${advisoryNumbers(advisory.tomorrow_average_eur, advisory.tomorrow_solar_kwh)} vs today ${advisoryNumbers(advisory.compare_average_eur, advisory.compare_solar_kwh)}`,
      tabular: true,
    }
    rows.push({
      chip:
        informational || delayFires
          ? "Tomorrow"
          : advisoryDayChipLabel(advisory),
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
        : sentenceForAdvisory(
            advisory,
            !actionCommand &&
              (!guidanceLine || guidanceLine.practical === false),
          ),
      // The numbers line is price-led; on the solar-alone row it
      // would duplicate the sentence, so it renders only when the
      // prices are published. The low-solar row carries the hedged
      // market note plus the numbers grounding it.
      supporting: lowSolar
        ? [{ text: LOW_SOLAR_MARKET_NOTE }, numbersLine]
        : informational && unpublished
          ? []
          : [numbersLine],
      muted: true,
      footer:
        advisory.horizon_note && !lowSolar
          ? { kind: "note", text: advisory.horizon_note }
          : undefined,
    })
  }

  // The noteworthy days beyond tomorrow render in calendar order:
  // Friday before Sunday, always the earliest upcoming day first.
  // The best-day designation stays attached to whichever day earns
  // it, wherever it falls in the order.
  const noteworthy: { date: string; row: AdvisoryCardRow }[] = []
  if (showBestDay && bestDay) {
    noteworthy.push({
      date: bestDay.date,
      row: {
        chip: bestDay.weekday_short,
        valueChip: null,
        // The qualitative solar language grounded in the score (Phase
        // E): "looks good" only when the score backs it; otherwise the
        // honest "week's best" without the overclaim.
        sentence:
          bestDay.solar_score !== null
            ? bestDay.good
              ? `${bestDay.weekday} looks good for solar: score ${bestDay.solar_score}, ${humanNumber(bestDay.solar_kwh)} kWh expected`
              : `${bestDay.weekday} brings the week's best solar: score ${bestDay.solar_score}, ${humanNumber(bestDay.solar_kwh)} kWh expected`
            : `${bestDay.weekday} looks even better: ${humanNumber(bestDay.solar_kwh)} kWh of your own solar expected`,
        supporting: [],
        muted: true,
      },
    })
  }
  if (poorDay) {
    noteworthy.push({
      date: poorDay.date,
      row: {
        chip: poorDay.weekday_short,
        valueChip: null,
        sentence: `${poorDay.weekday} brings ${poorDay.condition} and ${
          bestDay !== null &&
          bestDay.solar_kwh > 0 &&
          poorDay.solar_kwh < bestDay.solar_kwh * 0.35
            ? `almost no solar of your own, ${humanNumber(poorDay.solar_kwh)} kWh`
            : `${humanNumber(poorDay.solar_kwh)} kWh of your own solar`
        }`,
        supporting: [{ text: "avoid planning large appliances then" }],
        muted: true,
      },
    })
  }
  noteworthy.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const entry of noteworthy) {
    rows.push(entry.row)
  }

  return {
    rows,
    largestOpportunity:
      noOpportunity && largestBelowThreshold !== null
        ? {
            label: largestBelowThreshold.label,
            savingEur: largestBelowThreshold.saving_eur,
          }
        : null,
    showOutlookNote,
    contextNote: noOpportunity ? (insight.context_note ?? null) : null,
  }
}
