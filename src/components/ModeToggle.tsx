import { Euro, Zap } from "lucide-react"
import { useMode, type Mode } from "@/lib/mode"

const SEGMENTS: { value: Mode; label: string; icon: typeof Zap }[] = [
  { value: "energy", label: "Energy", icon: Zap },
  { value: "cost", label: "Cost", icon: Euro },
]

// Two-segment Energy/Cost toggle in the same idiom as the period
// navigator's segments. The mode is global shell state, URL-persisted
// via ModeProvider; no page consumes it yet.
function ModeToggle() {
  const { mode, setMode } = useMode()
  return (
    <div className="inline-flex rounded-lg border bg-muted p-1">
      {SEGMENTS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none ${
            mode === value
              ? "bg-background text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

export default ModeToggle
