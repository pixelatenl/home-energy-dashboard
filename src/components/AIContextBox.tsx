import type { AiContextValue } from "@/lib/useAiContext"
import { humanizeEurInText } from "@/lib/advisoryText"
import { Sparkles } from "lucide-react"

// AI insight box shared by the weather, prices and battery widgets: a
// warm brown-gradient panel with the label and the text - the gradient
// is the visual identity of AI content, shared with the hub's summary
// panel and the header's insight pill. When no text is available (API
// failure or daily limit reached) the box renders nothing at all -
// except when the daily AI limit is the reason, which is explained in
// a translucent note on the gradient; the shimmering placeholder
// reserves roughly the final height so loading causes no layout shift.
function AIContextBox({ text, error, loading }: AiContextValue) {
  if (loading) {
    return (
      <div
        className="h-24 animate-pulse rounded-xl border bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14]"
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
    <div className="min-h-24 rounded-xl border bg-gradient-to-bl from-[#0d0805] via-[#241610] to-[#4a2c14] p-4 text-white">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI insight
      </span>
      <p className="mt-2 text-sm leading-relaxed">
        {/* The server may compose prices at payload precision (EUR
            0.267/kWh); every displayed price reads at two decimals,
            the human register. */}
        {humanizeEurInText(text)}
      </p>
      {limitReached && (
        <p className="mt-2 text-xs text-white">
          Live updates paused (daily AI limit reached); the insight may lag
        </p>
      )}
    </div>
  )
}

export default AIContextBox
