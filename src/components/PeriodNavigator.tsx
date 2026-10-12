import { useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { periodLabel, type PeriodKind } from "@/lib/period"
import { usePeriod } from "@/lib/usePeriod"

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]

// Shared period navigation for analytical pages: prev/next arrows, an
// always-visible period label, a Today button when the period moved
// and a "so far" chip on the current period, sitting left of the
// Day/Week/Month/Year segmented control (which takes the same
// right-side position as the usage page's range selector). Keyboard,
// on any page that renders this: ArrowLeft/ArrowRight step prev/next
// (next blocked on the current period), T jumps to today, D/W/M/Y
// switch granularity. Shortcuts are ignored while typing in an input,
// textarea or select, and when modifier keys are held.
function PeriodNavigator() {
  const { period, setKind, shift, goToday, isCurrent } = usePeriod()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return
      }
      switch (event.key.toLowerCase()) {
        case "arrowleft":
          shift(-1)
          break
        case "arrowright":
          // Never step into the future: next is blocked when the
          // current period is active.
          if (!isCurrent) {
            shift(1)
          }
          break
        case "t":
          goToday()
          break
        case "d":
          setKind("day")
          break
        case "w":
          setKind("week")
          break
        case "m":
          setKind("month")
          break
        case "y":
          setKind("year")
          break
        default:
          return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [shift, setKind, goToday, isCurrent])

  const iconButton =
    "rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous period"
          onClick={() => shift(-1)}
          className={iconButton}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </button>
        <span className="flex items-center gap-2 text-sm font-medium tabular-nums">
          {periodLabel(period)}
          {isCurrent && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              so far
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Next period"
          disabled={isCurrent}
          onClick={() => shift(1)}
          className={iconButton}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
        {!isCurrent && (
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
          >
            Today
          </button>
        )}
      </div>
      <div className="inline-flex rounded-lg border bg-muted p-1">
        {KINDS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={period.kind === value}
            onClick={() => setKind(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none ${
              period.kind === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default PeriodNavigator
