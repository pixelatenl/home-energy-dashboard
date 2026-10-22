// The advisory day chip: the small rounded glass pill the advisory
// card sets its day labels in - the pill register on top of the
// stat cards' own glass surface, whitespace-kept so it never wraps.
// The class recipe is lifted verbatim from the advisory card's day
// chip in SummaryInsight.tsx so the monologue card renders the very
// same chip by import instead of an inline duplicate; the legacy
// card keeps its own markup byte-for-byte until it can be refactored
// to import this component too.
const GLASS_CHIP =
  "rounded-full bg-white/15 text-chip-foreground backdrop-blur-sm";

// Renders the served label verbatim - never recomputed or localized
// on the client; the served labels (TODAY, FRI, SUN) are already the
// display register.
function AdvisoryDayChip({ label }: { label: string }) {
  return (
    <span
      className={`w-fit whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${GLASS_CHIP}`}
    >
      {label}
    </span>
  );
}

export default AdvisoryDayChip;
