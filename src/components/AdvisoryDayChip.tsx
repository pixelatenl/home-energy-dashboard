// The advisory day chip: the small rounded glass pill the advisory
// area sets its day labels in - the pill register on top of the
// stat cards' own glass surface, whitespace-kept so it never wraps.
// The chip register lives in the shared advisory surface module, so
// every chip in the advisory area reads as one family.
import { GLASS_CHIP } from "@/lib/advisorySurface";

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
