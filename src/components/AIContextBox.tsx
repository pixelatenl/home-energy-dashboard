import type { AiContextValue } from "@/lib/useAiContext"
import { Sparkles } from "lucide-react"

// AI insight box shared by the weather, prices and battery widgets: a
// blue-gradient panel with the label and the text - the gradient is
// the visual identity of AI content, shared with the hub's summary
// panel and the header's insight pill. When no text is available (API
// failure or daily limit reached) the box renders nothing at all -
// except when the daily AI limit is the reason, which is explained in
// a translucent note on the gradient; the shimmering placeholder
// reserves roughly the final height so loading causes no layout shift.
function AIContextBox({ text, error, loading }: AiContextValue) {
  if (loading) {
    return (
      <div
        className="h-24 animate-pulse rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 dark:from-blue-800 dark:to-sky-700"
        aria-hidden="true"
      />
    )
  }

  const limitReached = error === "daily_limit_reached"

  if (!text) {
    if (limitReached) {
      return (
        <p className="text-xs text-muted-foreground">
          AI insight paused (daily AI limit reached); it resumes after
          midnight UTC
        </p>
      )
    }
    return null
  }

  return (
    <div className="min-h-24 rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 p-4 text-white dark:from-blue-800 dark:to-sky-700">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/90">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI insight
      </span>
      <p className="mt-2 text-sm leading-relaxed">{text}</p>
      {limitReached && (
        <p className="mt-2 text-xs text-white/75">
          Live updates paused (daily AI limit reached); the insight may lag
        </p>
      )}
    </div>
  )
}

export default AIContextBox
