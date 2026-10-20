import { useEffect, useState } from "react";
import { useSummary } from "@/lib/useSummary";
import { isDataStale, localTimeOf, snapshotAgeMs } from "@/lib/time";

// The age re-evaluation tick: the stale state follows the clock every
// 30 seconds without waiting for the next 5-minute poll - and without
// any new data fetch. The timestamp text itself only changes when a
// new snapshot arrives.
const AGE_TICK_MS = 30_000;

// The chip reuses the advisory card's provenance-chip register verbatim
// (SummaryInsight's PROVENANCE_CHIP): the same glass pill, so the data
// stamp reads as neutral hub furniture - not a button, not an AI
// indicator. whitespace-nowrap keeps the pill from wrapping mid-text.
const CHIP =
  "flex shrink-0 items-center whitespace-nowrap rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-xs font-medium text-chip-foreground tabular-nums backdrop-blur-sm";

// The stale state: the same pill in the app's amber warning register -
// an amber tint and border (the /30 and /10 opacity language of the
// solar badge's behind state) with the warning text colors.
const CHIP_STALE =
  "flex shrink-0 items-center whitespace-nowrap rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium tabular-nums backdrop-blur-sm text-amber-300 dark:text-amber-200";

// The hub header's data-freshness chip: "Data from HH:MM" rendered
// verbatim from the summary snapshot's as_of stamp (the server is the
// sole source of the time), in a muted register clearly subordinate to
// the page title. When the snapshot has not loaded yet or carries no
// parseable stamp, nothing renders - an honest absence over a wrong
// value; the invisible placeholder keeps the chip's height reserved so
// its appearance never shifts the layout. Past DATA_STALE_AFTER_MS the
// chip turns amber and gains the "stale" suffix.
function DataFreshnessLabel() {
  const { summary } = useSummary();
  // The clock the age is measured against, re-read on every tick so the
  // stale state flips within at most 30 seconds of crossing the
  // threshold; cleared on unmount.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const asOf = typeof summary?.as_of === "string" ? summary.as_of : null;
  // No snapshot yet, or no parseable stamp: honest absence. The
  // invisible placeholder reserves the chip's height so its appearance
  // never shifts the layout.
  if (asOf === null) {
    return <span className={`${CHIP} invisible`} />;
  }
  const ageMs = snapshotAgeMs(asOf, now);
  if (ageMs === null) {
    return <span className={`${CHIP} invisible`} />;
  }

  const stale = isDataStale(ageMs);
  return (
    <span className={stale ? CHIP_STALE : CHIP}>
      {`Data from ${localTimeOf(asOf)}${stale ? ", stale" : ""}`}
    </span>
  );
}

export default DataFreshnessLabel;
