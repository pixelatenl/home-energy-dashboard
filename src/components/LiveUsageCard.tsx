import { useEffect, useState } from "react";
import { Activity, Leaf, Zap } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import SkeletonReveal from "@/components/SkeletonReveal";
import StatCardLink from "@/components/StatCardLink";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatGridWatts,
  gridPulsePeriodS,
  gridPulseStep,
} from "@/lib/gridPulse";
import {
  LIVE_STALE_AFTER_MS,
  liveFieldAgeMs,
  useLive,
} from "@/lib/useLive";
import { useSummary } from "@/lib/useSummary";

// The card's tooltip: what the circle shows and how it moves.
const LIVE_TOOLTIP =
  "The household's live net grid draw (import minus export) from the meter, polled every 20 seconds, alternating every 4 seconds with the renewable share of the grid's current power mix. While the home exports - net export above the 25 W deadband - the figure reads the export magnitude with an Exporting caption, so battery selling never reads as no usage. The circle rotates faster as the flow rises and rests at zero; its color follows the grid's renewable share. A dimmed figure with a dot is an honest reading more than a minute old.";

// The alternation cadence: the circle's headline swaps between the
// live draw and the renewable share every 4 seconds, sequenced as a
// full fade-out of the current figure followed by a fade-in of the
// next, never an overlap.
const ALTERNATE_MS = 4_000;
const FADE_MS = 400;

// The headline figure joins the hub stat cards' shared responsive
// headline scale (lib/statCard.ts) at the ring's own established
// size: the full size on phones and large desktops, one step smaller
// inside the two-column tablet band, with the same whitespace-nowrap
// keeping figure and unit on one line as a single non-breaking unit.
// The metric cards' 2.5 rem step never applies here - the figure sits
// inside the fixed 128 px ring composition, whose geometry stays
// untouched - so the shared scale's tablet treatment (the step down
// and the nowrap) is what the card adopts.
const HEADLINE_SCALE =
  "whitespace-nowrap text-2xl md:text-xl lg:text-2xl";

// The arc's line color by the grid score's state - the app's own
// interpretation of Zonneplan's color badge, in the muted palette:
// the muted green for a renewable share of 75 and up, the muted
// amber for 40 to 75, the neutral for below.
const ARC_LINE: Record<string, string> = {
  green: "hsl(140 40% 38%)",
  yellow: "hsl(38 45% 42%)",
  grey: "hsl(0 0% 65% / 0.8)",
};

// The rotation's arc geometry: a quarter-turn segment on the circle.
const ARC_CX = 50;
const ARC_R = 46;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_R;
const ARC_DASH = ARC_CIRCUMFERENCE / 4;

// The stats hub's Live power card: the live net grid draw (import
// minus export, from /api/live) combined with the current renewable
// grid power. A thick lined circle carries a
// circular motion instead of a pulse: a quarter-turn arc rotates
// around its track, its speed stepped by the draw's pulse steps - one
// revolution per period, creeping very slowly below the deadband, an
// empty resting ring at zero draw - while the contents alternate every 4 seconds
// between the draw ("1.2 kW" beneath the electricity glyph) and the
// renewable share ("61%" beneath the leaf); the alternation is
// presentation only, the data cadence stays the 20-second live poll.
// While the home exports above the deadband the figure reads the
// export magnitude with an Exporting caption; a reading older than a
// minute renders dimmed with a dot. The arc's line color
// follows the grid score's color state. Without data the placeholders
// read, never a fabricated number, and without a draw the arc
// rests.
function LiveUsageCard() {
  const { snapshot: live, status: liveStatus } = useLive();
  const { summary } = useSummary();
  const gridScore = summary?.grid_score ?? null;
  const renewables =
    gridScore?.current == null ? null : Math.round(gridScore.current);

  // Frame 1 reads the live snapshot: the net grid draw (import minus
  // export). While the home exports above the shared 25 W deadband,
  // the figure shows the export magnitude and the caption reads
  // Exporting - the direction indicator, in the same muted caption
  // voice as the grid card's in/out split - so battery selling never
  // reads as a zero or missing draw. The value is used exactly as
  // served; nothing is interpolated between polls.
  const netField = live?.fields.netGridW ?? null;
  const netW =
    typeof netField?.value === "number" ? netField.value : null;
  const exporting = live?.fields.isExporting?.value === true;
  const drawW = netW === null ? null : exporting ? Math.abs(netW) : netW;

  // Stale handling: a figure whose honest age - the server-reported
  // reading age plus the snapshot's time in the browser - passes the
  // threshold, or one kept after a failed poll, renders dimmed with a
  // dot. The honest number stays; nothing fresher is invented.
  const drawAgeMs =
    live !== null && netField !== null ? liveFieldAgeMs(live, netField) : null;
  const drawStale =
    drawW !== null &&
    (liveStatus === "error" ||
      (drawAgeMs !== null && drawAgeMs > LIVE_STALE_AFTER_MS));

  // The headline alternates every 4 seconds when both figures
  // exist; with one missing, the other shows steadily.
  const [showRenewables, setShowRenewables] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setShowRenewables((value) => !value);
    }, ALTERNATE_MS);
    return () => clearInterval(id);
  }, []);
  const renewablesTurn =
    showRenewables && drawW !== null && renewables !== null;

  const headline =
    drawW === null && renewables === null
      ? "\u2014"
      : renewablesTurn || drawW === null
        ? renewables === null
          ? "\u2014"
          : `${renewables}%`
        : formatGridWatts(drawW);
  const headlineMuted = drawW === null && renewables === null;
  const renewableHeadline = renewables === null ? "\u2014" : `${renewables}%`;

  // Zero draw is the one calm state: an empty ring, no arc, no
  // rotation. Any current at all - even a watt - keeps the circle
  // alive, the very low draws creeping at the step 0 period.
  const hasDraw = drawW !== null && drawW > 0;
  const step = hasDraw ? gridPulseStep(drawW) : 0;
  const periodS = hasDraw ? gridPulsePeriodS(step) : null;

  return (
    // Before the first snapshot the circle renders as a skeleton
    // in its own shape; once a snapshot exists the card never leaves
    // the content state again - a snapshot without the net figure
    // shows the placeholder dash, never a fabricated number.
    <SkeletonReveal
      loading={live === null}
      skeleton={
        // The skeleton mirrors the loaded card's own stack: title
        // row, then the circle centered in the remaining space at
        // its loaded size - not the metric cards' spread layout,
        // which would pin the circle to the bottom.
        <Card className="h-full min-h-24" aria-busy="true">
          <div className="flex flex-1 flex-col items-stretch gap-1 px-4">
            <Skeleton className="h-[24.75px] w-20" />
            <div className="flex flex-1 items-center justify-center">
              <Skeleton variant="circle" className="size-32" />
            </div>
          </div>
        </Card>
      }
    >
      <Card className="relative min-h-24 transition-[background-color,border-color,box-shadow] hover:bg-card-hover hover:border-white/30 hover:shadow-card-lift">
        {/* The whole card opens the live energy flow page. */}
        <StatCardLink
          to="/live"
          label="Live power: open the live energy flow"
        />
        <div className="absolute right-3 top-3 z-20">
          <InfoTooltip text={LIVE_TOOLTIP} />
        </div>
        <CardHeader className="flex flex-1 flex-col items-stretch">
          <CardTitle className="flex items-center gap-1.5 text-title-foreground">
            <Activity className="size-5 shrink-0" aria-hidden="true" />
            Live power
          </CardTitle>
          {/* The circle in circular motion: a quarter-turn arc
            rotates around its track at the draw's step speed - one
            revolution per period, creeping very slowly below the
            deadband - while the glyph, figure and label sit on a
            steady layer inside, so they never move with it. The arc's
            line color follows the grid score's state; with no draw
            the ring renders empty and rests. The container holds the
            ring's full height open: the ring itself is absolutely
            positioned, so on phones - where the hub rows size to
            their content - the card would otherwise clip it. */}
          <div className="relative flex min-h-32 flex-1 items-center justify-center">
            <svg
              viewBox="0 0 100 100"
              className={`absolute size-32 ${
                periodS !== null ? "grid-spin" : ""
              }`}
              style={
                periodS !== null
                  ? { animationDuration: `${periodS.toFixed(2)}s` }
                  : undefined
              }
              aria-hidden="true"
            >
              <circle
                cx={ARC_CX}
                cy={ARC_CX}
                r={ARC_R}
                fill="none"
                strokeWidth="4.5"
                className="stroke-muted-foreground/25"
              />
              {hasDraw && (
                <circle
                  cx={ARC_CX}
                  cy={ARC_CX}
                  r={ARC_R}
                  fill="none"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  stroke={ARC_LINE[gridScore?.state ?? "grey"] ?? ARC_LINE.grey}
                  strokeDasharray={`${ARC_DASH} ${ARC_CIRCUMFERENCE - ARC_DASH}`}
                />
              )}
            </svg>
            {/* Two stacked layers alternate in sequence: the visible
              figure fades out completely, then the incoming one fades
              in - the hidden layer's transition is delayed by the
              fade duration so the two never overlap. */}
            <div className="relative flex size-20 items-center justify-center text-center">
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 ${
                  renewablesTurn ? "opacity-0" : "opacity-100"
                }`}
                style={{
                  transition: `opacity ${FADE_MS}ms ease`,
                  transitionDelay: renewablesTurn ? "0ms" : `${FADE_MS}ms`,
                }}
                aria-hidden={renewablesTurn}
              >
                <Zap
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span
                  className={`${HEADLINE_SCALE} font-semibold tabular-nums ${
                    headlineMuted || drawStale ? "text-subtle-foreground" : ""
                  }`}
                  title={
                    drawStale
                      ? "last live reading is more than a minute old"
                      : undefined
                  }
                >
                  {headline}
                  {drawStale && (
                    <sup
                      className="ml-0.5 text-[10px]"
                      aria-hidden="true"
                    >
                      &middot;
                    </sup>
                  )}
                </span>
                <span className="text-[10px] leading-tight text-subtle-foreground">
                  {exporting ? "Exporting" : "Grid draw now"}
                </span>
              </div>
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 ${
                  renewablesTurn ? "opacity-100" : "opacity-0"
                }`}
                style={{
                  transition: `opacity ${FADE_MS}ms ease`,
                  transitionDelay: renewablesTurn ? `${FADE_MS}ms` : "0ms",
                }}
                aria-hidden={!renewablesTurn}
              >
                <Leaf
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span
                  className={`${HEADLINE_SCALE} font-semibold tabular-nums ${
                    headlineMuted ? "text-subtle-foreground" : ""
                  }`}
                >
                  {renewableHeadline}
                </span>
                <span className="text-[10px] leading-tight text-subtle-foreground">
                  Renewable grid power
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
    </SkeletonReveal>
  );
}

export default LiveUsageCard;
