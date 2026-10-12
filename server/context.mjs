// One context snapshot per /api/summary request: the materialized fields
// the AI insight is based on - day totals from energy_delta, prices past
// and forecast, the PV forecast and the battery state - plus the stable
// signature over them. The insight gating (cache, throttle, stale
// markers) is driven by this snapshot, so the kiosk can always compare
// the served insight against the data shown next to it.

import { buildSummaryContext, summarySignature } from "./ai.mjs";
import { getPriceContextData } from "./prices.mjs";
import { getSummary } from "./queries.mjs";
import { dailyForecast } from "./solar.mjs";

// Builds the context snapshot. The summary statistics come from the
// 5-minute server cache, the price context from the 10-minute merged
// curve cache and the PV forecast from the 30-minute weather cache, so
// repeated calls are cheap. The optional sources are omitted from the
// context when unavailable rather than failing the request.
export async function buildContextSnapshot() {
  const summary = await getSummary();
  let weatherDaily = null;
  try {
    weatherDaily = await dailyForecast(5);
  } catch {
    weatherDaily = null;
  }
  let priceParts = null;
  try {
    priceParts = await getPriceContextData();
  } catch {
    priceParts = null;
  }
  return {
    summary,
    weatherDaily,
    priceParts,
    // The materialized context the model receives.
    context: buildSummaryContext(summary, weatherDaily, priceParts),
    // Stable hash over the materialized context fields.
    signature: summarySignature(summary, weatherDaily, priceParts),
    // The moment the underlying summary data was built (the 5-minute
    // cache fill); the insight reports it as the data it is based on.
    asOf: summary.summary_as_of ?? new Date().toISOString(),
  };
}
