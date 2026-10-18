import { cn } from "cn"

// The app's one skeleton family: every loading placeholder composes
// these primitives. One soft pulse on the muted surface, identical in
// both themes; no ad hoc pulse blocks anywhere.
//
// Variants:
// - line: a text-line placeholder (the title rows and sub-lines)
// - block: a content-sized block (charts, bars, panels); size via
//   className
// - circle: a round placeholder (the live power circle, gauges)
function Skeleton({
  variant = "line",
  className,
}: {
  variant?: "line" | "block" | "circle"
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-muted",
        variant === "line" && "h-3",
        variant === "circle" && "rounded-full",
        className
      )}
    />
  )
}

export { Skeleton }
