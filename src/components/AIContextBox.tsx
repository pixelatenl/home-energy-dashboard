import type { AiContextValue } from "@/lib/useAiContext"
import { Sparkles } from "lucide-react"

// AI insight box shared by the weather and prices widgets: a subtle card
// with the label and the text. When no text is available (API failure or
// daily limit reached) the box renders nothing at all; the shimmering
// placeholder reserves roughly the final height so loading causes no layout
// shift.
function AIContextBox({ text, loading }: AiContextValue) {
  if (loading) {
    return (
      <div
        className="h-24 animate-pulse rounded-xl bg-sky-100/70 dark:bg-sky-950/40"
        aria-hidden="true"
      />
    )
  }

  if (!text) {
    return null
  }

  return (
    <div className="min-h-24 rounded-xl bg-sky-100/70 p-4 dark:bg-sky-950/40">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        AI insight
      </span>
      <p className="mt-2 text-sm leading-relaxed">{text}</p>
    </div>
  )
}

export default AIContextBox

