import { Sparkles } from "lucide-react"
import type { DailyInsight } from "@/lib/api"

// Daily AI summary at the top of the page: the summary text followed by up
// to three recommended actions with their time window in bold. Uses the
// same box styling as the widget AI insight boxes; renders nothing when no
// summary is available. The data is owned by App, which refreshes it on
// the 5-minute panel cycle; the as_of stamp and force-refresh control live
// in the page header.
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
        className="h-full min-h-36 animate-pulse rounded-xl border border-sky-200/80 bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/40"
        aria-hidden="true"
      />
    )
  }

  if (!insight?.summary) {
    return null
  }

  return (
    <div className="h-full rounded-xl border border-sky-200/80 bg-sky-100/70 p-4 dark:border-sky-900 dark:bg-sky-950/40">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI summary
      </span>
      <p className="mt-2 text-sm leading-relaxed">{insight.summary}</p>
      {insight.stale && (
        <p className="mt-2 text-xs text-muted-foreground">
          Live updates paused (daily AI limit reached); the insight may lag
        </p>
      )}
      {insight.actions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {insight.actions.map((action, index) => (
            <li key={index} className="text-sm leading-relaxed">
              <span className="font-semibold tabular-nums">
                {action.window}
              </span>
              {" \u2014 "}
              {action.text}
              {action.reason && (
                <span className="text-muted-foreground">
                  {" "}
                  ({action.reason})
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SummaryInsight
