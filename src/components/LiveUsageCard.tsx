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
import { useLiveGridWatts } from "@/lib/useLiveGridWatts";
import { useSummary } from "@/lib/useSummary";

// The card's tooltip: what the circle shows and how it moves.
const LIVE_TOOLTIP =
  "The household's live grid draw from the meter, polled every 20 seconds, alternating every 4 seconds with the renewable share of the grid's current power mix. The circle rotates faster as the draw rises and rests below 25 W; its color follows the grid's renewable share.";

// The alternation cadence: the circle's headline swaps between the
// live draw and the renewable share every 4 seconds, sequenced as a
// full fade-out of the current figure followed by a fade-in of the
// next, never an overlap.
const ALTERNATE_MS = 4_000;
const FADE_MS = 400;

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

// The stats hub's Live power card: the live grid draw combined with
// the current renewable grid power. A thick lined circle carries a
// circular motion instead of a pulse: a quarter-turn arc rotates
// around its track, its speed stepped by the draw's pulse steps - one
// revolution per period, creeping very slowly below the deadband, an
// empty resting ring at zero draw - while the contents alternate every 4 seconds
// between the draw ("1.2 kW" beneath the electricity glyph) and the
// renewable share ("61%" beneath the leaf). The arc's line color
// follows the grid score's color state. Without data the placeholders
// read, never a fabricated number, and without a draw the arc
// rests.
function LiveUsageCard() {
  const drawW = useLiveGridWatts();
  const { summary } = useSummary();
  const gridScore = summary?.grid_score ?? null;
  const renewables =
    gridScore?.current == null ? null : Math.round(gridScore.current);

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
    // Before the first live reading the circle renders as a skeleton
    // in its own shape; once a draw exists the card never leaves the
    // content state again.
    <SkeletonReveal
      loading={drawW === null}
      skeleton={
        // The skeleton mirrors the loaded card's own stack: title
        // row, then the circle centered in the remaining space at
        // its loaded size - not the metric cards' spread layout,
        // which would pin the circle to the bottom.
        <Card className="h-full min-h-24" aria-busy="true">
          <div className="flex flex-1 flex-col items-stretch gap-1 px-4">
            <Skeleton className="h-[24.75px] w-20" />
            <div className="flex flex-1 items-center justify-center">
              <Skeleton variant="circle" className="size-28" />
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
          <CardTitle className="flex items-center gap-1.5 text-muted-foreground">
            <Activity className="size-5 shrink-0" aria-hidden="true" />
            Live power
          </CardTitle>
          {/* The circle in circular motion: a quarter-turn arc
            rotates around its track at the draw's step speed - one
            revolution per period, creeping very slowly below the
            deadband - while the glyph, figure and label sit on a
            steady layer inside, so they never move with it. The arc's
            line color follows the grid score's state; with no draw
            the ring renders empty and rests. */}
          <div className="relative flex flex-1 items-center justify-center">
            <svg
              viewBox="0 0 100 100"
              className={`absolute size-28 ${
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
                  className={`text-2xl font-semibold tabular-nums ${
                    headlineMuted ? "text-muted-foreground" : ""
                  }`}
                >
                  {headline}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  Grid draw now
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
                  className={`text-2xl font-semibold tabular-nums ${
                    headlineMuted ? "text-muted-foreground" : ""
                  }`}
                >
                  {renewableHeadline}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
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
