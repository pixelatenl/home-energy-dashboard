import type { ReactNode } from "react"
import {
  BatteryCharging,
  Car,
  Sparkles,
  Sun,
  TriangleAlert,
  WashingMachine,
  Zap,
} from "lucide-react"
import {
  isStructuredAction,
  type InsightAction,
  type InsightActionType,
  type LegacyInsightAction,
  type StructuredInsightAction,
  type SummaryInsight as SummaryInsightData,
} from "@/lib/api"
import { dateKeyPlus, todayInAmsterdam } from "@/lib/time"

// Icon per structured action type.
const TYPE_ICONS: Record<InsightActionType, typeof Zap> = {
  appliance: WashingMachine,
  battery: BatteryCharging,
  ev: Car,
  solar: Sun,
  general: Zap,
}

// Figures in the summary text (kWh, prices, percentages) rendered as
// chips. "EUR 3.76", "€ 3.76", "0.21 EUR/kWh", "12.1 kWh", "80%".
const FIGURE_PATTERN =
  /(€\s?\d[\d.,]*(?:\s?EUR\/kWh)?|EUR\s?\d[\d.,]*(?:\s?EUR\/kWh)?|\d[\d.,]*\s?(?:kWh|EUR\/kWh|kWp|kW|Wh|W|%))/g

// Renders the summary paragraph with its key figures in bold.
function SummaryText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(FIGURE_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) {
      nodes.push(text.slice(last, start))
    }
    nodes.push(
      <span key={start} className="font-semibold tabular-nums">
        {match[0].trim()}
      </span>
    )
    last = start + match[0].length
  }
  if (last < text.length) {
    nodes.push(text.slice(last))
  }
  return <p className="mt-2 text-sm leading-relaxed">{nodes}</p>
}

// "Today", "Tomorrow" or "Tue 13 Oct" for a local date key.
function dayChipLabel(date: string): string {
  const today = todayInAmsterdam()
  if (date === today) {
    return "Today"
  }
  if (date === dateKeyPlus(today, 1)) {
    return "Tomorrow"
  }
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
}

// One shared glass definition for the whole advisory surface: 15
// percent translucent white, white text and a soft backdrop blur. The
// rows carry the subtle translucent white border; the chips render
// borderless on top of them. Defined once, never per instance.
const GLASS_SURFACE =
  "border border-white/20 bg-white/15 text-white backdrop-blur-sm"
const GLASS_ITEM = `flex items-center gap-3 rounded-xl p-3 ${GLASS_SURFACE}`
// The structured advisory rows: a column block whose day chip sits on
// its own line above the main text, like the compact widgets'
// label-above-content pattern, so every row's text starts on one
// vertical line.
const GLASS_BLOCK = `flex flex-col gap-1.5 rounded-xl p-3 ${GLASS_SURFACE}`
const GLASS_CHIP = "rounded-full bg-white/15 text-white backdrop-blur-sm"

// Honest saving precision: a nonzero saving never renders as 0.00.
// Two decimals at 0.10 EUR and above; the smallest exact decimals
// below, so 0.0035 stays 0.0035. The headline is the only place the
// saving is formatted - one quantity, one number.
// Money format for every monetary value in the card: the euro sign
// always, two decimals at 0.10 and above, and the smallest exact
// decimals below so a nonzero value never renders as 0.00. Full
// precision stays in the payload and the debug view.
function humanEur(value: number): string {
  if (value === 0) {
    return "\u20AC 0.00"
  }
  const amount =
    Math.abs(value) >= 0.1
      ? value.toFixed(2)
      : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `\u20AC ${amount}`
}

// Humanizes the euro amounts inside a precomposed payload string (the
// candidate basis, the model's facts and notes): "EUR 0.2671/kWh"
// becomes "\u20AC 0.27/kWh", and any four-decimal number - debug
// precision - clamps to two. Non-monetary numbers are untouched.
function humanizeEurInText(text: string): string {
  return text
    .replace(/(?:EUR|\u20ac)\s?([\d.]+)/g, (_, amount) =>
      humanEur(Number(amount))
    )
    .replace(/([\d.]+)\s?(?:EUR|\u20ac)/g, (_, amount) =>
      humanEur(Number(amount))
    )
    .replace(/\b(\d+\.\d{4})\b/g, (_, amount) => Number(amount).toFixed(2));
}

// Human precision for the card's numbers: at most three decimals,
// trailing zeros trimmed, so 0.364494 renders as 0.364 and 14.29 as
// 14.29. The exact values stay in the payload and the debug view.
function humanNumber(value: number): string {
  return value
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
}

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

// A designed structured-action row: day chip above the window on the
// left, the type icon, title and reason in the middle, the price tag on
// the right, and a subtle "next" badge on the nearest upcoming action.
function ActionRow({
  action,
  isNext,
}: {
  action: StructuredInsightAction
  isNext: boolean
}) {
  const Icon = TYPE_ICONS[action.type] ?? Zap
  return (
    <div className={GLASS_ITEM}>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <span
          className={`whitespace-nowrap px-2 py-0.5 text-xs font-medium ${GLASS_CHIP}`}
        >
          {dayChipLabel(action.date)}
        </span>
        <span className="whitespace-nowrap text-sm font-semibold leading-none tabular-nums">
          {action.start} - {action.end}
        </span>
      </div>
      <Icon className="size-5 shrink-0 text-white" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium leading-snug">
            {action.title}
          </span>
          {isNext && (
            <span
              className={`px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${GLASS_CHIP}`}
            >
              next
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-white">
          {action.reason}
        </p>
      </div>
      {action.price_eur != null && (
        <span
          className={`shrink-0 px-2 py-1 text-xs font-medium tabular-nums ${GLASS_CHIP}`}
        >
          {action.price_eur.toFixed(2)} EUR/kWh
        </span>
      )}
    </div>
  )
}

// Legacy prose fallback: the window in bold with its day-label chip.
const DAY_LABEL_PATTERN = /^(Today|Tomorrow)\s*\(([^)]+)\)\s*/
const WEEKDAY_DATE_PATTERN = /^([A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2})\s+/

function LegacyActionRow({ action }: { action: LegacyInsightAction }) {
  const labeled = action.window.match(DAY_LABEL_PATTERN)
  const dated = labeled ? null : action.window.match(WEEKDAY_DATE_PATTERN)
  const dayLabel = labeled
    ? `${labeled[1]} (${labeled[2]})`
    : dated
      ? dated[1]
      : null
  const window = dayLabel
    ? action.window.slice((labeled ?? dated)?.[0].length ?? 0)
    : action.window
  return (
    <li className="text-sm leading-relaxed">
      {dayLabel && (
        <span
          className={`mr-1.5 inline-flex items-center px-2 py-0.5 text-xs font-medium ${GLASS_CHIP}`}
        >
          {dayLabel}
        </span>
      )}
      <span className="font-semibold tabular-nums">{window}</span>
      {" \u2014 "}
      {action.text}
      {action.reason && (
        <span className="text-white"> ({action.reason})</span>
      )}
    </li>
  )
}

// Daily AI summary at the top of the page, in two renderings: the C1b
// decision insight (primary_action present) shows the primary action
// as the lead line on the shared glass with the saving highlighted and
// honest precision, the confidence as a subtle label, the euro-first
// supporting facts as compact lines and an optional amber warning; an
// old plain-text insight renders exactly as before - the summary text
// with its key figures, designed action rows and prose fallback list.
// The data is owned by the page, which refreshes it on the 5-minute
// panel cycle; the "insight from" stamp, the stale marker and the
// force-refresh control live in the page header.
function SummaryInsight({
  insight,
  loading,
}: {
  insight: SummaryInsightData | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div
        className="h-full min-h-36 animate-pulse rounded-lg bg-muted"
        aria-hidden="true"
      />
    )
  }

  if (!insight?.summary) {
    return null
  }

  const structured: StructuredInsightAction[] = []
  const legacy: LegacyInsightAction[] = []
  for (const action of insight.actions) {
    if (isStructuredAction(action)) {
      structured.push(action)
    } else {
      legacy.push(action)
    }
  }

  // Group structured actions by day, preserving the server's ascending
  // order; headings appear only when actions span multiple days.
  const groups: { label: string; items: StructuredInsightAction[] }[] = []
  for (const action of structured) {
    const label = dayChipLabel(action.date)
    let group = groups.find((entry) => entry.label === label)
    if (!group) {
      group = { label, items: [] }
      groups.push(group)
    }
    group.items.push(action)
  }
  const showHeadings = groups.length > 1
  // The nearest upcoming action: the earliest by date and start time
  // (the server has already dropped past windows).
  const nextKey = structured.length
    ? `${structured[0].date}T${structured[0].start}`
    : null

  // The honest no-opportunity state: every candidate belowThreshold or
  // none exists, signalled by the server; a zero saving is the
  // fallback for payloads predating the flag.
  const primary = insight.primary_action ?? null
  const noOpportunity =
    primary !== null && (insight.no_opportunity ?? primary.saving_eur === 0)
  // The largest belowThreshold candidate, rendered as the single muted
  // fact line in the no-opportunity state.
  const belowThreshold = (insight.candidates ?? []).filter(
    (candidate) => candidate.below_threshold
  )
  const largestBelowThreshold =
    belowThreshold.length > 0
      ? belowThreshold.reduce((best, candidate) =>
          candidate.saving_eur > best.saving_eur ? candidate : best
        )
      : null
  // The day-ahead advisory and the guidance line render as separate
  // compact rows: the guidance covers usage that must run today, the
  // advisory covers the day-level strategy - distinct content, no
  // duplicate suppression needed.
  const advisory = insight.advisory ?? null
  const guidanceLine = insight.guidance ?? null
  // The week outlook rows, planning voice: the best solar day when it
  // clearly exceeds tomorrow, and the notably poor rain day. Future
  // days never command; only when today offers nothing (no guidance)
  // may the advisory row carry the imperative.
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
  // has nothing else to say: with guidance or advisory content present,
  // the honest no-opportunity box is omitted entirely - the absence of
  // a saving badge already communicates it.
  const showActionRow = !noOpportunity || (!guidanceLine && !advisory)
  // The action row's descriptive text: the matched candidate's exact
  // arithmetic basis when one exists, the largest belowThreshold
  // basis in the no-opportunity state with candidates, and the honest
  // no-load note when nothing was measured.
  const actionCandidate = noOpportunity
    ? largestBelowThreshold
    : ((insight.candidates ?? []).find(
        (candidate) =>
          Math.abs(candidate.saving_eur - (primary?.saving_eur ?? 0)) < 0.005
      ) ?? null)
  const actionDescription =
    actionCandidate?.basis ??
    (noOpportunity && (insight.candidates ?? []).length === 0
      ? "no appliance loads measured today"
      : primary?.when ?? "")

  return (
    // The blue-gradient AI panel is the whole widget; the gradient is
    // the visual identity of AI content - the same from-blue-700 to
    // sky-600 pair (blue-900 to sky-800 at night) every AI box uses.
    // It stretches to the full grid row so it matches the height of
    // the stats column next to it.
    <div className="h-full rounded-lg bg-gradient-to-br from-blue-800 to-sky-600 p-4 text-white shadow-card dark:from-blue-950 dark:to-sky-800">
      <p className="flex items-center gap-2 font-heading text-base font-medium">
        <Sparkles className="size-5" aria-hidden="true" />
        AI advisory
      </p>
      {insight.primary_action ? (
        // The advisory composition: every content item renders as a
        // glass row on the shared glass - the action row (which may
        // highlight its saving and carries the confidence label), the
        // guidance row and the advisory row, which read muted; the
        // hierarchy lives inside the rows, not on different surfaces.
        // The honest no-opportunity box renders only when the card has
        // nothing else to say: with guidance or advisory content
        // present it is omitted entirely - the absence of a saving
        // badge already communicates it. Guidance covers usage that
        // must run today, the advisory covers the day-level strategy.
        // The largest belowThreshold candidate renders as a single
        // muted fact line with its true amount; the warning stays the
        // amber exception; the card never shows a fabricated total.
        <div className="mt-2 space-y-2">
          {showActionRow && (
            // The action row always carries a title and a descriptive
            // text: the action phrase, then the matched candidate's
            // arithmetic basis (the window when no basis exists, or
            // the honest no-load note in the empty state).
            <div className={GLASS_BLOCK}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
                >
                  Today
                </span>
                {!noOpportunity && (
                  <span
                    className={`shrink-0 px-2.5 py-1 text-xs tabular-nums ${GLASS_CHIP}`}
                  >
                    {humanEur(insight.primary_action.saving_eur)}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium leading-snug">
                {insight.primary_action.what}
              </p>
              <p className="text-xs leading-relaxed">
                {humanizeEurInText(actionDescription)}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide">
                {insight.primary_action.confidence} confidence
              </p>
            </div>
          )}
          {guidanceLine && (
            // The guidance row, chip-based: the today chip, the title
            // and the window-with-peak description at human precision,
            // and the average as a value chip.
            <div className={GLASS_BLOCK}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
                >
                  Today
                </span>
                <span
                  className={`shrink-0 px-2.5 py-1 text-xs tabular-nums ${GLASS_CHIP}`}
                >
                  {humanEur(guidanceLine.cheapest_window_average_eur)} avg
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">
                Run your large appliances between{" "}
                {guidanceLine.window
                  .replace(" today", "")
                  .replace("-", " and ")}{" "}
                to pay the lowest price left today
              </p>
              <p className="text-xs leading-relaxed tabular-nums">
                cheapest remaining window &middot;{" "}
                {humanEur(guidanceLine.spread_per_kwh_eur)}/kWh below
                the {guidanceLine.peak_hour} peak at{" "}
                {humanEur(guidanceLine.peak_price_eur)}
              </p>
            </div>
          )}
          {advisory && (
            // The advisory row, chip-based: the recommended day's chip,
            // the one thing it says, the day-level numbers at human
            // precision, and the preference or the per-kWh difference
            // as a value chip. The horizon note renders only on a
            // defer advisory, inside the row.
            <div className={GLASS_BLOCK}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
                >
                  {advisoryDayChipLabel(advisory)}
                </span>
                <span
                  className={`shrink-0 px-2.5 py-1 text-xs tabular-nums ${GLASS_CHIP}`}
                >
                  {advisory.type === "defer" &&
                  advisory.price_difference_per_kwh !== null
                    ? `${humanEur(
                        Math.abs(advisory.price_difference_per_kwh)
                      )}/kWh cheaper`
                    : advisory.type === "defer"
                      ? "prefer this day"
                      : "prefer tomorrow"}
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">
                {!guidanceLine
                  ? advisory.type === "defer"
                    ? `Run your large appliances ${advisory.compare_day} instead of tomorrow to save on energy`
                    : "Run your large appliances tomorrow to save on energy"
                  : advisory.type === "advance"
                    ? advisory.tomorrow_solar_kwh !== null &&
                      advisory.compare_solar_kwh !== null &&
                      advisory.tomorrow_solar_kwh > advisory.compare_solar_kwh
                      ? `If you can wait: tomorrow brings ${humanNumber(
                          advisory.tomorrow_solar_kwh
                        )} kWh of your own solar against ${humanNumber(
                          advisory.compare_solar_kwh
                        )} kWh today`
                      : advisory.tomorrow_average_eur !== null &&
                          advisory.compare_average_eur !== null
                        ? `If you can wait: tomorrow's grid price averages ${humanEur(
                            advisory.tomorrow_average_eur
                          )} against ${humanEur(
                            advisory.compare_average_eur
                          )} today`
                        : "If you can wait: tomorrow is the better day"
                    : advisory.compare_average_eur !== null &&
                        advisory.tomorrow_average_eur !== null
                      ? `If you can wait: ${advisory.compare_day} averages ${humanEur(
                          advisory.compare_average_eur
                        )} against ${humanEur(
                          advisory.tomorrow_average_eur
                        )} tomorrow`
                      : advisory.compare_solar_kwh !== null &&
                          advisory.tomorrow_solar_kwh !== null
                        ? `If you can wait: ${advisory.compare_day} brings ${humanNumber(
                            advisory.compare_solar_kwh
                          )} kWh of your own solar against ${humanNumber(
                            advisory.tomorrow_solar_kwh
                          )} kWh tomorrow`
                        : `If you can wait: ${advisory.compare_day} is the better day`}
              </p>
              <p className="text-xs leading-relaxed tabular-nums">
                {advisory.type === "defer"
                  ? `${advisoryNumbers(
                      advisory.compare_average_eur,
                      advisory.compare_solar_kwh
                    )} vs tomorrow ${advisoryNumbers(
                      advisory.tomorrow_average_eur,
                      advisory.tomorrow_solar_kwh
                    )}`
                  : `tomorrow ${advisoryNumbers(
                      advisory.tomorrow_average_eur,
                      advisory.tomorrow_solar_kwh
                    )} vs today ${advisoryNumbers(
                      advisory.compare_average_eur,
                      advisory.compare_solar_kwh
                    )}`}
              </p>
              {advisory.horizon_note && (
                <p className="text-xs leading-relaxed">
                  {advisory.horizon_note}
                </p>
              )}
            </div>
          )}
          {showBestDay && bestDay && (
            // The best solar day, named with its number when it
            // clearly exceeds tomorrow - planning voice.
            <div className={GLASS_BLOCK}>
              <span
                className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
              >
                {bestDay.weekday_short}
              </span>
              <p className="text-sm font-medium leading-snug">
                {bestDay.weekday} looks even better: {humanNumber(bestDay.solar_kwh)}{" "}
                kWh of your own solar expected
              </p>
            </div>
          )}
          {poorDay && (
            // The notably poor rain day, named plainly as the day to
            // avoid - planning voice.
            <div className={GLASS_BLOCK}>
              <span
                className={`whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
              >
                {poorDay.weekday_short}
              </span>
              <p className="text-sm font-medium leading-snug">
                {poorDay.weekday} brings {poorDay.condition} and{" "}
                {(outlook?.best_solar_day?.solar_kwh ?? 0) > 0 &&
                poorDay.solar_kwh <
                  (outlook?.best_solar_day?.solar_kwh ?? 0) * 0.35
                  ? `almost no solar of your own, ${humanNumber(
                      poorDay.solar_kwh
                    )} kWh`
                  : `${humanNumber(poorDay.solar_kwh)} kWh of your own solar`}
              </p>
              <p className="text-xs leading-relaxed">
                avoid planning large appliances then
              </p>
            </div>
          )}
          {showOutlookNote && (
            // Horizon honesty, once, in home language.
            <p className="text-xs leading-relaxed text-white/60">
              Grid prices for later days are not yet published; there the
              solar forecast is the deciding signal.
            </p>
          )}
          {noOpportunity && largestBelowThreshold && (
            <p className="text-xs text-white">
              largest opportunity today: {largestBelowThreshold.label},{" "}
              {humanEur(largestBelowThreshold.saving_eur)}
            </p>
          )}
          {insight.warning && (
            <p className="flex items-start gap-2 text-sm font-medium leading-relaxed text-amber-300 dark:text-amber-200">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{insight.warning}</span>
            </p>
          )}
          {insight.context_note && (
            // Explanatory context (why no candidates exist): a muted
            // footnote, never amber.
            <p className="text-xs leading-relaxed text-white/60">
              {humanizeEurInText(insight.context_note)}
            </p>
          )}
        </div>
      ) : (
        // The plain-text insight (old format) renders exactly as
        // before: the summary paragraph with highlighted figures and
        // the designed action rows beneath.
        <>
          <SummaryText text={insight.summary} />
          {groups.length > 0 && (
            <div className="mt-3 space-y-2">
              {groups.map((group) => (
                <div key={group.label}>
                  {showHeadings && (
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white">
                      {group.label}
                    </p>
                  )}
                  <div className="space-y-2">
                    {group.items.map((action) => (
                      <ActionRow
                        key={`${action.date}T${action.start}`}
                        action={action}
                        isNext={`${action.date}T${action.start}` === nextKey}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {legacy.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {legacy.map((action: InsightAction, index: number) => (
                <LegacyActionRow
                  key={index}
                  action={action as LegacyInsightAction}
                />
              ))}
            </ul>
          )}
        </>
      )}
      {insight.stale && (
        <p className="mt-2 text-xs text-white">
          This insight is older than the live data; it refreshes when
          the AI budget allows
        </p>
      )}
    </div>
  )
}

export default SummaryInsight
