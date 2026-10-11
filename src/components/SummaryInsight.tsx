import type { ReactNode } from "react"
import {
  BatteryCharging,
  Car,
  Sparkles,
  Sun,
  WashingMachine,
  Zap,
} from "lucide-react"
import {
  isStructuredAction,
  type DailyInsight,
  type InsightAction,
  type InsightActionType,
  type LegacyInsightAction,
  type StructuredInsightAction,
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

// Renders the summary paragraph with its key figures as chips.
function SummaryText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(FIGURE_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) {
      nodes.push(text.slice(last, start))
    }
    nodes.push(
      <span
        key={start}
        className="mx-0.5 inline-block rounded-full bg-white/70 px-1.5 py-0.5 text-xs font-semibold leading-normal tabular-nums dark:bg-white/10"
      >
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
    <div className="flex items-center gap-3 rounded-xl bg-white/60 p-3 dark:bg-white/5">
      <div className="flex shrink-0 flex-col items-start gap-1">
        <span className="whitespace-nowrap rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
          {dayChipLabel(action.date)}
        </span>
        <span className="whitespace-nowrap text-sm font-semibold leading-none tabular-nums">
          {action.start} - {action.end}
        </span>
      </div>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium leading-snug">
            {action.title}
          </span>
          {isNext && (
            <span className="rounded-full bg-sky-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-900 dark:bg-sky-400/20 dark:text-sky-200">
              next
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {action.reason}
        </p>
      </div>
      {action.price_eur != null && (
        <span className="shrink-0 rounded-full bg-foreground/5 px-2 py-1 text-xs font-medium tabular-nums dark:bg-white/10">
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
        <span className="mr-1.5 inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium dark:bg-white/10">
          {dayLabel}
        </span>
      )}
      <span className="font-semibold tabular-nums">{window}</span>
      {" \u2014 "}
      {action.text}
      {action.reason && (
        <span className="text-muted-foreground"> ({action.reason})</span>
      )}
    </li>
  )
}

// Daily AI summary at the top of the page: the summary text with its key
// figures as chips, followed by up to three recommended actions rendered
// as designed rows (day chip, window, type icon, title, reason, price
// tag), grouped under day headings when actions span multiple days. The
// nearest upcoming action carries a "next" badge. Prose actions (the
// server fallback format) render as a simple list. The data is owned by
// App, which refreshes it on the 5-minute panel cycle; the as_of stamp
// and force-refresh control live in the page header.
function SummaryInsight({
  insight,
  loading,
}: {
  insight: DailyInsight | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div
        className="h-full min-h-36 animate-pulse rounded-xl bg-sky-100/70 dark:bg-sky-950/40"
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

  return (
    <div className="h-full rounded-xl bg-sky-100/70 p-4 dark:bg-sky-950/40">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI summary
      </span>
      <SummaryText text={insight.summary} />
      {insight.stale && (
        <p className="mt-2 text-xs text-muted-foreground">
          Live updates paused (daily AI limit reached); the insight may lag
        </p>
      )}
      {groups.length > 0 && (
        <div className="mt-3 space-y-2">
          {groups.map((group) => (
            <div key={group.label}>
              {showHeadings && (
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
            <LegacyActionRow key={index} action={action as LegacyInsightAction} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default SummaryInsight
