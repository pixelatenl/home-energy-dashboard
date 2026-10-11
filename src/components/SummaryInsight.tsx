import { useEffect, useState } from "react"
import { fetchDailyInsight, type InsightAction } from "@/lib/api"
import { Sparkles } from "lucide-react"

interface InsightState {
  summary: string | null
  actions: InsightAction[]
  loading: boolean
}

// Daily AI insight at the top of the page: the summary text followed by up
// to three recommended actions with their time window in bold. Uses the
// same box styling as the widget AI insight boxes; renders nothing when no
// summary is available.
function SummaryInsight() {
  const [state, setState] = useState<InsightState>({
    summary: null,
    actions: [],
    loading: true,
  })

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void fetchDailyInsight()
      .then((value) =>
        setState({
          summary: value.summary,
          actions: value.actions ?? [],
          loading: false,
        })
      )
      .catch(() =>
        setState({ summary: null, actions: [], loading: false })
      )
  }, [])

  if (state.loading) {
    return (
      <div
        className="h-full min-h-36 animate-pulse rounded-xl border border-sky-200/80 bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/40"
        aria-hidden="true"
      />
    )
  }

  if (!state.summary) {
    return null
  }

  return (
    <div className="h-full rounded-xl border border-sky-200/80 bg-sky-100/70 p-4 dark:border-sky-900 dark:bg-sky-950/40">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI summary
      </span>
      <p className="mt-2 text-sm leading-relaxed">{state.summary}</p>
      {state.actions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {state.actions.map((action, index) => (
            <li key={index} className="text-sm leading-relaxed">
              <span className="font-semibold tabular-nums">
                {action.window}
              </span>
              {" \u2014 "}
              {action.text}
              {action.reason && (
                <span className="text-muted-foreground"> ({action.reason})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SummaryInsight
