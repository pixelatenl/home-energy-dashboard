import { useEffect, useState } from "react";
import { useSummary } from "@/lib/useSummary";
import { isDataStale, localTimeOf, snapshotAgeMs } from "@/lib/time";

// The age re-evaluation tick: the stale state follows the clock every
// 30 seconds without waiting for the next 5-minute poll - and without
// any new data fetch. The timestamp text itself only changes when a
// new snapshot arrives.
const AGE_TICK_MS = 30_000;

// The hub header's data-freshness caption: "Data from HH:MM" rendered
// verbatim from the summary snapshot's as_of stamp (the server is the
// sole source of the time), in a muted register clearly subordinate to
// the page title. When the snapshot has not loaded yet or carries no
// parseable stamp, nothing renders - an honest absence over a wrong
// value; the empty span keeps the header row's height stable so the
// label's appearance never shifts the layout. Past DATA_STALE_AFTER_MS
// the caption turns amber and gains the "stale" suffix.
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
  // No snapshot yet, or no parseable stamp: honest absence. The empty
  // span keeps the header row's height stable so the label's appearance
  // never shifts the layout.
  if (asOf === null) {
    return <span className="text-xs text-muted-foreground" />;
  }
  const ageMs = snapshotAgeMs(asOf, now);
  if (ageMs === null) {
    return <span className="text-xs text-muted-foreground" />;
  }

  const stale = isDataStale(ageMs);
  return (
    <span
      className={`whitespace-nowrap text-xs tabular-nums ${
        stale ? "text-amber-300 dark:text-amber-200" : "text-muted-foreground"
      }`}
    >
      {`Data from ${localTimeOf(asOf)}${stale ? ", stale" : ""}`}
    </span>
  );
}

export default DataFreshnessLabel;
