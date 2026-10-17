import { Info } from "lucide-react"

// Corner info tooltip, the home page stat cards' idiom: shows on
// hover, keyboard focus and tap. The button's aria-label carries the
// full text for screen readers.
function InfoTooltip({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      className="group relative rounded-full text-muted-foreground outline-none"
    >
      <Info className="size-3.5" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border bg-popover p-2 text-left text-xs leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        {text}
      </span>
    </button>
  )
}

export default InfoTooltip
