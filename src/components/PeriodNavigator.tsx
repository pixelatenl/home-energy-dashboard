import { useEffect } from "react"
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react"
import { periodLabel, type PeriodKind } from "@/lib/period"
import { usePeriod } from "@/lib/usePeriod"

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
]

// Shared period navigation for analytical pages: a compact inline
// group for the tab row's right side - the period label first, a
// small Today pill with an undo icon when the period moved, then
// prev/next arrows as icon segments directly beside the
// Day/Week/Month/Year segmented control, one navigation unit that
// wraps as a row. The label takes its natural width, so with the
// group right-aligned only its left edge moves between periods.
// Keyboard, on any page that renders this: ArrowLeft/ArrowRight step
// prev/next (next blocked on the current period), T jumps to today,
// D/W/M/Y switch granularity. Shortcuts are ignored while typing in
// an input, textarea or select, and when modifier keys are held.
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

  // Icon segments use the segment box height (px-3 py-1.5 around a
  // 20px text line = 32px) so the arrows match the segments exactly.
  const segmentBase =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 h-8 text-sm font-medium transition focus-visible:outline-none"

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <span className="text-sm font-medium tabular-nums">
        {periodLabel(period)}
      </span>
      {!isCurrent && (
        <button
          type="button"
          onClick={goToday}
          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-chip-foreground transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
          Today
        </button>
      )}
      {/* Arrows and segments form one navigation unit: they sit
          directly adjacent and wrap to the next row together. */}
      <div className="flex items-center gap-1">
        <div className="inline-flex rounded-md border p-1">
          <button
            type="button"
            aria-label="Previous period"
            onClick={() => shift(-1)}
            className={`${segmentBase} text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next period"
            disabled={isCurrent}
            onClick={() => shift(1)}
            className={`${segmentBase} text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="inline-flex rounded-md border p-1">
          {KINDS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={period.kind === value}
              onClick={() => setKind(value)}
              className={`${segmentBase} ${
                period.kind === value
                  ? "bg-white/20 text-chip-foreground shadow-card backdrop-blur-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PeriodNavigator
